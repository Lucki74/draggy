//! The production [`Launcher`]: one child per server with piped stdio. Output is read on tasks and handed out as events.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use draggy_tools::spawn::{spawn_hidden_with_input, Child, ChildStdin};
use serde_json::{Map, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::process::{Event, Launcher, Process};

/// How long the output readers may take to finish after the child exits, in case a grandchild holds a pipe open.
const DRAIN_LIMIT: Duration = Duration::from_secs(2);

/// Starts `program` with the arguments it is given. The program is the Node binary for stdio servers.
#[derive(Debug, Clone)]
pub struct StdioLauncher {
    program: PathBuf,
}

impl StdioLauncher {
    pub fn new(program: PathBuf) -> Self {
        Self { program }
    }
}

impl Launcher for StdioLauncher {
    type Process = ChildProcess;

    /// The file name only, so the install folder stays out of the log.
    fn program_name(&self) -> String {
        self.program
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn spawn(&self, args: &[String], env: &Map<String, Value>) -> Result<ChildProcess, String> {
        let mut child = spawn_hidden_with_input(&self.program, args, |command| {
            for (key, value) in env {
                let text = value
                    .as_str()
                    .map_or_else(|| value.to_string(), str::to_owned);
                command.env(key, text);
            }
        })
        .map_err(|error| format!("Could not start the server: {error}"))?;
        let input = child
            .stdin
            .take()
            .ok_or("Could not open the server's input.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Could not open the server's output.")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Could not open the server's errors.")?;

        let (events, receiver) = mpsc::unbounded_channel();
        let (line_tx, line_rx) = mpsc::unbounded_channel();
        let (kill_tx, kill_rx) = oneshot::channel();
        tokio::spawn(write_lines(input, line_rx));
        let readers = vec![
            tokio::spawn(read_output(stdout, events.clone(), Event::Stdout)),
            tokio::spawn(read_output(stderr, events.clone(), Event::Stderr)),
        ];
        tokio::spawn(wait_for_exit(child, kill_rx, readers, events));
        Ok(ChildProcess {
            input: Mutex::new(Some(line_tx)),
            events: tokio::sync::Mutex::new(receiver),
            kill: Mutex::new(Some(kill_tx)),
        })
    }
}

/// One running child. A writer task feeds stdin, and a waiter task reports the exit.
pub struct ChildProcess {
    input: Mutex<Option<mpsc::UnboundedSender<String>>>,
    events: tokio::sync::Mutex<mpsc::UnboundedReceiver<Event>>,
    kill: Mutex<Option<oneshot::Sender<()>>>,
}

impl Process for ChildProcess {
    async fn write_line(&self, line: String) -> bool {
        let sender = self
            .input
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        sender.is_some_and(|sender| sender.send(format!("{line}\n")).is_ok())
    }

    async fn next_event(&self) -> Event {
        self.events
            .lock()
            .await
            .recv()
            .await
            .unwrap_or(Event::Exited(None))
    }

    fn stop(&self) {
        self.input
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(kill) = self
            .kill
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            let _ = kill.send(());
        }
    }
}

async fn write_lines(mut input: ChildStdin, mut lines: mpsc::UnboundedReceiver<String>) {
    while let Some(line) = lines.recv().await {
        if input.write_all(line.as_bytes()).await.is_err() || input.flush().await.is_err() {
            break;
        }
    }
    // Dropping stdin here closes it, which is how a stdio server learns it should end.
}

/// Forwards one output pipe as text. A multi-byte character split across reads waits for its rest.
async fn read_output<R: AsyncRead + Unpin>(
    mut pipe: R,
    events: mpsc::UnboundedSender<Event>,
    wrap: fn(String) -> Event,
) {
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match pipe.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        pending.extend_from_slice(&chunk[..read]);
        let text = take_text(&mut pending);
        if !text.is_empty() && events.send(wrap(text)).is_err() {
            return;
        }
    }
    if !pending.is_empty() {
        let _ = events.send(wrap(String::from_utf8_lossy(&pending).into_owned()));
    }
}

