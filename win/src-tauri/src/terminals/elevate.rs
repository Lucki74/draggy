//! One command as administrator, behind the Windows UAC prompt. The command goes into a batch file and its output
//! comes back through a file, since an elevated process cannot share pipes.

use std::fs;
use std::path::Path;
use std::time::Instant;

use draggy_tools::shell::{clip, timeout_for};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::diag;

const SCOPE: &str = "proc.elevate";

/// The exit code Windows gives when the UAC prompt is declined.
pub const DECLINED: i64 = 1223;

pub fn batch_text(command: &str, cwd: &Path) -> String {
    format!("@echo off\r\ncd /d \"{}\"\r\n{command}\r\n", cwd.display())
}

/// What cmd runs as administrator: the batch file, its output and errors going to `out`.
pub fn cmd_args(batch: &Path, out: &Path) -> String {
    format!("/d /c \"\"{}\" > \"{}\" 2>&1\"", batch.display(), out.display())
}

/// How the elevated run ended.
enum Ended {
    Exit(i64),
    Declined,
    TimedOut,
    Failed(String),
}

/// Starts cmd through the UAC prompt with ShellExecuteEx and waits for it. No PowerShell in between,
/// since a hidden PowerShell with an encoded command is what antivirus heuristics flag.
#[cfg(windows)]
fn elevate_and_wait(args: &str, limit: std::time::Duration) -> Ended {
    use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{
        SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
    use windows::core::{HSTRING, PCWSTR, w};

    let params = HSTRING::from(args);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: u32::try_from(std::mem::size_of::<SHELLEXECUTEINFOW>()).unwrap_or(0),
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lpVerb: w!("runas"),
        lpFile: w!("cmd.exe"),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    // SAFETY: `info` and the strings it points to live until the call returns.
    if let Err(error) = unsafe { ShellExecuteExW(&raw mut info) } {
        if error.code() == ERROR_CANCELLED.to_hresult() {
            return Ended::Declined;
        }
        return Ended::Failed(error.message());
    }
    let process = info.hProcess;
    if process.is_invalid() {
        return Ended::Failed("The administrator run did not start.".into());
    }
    let millis = u32::try_from(limit.as_millis()).unwrap_or(u32::MAX - 1);
    // SAFETY: `process` is the handle ShellExecuteEx returned, closed once below.
    let ended = unsafe {
        if WaitForSingleObject(process, millis) == WAIT_OBJECT_0 {
            let mut code = 0u32;
            match GetExitCodeProcess(process, &raw mut code) {
                Ok(()) => Ended::Exit(i64::from(code)),
                Err(error) => Ended::Failed(error.message()),
            }
        } else {
            Ended::TimedOut
        }
    };
    // SAFETY: as above.
    let _ = unsafe { CloseHandle(process) };
    ended
}

#[cfg(not(windows))]
fn elevate_and_wait(_args: &str, _limit: std::time::Duration) -> Ended {
    Ended::Failed("Administrator rights are only available on Windows.".into())
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
    let args = cmd_args(&batch, &out);

    let started = Instant::now();
    let ended = tokio::task::spawn_blocking(move || elevate_and_wait(&args, limit))
        .await
        .unwrap_or_else(|error| Ended::Failed(error.to_string()));
    let (code, timed_out, declined_prompt) = match ended {
        Ended::Exit(code) => (Some(code), false, false),
        Ended::Declined => (Some(DECLINED), false, true),
        Ended::TimedOut => (None, true, false),
        Ended::Failed(error) => {
            let _ = fs::remove_dir_all(&dir);
            if let Some(diag) = diag() {
                diag.error(SCOPE, "could not start the elevated shell", Some(json!({ "cmdLen": data["cmdLen"], "cmdHash": data["cmdHash"] })));
            }
            return refused(&error);
        }
    };
    let output = fs::read_to_string(&out).unwrap_or_default();
    let _ = fs::remove_dir_all(&dir);

    let declined = declined_prompt || (code == Some(DECLINED) && output.is_empty());
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
    fn batch_runs_in_the_folder_then_the_command() {
        let text = batch_text("dir", Path::new("C:\\work"));
        assert_eq!(text, "@echo off\r\ncd /d \"C:\\work\"\r\ndir\r\n");
    }

    #[test]
    fn cmd_sends_the_output_to_the_file() {
        let args = cmd_args(Path::new("C:\\w\\run.cmd"), Path::new("C:\\w\\out.txt"));
        assert_eq!(args, "/d /c \"\"C:\\w\\run.cmd\" > \"C:\\w\\out.txt\" 2>&1\"");
    }
}
