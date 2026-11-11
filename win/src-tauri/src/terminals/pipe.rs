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
                command.raw_arg(arg);
            }
        })
    } else {
        hidden_command(launch.file, launch.args, |_| {})
    };
    command.current_dir(launch.cwd).env_clear().envs(launch.env);
    let mut child = command.spawn()?;
    let pid = child.id();
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
                    let text = String::from_utf8_lossy(&carry[..complete]).into_owned();
                    carry.drain(..complete);
                    if !text.is_empty() {
                        on_chunk(&text);
                    }
                }
            }
        }
        if !carry.is_empty() {
            on_chunk(&String::from_utf8_lossy(&carry));
        }
    })
}

#[cfg(test)]
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
