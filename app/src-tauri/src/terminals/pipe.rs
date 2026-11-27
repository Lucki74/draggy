//! A command on plain pipes, hidden: for the sandbox launcher, and for computers without ConPTY.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;
use std::sync::Arc;

use draggy_tools::spawn::{CancelToken, hidden_command, kill_tree};
use tokio::io::{AsyncRead, AsyncReadExt};

/// What to start. `verbatim` arguments reach the program as written (cmd's quoted command line).
pub struct PipeLaunch<'a> {
    pub file: &'a Path,
    pub args: &'a [String],
    pub verbatim: bool,
    pub cwd: &'a Path,
    pub env: &'a BTreeMap<String, String>,
}

/// How a piped process ended: its exit code, or the error that kept it from finishing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipeExit {
    pub code: Option<i64>,
    pub error: Option<String>,
}

/// A running piped process. `kill` stops it and everything it started; the exit is still reported.
#[derive(Clone)]
pub struct Pipe {
    pub pid: Option<u32>,
    stop: CancelToken,
}

impl Pipe {
    pub fn kill(&self) {
        self.stop.cancel();
    }
}

/// Starts the process. `on_chunk` gets stdout and stderr as text as it arrives; `on_exit` runs once, after the
/// last chunk.
pub fn spawn(
    launch: &PipeLaunch<'_>,
    on_chunk: impl Fn(&str) + Send + Sync + 'static,
    on_exit: impl FnOnce(PipeExit) + Send + 'static,
) -> io::Result<Pipe> {
    let no_args: [&str; 0] = [];
    let mut command = if launch.verbatim {
        hidden_command(launch.file, &no_args, |command| {
            for arg in launch.args {
                #[cfg(windows)]
                command.raw_arg(arg);
                #[cfg(not(windows))]
                command.arg(arg);
            }
        })
    } else {
        hidden_command(launch.file, launch.args, |_| {})
    };
    command.current_dir(launch.cwd).env_clear().envs(launch.env);
    crate::proc_log::spawned(&launch.file.to_string_lossy(), launch.args);
    let mut child = command.spawn()?;
    let pid = child.id();
    draggy_tools::spawn::adopt(pid);
    let stop = CancelToken::new();
    let on_chunk = Arc::new(on_chunk);
    let readers = [
        child
            .stdout
            .take()
            .map(|out| read_into(out, Arc::clone(&on_chunk))),
        child
            .stderr
            .take()
            .map(|err| read_into(err, Arc::clone(&on_chunk))),
    ];
    let token = stop.clone();
    tauri::async_runtime::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            () = token.cancelled() => {
                if let Some(pid) = pid {
                    kill_tree(pid, false).await;
                }
                let _ = child.start_kill();
                child.wait().await
            }
        };
        for reader in readers.into_iter().flatten() {
            let _ = reader.await;
        }
        on_exit(match status {
            Ok(status) => PipeExit {
                code: status.code().map(i64::from),
                error: None,
            },
            Err(error) => PipeExit {
                code: None,
                error: Some(error.to_string()),
            },
        });
    });
    Ok(Pipe { pid, stop })
}

fn read_into<R, F>(mut pipe: R, on_chunk: Arc<F>) -> tauri::async_runtime::JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    F: Fn(&str) + Send + Sync + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut carry: Vec<u8> = Vec::new();
        let mut buffer = vec![0u8; 8192];
        loop {
            match pipe.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    carry.extend_from_slice(&buffer[..read]);
                    let complete = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(error) if error.error_len().is_some() => carry.len(),
                        Err(error) => error.valid_up_to(),
                    };
                    let text = decode(&carry[..complete]);
                    carry.drain(..complete);
                    if !text.is_empty() {
                        on_chunk(&text);
                    }
                }
            }
        }
        if !carry.is_empty() {
            on_chunk(&decode(&carry));
        }
    })
}

/// Native Windows tools such as taskkill write in the OEM code page (850 on a French system), not UTF-8. Bytes that are
/// not UTF-8 are read in that code page there, so "réservés" does not arrive as "r\u{FFFD}serv\u{FFFD}s".
fn decode(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    #[cfg(windows)]
    if let Some(text) = oem_text(bytes) {
        return text;
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(windows)]
fn oem_text(bytes: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::{CP_OEMCP, MultiByteToWideChar};
    let len = i32::try_from(bytes.len()).ok()?;
    // SAFETY: the input pointer and length describe `bytes`; the first call writes nothing and returns the size needed.
    let needed =
        unsafe { MultiByteToWideChar(CP_OEMCP, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0) };
    let mut wide = vec![0u16; usize::try_from(needed).ok().filter(|size| *size > 0)?];
    // SAFETY: `wide` holds exactly `needed` units, the size the first call asked for.
    let written =
        unsafe { MultiByteToWideChar(CP_OEMCP, 0, bytes.as_ptr(), len, wide.as_mut_ptr(), needed) };
    wide.truncate(usize::try_from(written).ok().filter(|size| *size > 0)?);
    Some(String::from_utf16_lossy(&wide))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    fn cmd(line: &str) -> (std::path::PathBuf, Vec<String>) {
        let file = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        (
            file.into(),
            vec!["/d".into(), "/s".into(), "/c".into(), format!("\"{line}\"")],
        )
    }

    #[test]
    fn reads_oem_output_in_the_oem_code_page() {
        // 0x82 is "é" in both code page 437 and 850.
        assert_eq!(decode(b"r\x82serv\x82s"), "réservés");
        assert_eq!(decode("déjà".as_bytes()), "déjà");
    }

    #[test]
    fn streams_output_then_reports_the_exit_code() {
        let (file, args) = cmd("echo one & echo two 1>&2 & exit 4");
        let env: BTreeMap<String, String> = std::env::vars().collect();
        let cwd = std::env::temp_dir();
        let launch = PipeLaunch {
            file: &file,
            args: &args,
            verbatim: true,
            cwd: &cwd,
            env: &env,
        };
        let seen = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&seen);
        let (tx, rx) = mpsc::channel();
        spawn(
            &launch,
            move |chunk| sink.lock().expect("sink").push_str(chunk),
            move |exit| drop(tx.send(exit)),
        )
        .expect("spawn");
        let exit = rx.recv_timeout(Duration::from_secs(20)).expect("exit");
        assert_eq!(
            exit,
            PipeExit {
                code: Some(4),
                error: None
            }
        );
        let output = seen.lock().expect("output").clone();
        assert!(
            output.contains("one") && output.contains("two"),
            "{output:?}"
        );
    }

    #[test]
    fn kill_stops_a_long_command_and_still_reports_it() {
        let (file, args) = cmd("ping -n 30 127.0.0.1 > nul");
        let env: BTreeMap<String, String> = std::env::vars().collect();
        let cwd = std::env::temp_dir();
        let launch = PipeLaunch {
            file: &file,
            args: &args,
            verbatim: true,
            cwd: &cwd,
            env: &env,
        };
        let (tx, rx) = mpsc::channel();
        let pipe = spawn(&launch, |_| {}, move |exit| drop(tx.send(exit))).expect("spawn");
        pipe.kill();
        let exit = rx.recv_timeout(Duration::from_secs(20)).expect("exit");
        assert_ne!(exit.code, Some(0));
    }
}