/// Removes the decodable prefix of `pending` and returns it; invalid bytes become U+FFFD.
fn take_text(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                out.push_str(text);
                pending.clear();
                return out;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
                match error.error_len() {
                    Some(len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + len);
                    }
                    None => {
                        pending.drain(..valid);
                        return out;
                    }
                }
            }
        }
    }
}

/// Waits for the child to end, or kills it when stop is called or the process handle is dropped.
async fn wait_for_exit(
    mut child: Child,
    kill: oneshot::Receiver<()>,
    readers: Vec<JoinHandle<()>>,
    events: mpsc::UnboundedSender<Event>,
) {
    let code = tokio::select! {
        status = child.wait() => status.ok().and_then(|status| status.code()),
        _ = kill => {
            let _ = child.start_kill();
            child.wait().await.ok().and_then(|status| status.code())
        }
    };
    let _ = tokio::time::timeout(DRAIN_LIMIT, async {
        for reader in readers {
            let _ = reader.await;
        }
    })
    .await;
    let _ = events.send(Event::Exited(code));
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;

    fn sh() -> StdioLauncher {
        StdioLauncher::new(PathBuf::from("/bin/sh"))
    }

    /// Collects output until the process reports its exit, failing the test if that takes more than five seconds.
    async fn until_exit(process: &ChildProcess) -> (String, String, Option<i32>) {
        let mut out = String::new();
        let mut err = String::new();
        loop {
            let event = tokio::time::timeout(Duration::from_secs(5), process.next_event())
                .await
                .expect("an event within five seconds");
            match event {
                Event::Stdout(text) => out.push_str(&text),
                Event::Stderr(text) => err.push_str(&text),
                Event::Exited(code) => return (out, err, code),
                Event::Failed(message) => panic!("unexpected failure: {message}"),
            }
        }
    }

    #[tokio::test]
    async fn talks_over_stdin_and_reports_output_and_exit() {
        let args = [
            "-c",
            "read line; echo got:$line; echo oops >&2; exit 3",
            "sh",
        ]
        .map(str::to_owned);
        let process = sh().spawn(&args, &Map::new()).expect("spawn");
        assert!(process.write_line("hello".to_owned()).await);
        let (out, err, code) = until_exit(&process).await;
        assert_eq!(out, "got:hello\n");
        assert_eq!(err, "oops\n");
        assert_eq!(code, Some(3));
    }

    #[tokio::test]
    async fn environment_values_reach_the_child() {
        let mut env = Map::new();
        env.insert("DRAGGY_PROBE".to_owned(), json!("visible"));
        let args = ["-c", "echo $DRAGGY_PROBE", "sh"].map(str::to_owned);
        let process = sh().spawn(&args, &env).expect("spawn");
        let (out, _, _) = until_exit(&process).await;
        assert_eq!(out, "visible\n");
    }

    #[tokio::test]
    async fn stop_ends_a_running_child() {
        let args = ["-c", "sleep 30", "sh"].map(str::to_owned);
        let process = sh().spawn(&args, &Map::new()).expect("spawn");
        process.stop();
        until_exit(&process).await;
        assert!(!process.write_line("late".to_owned()).await);
    }

    #[test]
    fn program_name_is_the_file_name_only() {
        assert_eq!(
            StdioLauncher::new(PathBuf::from("/opt/node/bin/node")).program_name(),
            "node"
        );
    }

    #[test]
    fn split_characters_wait_for_their_rest() {
        let mut pending = vec![b'a', 0xC3];
        assert_eq!(take_text(&mut pending), "a");
        pending.push(0xA9);
        assert_eq!(take_text(&mut pending), "\u{e9}");
        assert!(pending.is_empty());
    }

    #[test]
    fn invalid_bytes_become_replacement_characters() {
        let mut pending = vec![b'x', 0xFF, b'y'];
        assert_eq!(take_text(&mut pending), "x\u{FFFD}y");
    }
}
