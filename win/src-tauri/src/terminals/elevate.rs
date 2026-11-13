//! One command as administrator, behind the Windows UAC prompt. The command goes into a batch file and its output
//! comes back through a file, since an elevated process cannot share pipes.

use std::fs;
use std::path::Path;
use std::time::Instant;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_tools::shell::{clip, timeout_for};
use draggy_tools::spawn::hidden_command;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::diag;

const SCOPE: &str = "proc.elevate";

/// The exit code Windows gives when the UAC prompt is declined.
pub const DECLINED: i64 = 1223;

pub fn batch_text(command: &str, cwd: &Path) -> String {
    format!("@echo off\r\ncd /d \"{}\"\r\n{command}\r\n", cwd.display())
}

/// The PowerShell line that starts the elevated shell and waits for it. The handle is taken first, or an elevated
/// process reports no exit code and a failure reads as success.
pub fn elevation_script(batch: &Path, out: &Path) -> String {
    let args = format!(
        "/d /c \"\"{}\" > \"{}\" 2>&1\"",
        batch.display(),
        out.display()
    );
    let quoted = args.replace('\'', "''");
    format!(
        "$ErrorActionPreference='Stop'; try {{ $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '{quoted}' -Verb RunAs -PassThru -WindowStyle Hidden; $null = $p.Handle; $p.WaitForExit(); exit $p.ExitCode }} catch {{ exit {DECLINED} }}"
    )
}

fn encode(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    STANDARD.encode(bytes)
}

fn refused(error: &str) -> Value {
    json!({ "success": false, "error": error })
}

/// A command is never logged: only its length and a short hash, so one run can be matched up later.
fn fingerprint(text: &str) -> Value {
    let hash: String = Sha256::digest(text.as_bytes())
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    json!({ "cmdLen": text.chars().count(), "cmdHash": hash })
}

/// Runs `command` in `cwd` as administrator. Resolves with the same shape the renderer reads for a foreground run.
pub async fn run_elevated(command: &str, cwd: &Path, timeout_ms: Option<f64>) -> Value {
    let text = command.trim();
    if !cfg!(windows) {
        if let Some(diag) = diag() {
            diag.debug(SCOPE, "refused", Some(json!({ "reason": "not-windows" })));
        }
        return refused("Administrator rights are only available on Windows.");
    }
    if text.is_empty() {
        if let Some(diag) = diag() {
            diag.debug(SCOPE, "refused", Some(json!({ "reason": "empty-command" })));
        }
        return refused("No command was given.");
    }
    if !cwd.exists() {
        if let Some(diag) = diag() {
            diag.warn(
                SCOPE,
                "refused",
                Some(json!({ "reason": "no-project-folder" })),
            );
        }
        return refused("The project folder is not available.");
    }
    let mut data = fingerprint(text);
    let limit = timeout_for(timeout_ms);
    data["timeoutMs"] = json!(u64::try_from(limit.as_millis()).unwrap_or(u64::MAX));
    if let Some(diag) = diag() {
        diag.debug(SCOPE, "request", Some(data.clone()));
    }
    let mut token = [0u8; 4];
    if getrandom::fill(&mut token).is_err() {
        return refused("The administrator run could not start.");
    }
    let dir = std::env::temp_dir().join(format!(
        "dg-admin-{}-{}",
        token
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
        Instant::now().elapsed().as_nanos()
    ));
    if fs::create_dir_all(&dir).is_err() {
        return refused("The administrator run could not start.");
    }
    let batch = dir.join("run.cmd");
    let out = dir.join("out.txt");
    if fs::write(&batch, batch_text(text, cwd)).is_err() {
        let _ = fs::remove_dir_all(&dir);
        return refused("The administrator run could not start.");
    }
    let encoded = encode(&elevation_script(&batch, &out));

    let started = Instant::now();
    let mut child = hidden_command(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encoded.as_str(),
        ],
        |_| {},
    );
    let waited = tokio::time::timeout(timeout_for(timeout_ms), child.output()).await;
    let timed_out = waited.is_err();
    let code = match waited {
        Ok(Ok(finished)) => finished.status.code().map(i64::from),
        Ok(Err(error)) => {
            let _ = fs::remove_dir_all(&dir);
            if let Some(diag) = diag() {
                diag.error(SCOPE, "could not start the elevation shell", Some(json!({ "cmdLen": data["cmdLen"], "cmdHash": data["cmdHash"], "code": error.raw_os_error() })));
            }
            return refused(&error.to_string());
        }
        Err(_) => None,
    };
    let output = fs::read_to_string(&out).unwrap_or_default();
    let _ = fs::remove_dir_all(&dir);

    let declined = code == Some(DECLINED) && output.is_empty();
    let clipped = clip(&output);
    let dur_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    if let Some(diag) = diag() {
        let mut logged = data.clone();
        logged["durMs"] = json!(dur_ms);
        logged["exitCode"] = json!(code);
        if declined {
            diag.warn(SCOPE, "UAC prompt declined", Some(logged));
        } else if timed_out {
            diag.warn(SCOPE, "timed out", Some(logged));
        } else if code == Some(0) {
            logged["outputLen"] = json!(output.len());
            logged["truncated"] = json!(clipped.truncated);
            diag.info(SCOPE, "finished", Some(logged));
        } else {
            logged["truncated"] = json!(clipped.truncated);
            diag.warn(SCOPE, "finished with error", Some(logged));
        }
    }
    let mut result = json!({
        "success": !timed_out && !declined && code == Some(0),
        "exitCode": code,
        "timedOut": timed_out,
        "declined": declined,
        "elevated": true,
        "output": if declined { String::new() } else { clipped.text },
        "truncated": clipped.truncated,
        "shell": "cmd",
        "durationMs": dur_ms,
    });
    if declined {
        result["error"] = json!("The user declined the administrator prompt.");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_the_script_as_utf16_base64() {
        assert_eq!(encode("a"), "YQA=");
    }

    #[test]
    fn batch_runs_in_the_folder_then_the_command() {
        let text = batch_text("dir", Path::new("C:\\work"));
        assert_eq!(text, "@echo off\r\ncd /d \"C:\\work\"\r\ndir\r\n");
    }

    #[test]
    fn script_waits_for_the_elevated_shell() {
        let script = elevation_script(Path::new("C:\\w\\run.cmd"), Path::new("C:\\w\\out.txt"));
        assert!(script.contains("$null = $p.Handle; $p.WaitForExit()"));
        assert!(script.contains(&format!("catch {{ exit {DECLINED} }}")));
    }
}
