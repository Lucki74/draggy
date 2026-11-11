//! Interactive shells on a pseudo-terminal (ConPTY through portable-pty). Each session is minted here; output
//! and exits reach the caller through the callbacks given to `open`.

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use regex::Regex;

use super::sanitize::Sanitizer;

pub const MAX_SESSIONS: usize = 8;
pub const MAX_WRITE_CHARS: usize = 65_536;

/// Variables that usually hold a credential. A shell the user types into does not need them.
static SECRET_ENV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(^|_)(API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)(_|$)|^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|AWS_SECRET|AZURE_CLIENT_SECRET|NPM_CONFIG__AUTH)",
    )
    .expect("secret names")
});

pub fn is_secret(name: &str) -> bool {
    SECRET_ENV.is_match(name)
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    closed: Arc<AtomicBool>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

pub struct Host {
    sessions: Sessions,
    cap: usize,
}

impl Default for Host {
    /// The user's terminals, at most eight at once.
    fn default() -> Self {
        Self {
            sessions: Sessions::default(),
            cap: MAX_SESSIONS,
        }
    }
}

fn lock(sessions: &Sessions) -> MutexGuard<'_, HashMap<String, Session>> {
    sessions.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A terminal size from the renderer: whole numbers within the limits, the default when missing.
pub fn clamp(value: Option<f64>, min: u16, max: u16, fallback: u16) -> u16 {
    match value {
        Some(number) if number.is_finite() => {
            number.round().clamp(f64::from(min), f64::from(max)) as u16
        }
        _ => fallback,
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Why a terminal did not open. `Unavailable` means this computer has no pseudo-terminal at all.
#[derive(Debug, PartialEq, Eq)]
pub enum OpenError {
    Unavailable,
    Failed(String),
}

/// A program to start on a terminal, with the whole environment it gets.
pub struct Launch<'a> {
    pub file: &'a Path,
    pub args: &'a [String],
    pub cwd: &'a Path,
    pub env: &'a BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    /// Leaves out variables that hold a credential, for a shell the user types into.
    pub scrub_secrets: bool,
}

/// ConPTY asks where the cursor is when it starts and waits for the answer. Nothing may be listening yet (a
/// background task never has a terminal), so the host answers that first query itself.
const CURSOR_QUERY: &str = "\u{1b}[6n";

fn answer_cursor(sessions: &Sessions, id: &str) {
    if let Some(session) = lock(sessions).get_mut(id) {
        let _ = session
            .writer
            .write_all(b"\x1b[1;1R")
            .and_then(|()| session.writer.flush());
    }
}

fn failed(error: impl std::fmt::Display) -> OpenError {
    OpenError::Failed(error.to_string())
}

/// The new session's id and process id.
pub struct Opened {
    pub id: String,
    pub pid: Option<u32>,
}

/// `pty-` and 16 hex characters, minted here so the renderer never names a session.
fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(format!(
        "pty-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

impl Host {
    /// Opens a shell in `cwd`. `on_data` gets sanitized text, `on_exit` the exit code, once, and only when the
    /// session was not closed by the caller.
    pub fn open(
        &self,
        launch: &Launch<'_>,
        on_data: impl Fn(&str, &str) + Send + 'static,
        on_exit: impl Fn(&str, i64) + Send + 'static,
    ) -> Result<Opened, OpenError> {
        if lock(&self.sessions).len() >= self.cap {
            return Err(OpenError::Failed(format!(
                "At most {MAX_SESSIONS} terminals can be open at once."
            )));
        }
        let pair = native_pty_system()
            .openpty(size(launch.cols, launch.rows))
            .map_err(|_| OpenError::Unavailable)?;
        let mut command = CommandBuilder::new(launch.file);
        command.args(launch.args);
        command.cwd(launch.cwd);
        command.env_clear();
        for (name, value) in launch
            .env
            .iter()
            .filter(|(name, _)| !(launch.scrub_secrets && is_secret(name)))
        {
            command.env(name, value);
        }
        let mut child = pair.slave.spawn_command(command).map_err(failed)?;
        drop(pair.slave);
        let pid = child.process_id();

        let reader = pair.master.try_clone_reader().map_err(failed)?;
        let writer = pair.master.take_writer().map_err(failed)?;
        let id = new_id().map_err(OpenError::Failed)?;

        let closed = Arc::new(AtomicBool::new(false));
        let killer = child.clone_killer();
        lock(&self.sessions).insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                killer,
                closed: Arc::clone(&closed),
            },
        );

        let reply = id.clone();
        let sessions = Arc::clone(&self.sessions);
        let (reader_id, reader_closed) = (id.clone(), Arc::clone(&closed));
        let reader_sessions = Arc::clone(&self.sessions);
        let reading = std::thread::spawn(move || {
            let mut reader = reader;
            let mut sanitizer = Sanitizer::default();
            let mut carry: Vec<u8> = Vec::new();
            let mut buffer = [0u8; 8192];
            let mut answered = false;
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        carry.extend_from_slice(&buffer[..read]);
                        let complete = match std::str::from_utf8(&carry) {
                            Ok(_) => carry.len(),
                            Err(error) => error.valid_up_to(),
                        };
                        let mut text = String::from_utf8_lossy(&carry[..complete]).into_owned();
                        carry.drain(..complete);
                        if !answered && text.contains(CURSOR_QUERY) {
                            answered = true;
                            text = text.replacen(CURSOR_QUERY, "", 1);
                            answer_cursor(&reader_sessions, &reader_id);
                        }
                        let clean = sanitizer.feed(&text);
                        if !clean.is_empty() && !reader_closed.load(Ordering::Relaxed) {
                            on_data(&reader_id, &clean);
                        }
                    }
                }
            }
        });
        // ConPTY ends the output only once the console closes, so the exit drops the session first.
        std::thread::spawn(move || {
            let code = child
                .wait()
                .map_or(-1, |status| i64::from(status.exit_code()));
            drop(lock(&sessions).remove(&id));
            let _ = reading.join();
            if !closed.swap(true, Ordering::Relaxed) {
                on_exit(&id, code);
            }
        });
        Ok(Opened { id: reply, pid })
    }

    /// Keystrokes and pastes from the user. Only text within the size limit, for a live session.
    pub fn write(&self, id: &str, data: &str) -> bool {
        if data.len() > MAX_WRITE_CHARS {
            return false;
        }
        let mut sessions = lock(&self.sessions);
        let Some(session) = sessions.get_mut(id) else {
            return false;
        };
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|()| session.writer.flush())
            .is_ok()
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> bool {
        lock(&self.sessions)
            .get(id)
            .is_some_and(|session| session.master.resize(size(cols, rows)).is_ok())
    }

    /// A host without the cap, for background tasks, which have their own limit per chat.
    pub fn uncapped() -> Self {
        Self {
            sessions: Sessions::default(),
            cap: usize::MAX,
        }
    }

    /// Kills a session's process; its exit is still reported, as for any other exit.
    pub fn kill(&self, id: &str) -> bool {
        lock(&self.sessions)
            .get_mut(id)
            .is_some_and(|session| session.killer.kill().is_ok())
    }

    /// Ends one session. Its exit is not reported to the caller.
    pub fn close(&self, id: &str) -> bool {
        let Some(session) = lock(&self.sessions).remove(id) else {
            return false;
        };
        session.closed.store(true, Ordering::Relaxed);
        let mut killer = session.killer;
        let _ = killer.kill();
        true
    }

    /// Kills every shell before the app exits.
    pub fn stop_all(&self) {
        let sessions: Vec<Session> = lock(&self.sessions)
            .drain()
            .map(|(_, session)| session)
            .collect();
        for mut session in sessions {
            session.closed.store(true, Ordering::Relaxed);
            let _ = session.killer.kill();
        }
    }

    pub fn count(&self) -> usize {
        lock(&self.sessions).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn sizes_are_held_to_the_limits() {
        assert_eq!(clamp(None, 2, 500, 80), 80);
        assert_eq!(clamp(Some(f64::NAN), 2, 500, 80), 80);
        assert_eq!(clamp(Some(1.0), 2, 500, 80), 2);
        assert_eq!(clamp(Some(9999.0), 1, 200, 24), 200);
        assert_eq!(clamp(Some(120.4), 2, 500, 80), 120);
    }

    #[test]
    fn ids_are_minted_with_sixteen_hex_characters() {
        let id = new_id().expect("id");
        assert_eq!(id.len(), 20);
        assert!(id.starts_with("pty-"));
        assert!(id[4..].chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(id, new_id().expect("id"));
    }

    #[test]
    fn credentials_are_recognised_by_name() {
        for name in [
            "OPENAI_API_KEY",
            "GITHUB_TOKEN",
            "DB_PASSWORD",
            "anthropic_x",
            "AWS_SECRET_ACCESS_KEY",
        ] {
            assert!(is_secret(name), "{name}");
        }
        for name in ["PATH", "TOKENIZERS_PARALLELISM", "HOME", "AUTHOR"] {
            assert!(!is_secret(name), "{name}");
        }
    }

    #[test]
    fn runs_a_command_reports_its_exit_once_and_drops_secrets() {
        let host = Host::default();
        let cmd = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        let args = vec![
            "/d".to_string(),
            "/c".to_string(),
            "echo [%DG_TEST_TOKEN%] & exit 3".to_string(),
        ];
        let mut env: BTreeMap<String, String> = std::env::vars().collect();
        env.insert("DG_TEST_TOKEN".into(), "leak".into());
        let cwd = std::env::temp_dir();
        let launch = Launch {
            file: Path::new(&cmd),
            args: &args,
            cwd: &cwd,
            env: &env,
            cols: 80,
            rows: 24,
            scrub_secrets: true,
        };
        let (data_tx, data_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let opened = host
            .open(
                &launch,
                move |_, data| {
                    let _ = data_tx.send(data.to_owned());
                },
                move |_, code| {
                    let _ = exit_tx.send(code);
                },
            )
            .expect("open");
        assert_eq!(exit_rx.recv_timeout(Duration::from_secs(20)), Ok(3));
        let output: String = data_rx.try_iter().collect();
        assert!(output.contains("[%DG_TEST_TOKEN%]"), "{output:?}");
        assert!(!output.contains(CURSOR_QUERY));
        assert!(!output.contains("leak"));
        assert!(exit_rx.recv_timeout(Duration::from_millis(200)).is_err());
        assert!(!host.write(&opened.id, "x"));
        assert_eq!(host.count(), 0);
    }

    #[test]
    fn refuses_oversized_input_and_unknown_ids() {
        let host = Host::default();
        assert!(!host.write("pty-none", "ls"));
        assert!(!host.write("pty-none", &"x".repeat(MAX_WRITE_CHARS + 1)));
        assert!(!host.resize("pty-none", 80, 24));
        assert!(!host.close("pty-none"));
    }
}
