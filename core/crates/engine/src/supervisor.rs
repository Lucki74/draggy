//! Runs one engine process (colibri or MLX): starts it hidden, reads its output, polls a readiness route on loopback
//! and stops its whole process tree. The engine host drives it through `EngineControl`.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use draggy_tools::spawn::{kill_tree, spawn_hidden};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::watch;

use crate::engine_host::{EngineControl, EngineStatus};
use crate::llama_health::get;

/// What to start and how to know it is ready.
#[derive(Debug, Clone)]
pub struct SpawnPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(OsString, OsString)>,
    pub port: u16,
    /// Route that answers 200 once the engine can serve, such as `/health` or `/v1/models`.
    pub ready_path: &'static str,
    pub model: String,
    pub timeout: Duration,
}

/// How a start ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartResult {
    Ready,
    /// The process exited or never answered. `output` holds its last lines, for failure mapping.
    Failed { output: String },
}

#[derive(Default)]
struct Inner {
    pid: Option<u32>,
    port: Option<u16>,
    model: Option<String>,
    running: bool,
    kill: Option<watch::Sender<bool>>,
}

/// One engine process at a time.
#[derive(Clone, Default)]
pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
    tail: Arc<Mutex<Vec<String>>>,
}

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

const TAIL_LINES: usize = 40;

fn pump<R: AsyncRead + Unpin + Send + 'static>(reader: R, tail: Arc<Mutex<Vec<String>>>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut tail = locked(&tail);
            tail.push(line);
            if tail.len() > TAIL_LINES {
                tail.remove(0);
            }
        }
    });
}

impl Supervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// The last output lines, joined, for logs and failure mapping.
    pub fn output(&self) -> String {
        locked(&self.tail).join("\n")
    }

    /// Starts the process and waits until the readiness route answers, the process exits or the timeout passes.
    pub async fn start(&self, plan: SpawnPlan) -> StartResult {
        self.stop().await;
        locked(&self.tail).clear();
        let spawned = spawn_hidden(&plan.program, &plan.args, |command| {
            if let Some(cwd) = &plan.cwd {
                command.current_dir(cwd);
            }
            for (key, value) in &plan.env {
                command.env(key, value);
            }
        });
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                return StartResult::Failed {
                    output: error.to_string(),
                };
            }
        };
        if let Some(out) = child.stdout.take() {
            pump(out, self.tail.clone());
        }
        if let Some(err) = child.stderr.take() {
            pump(err, self.tail.clone());
        }
        let (kill_tx, mut kill_rx) = watch::channel(false);
        let (exit_tx, exit_rx) = watch::channel(false);
        {
            let mut inner = locked(&self.inner);
            *inner = Inner {
                pid: child.id(),
                port: Some(plan.port),
                model: Some(plan.model.clone()),
                running: false,
                kill: Some(kill_tx),
            };
        }
        let shared = self.inner.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {}
                _ = kill_rx.changed() => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                }
            }
            locked(&shared).running = false;
            let _ = exit_tx.send(true);
        });

        let deadline = tokio::time::Instant::now() + plan.timeout;
        loop {
            if *exit_rx.borrow() {
                return StartResult::Failed { output: self.output() };
            }
            if matches!(get(plan.port, plan.ready_path, Duration::from_millis(1500)).await, Some((200, _))) {
                locked(&self.inner).running = true;
                return StartResult::Ready;
            }
            if tokio::time::Instant::now() >= deadline {
                self.stop().await;
                return StartResult::Failed { output: self.output() };
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    /// Stops the process and everything it started.
    pub async fn stop(&self) {
        let (pid, kill) = {
            let mut inner = locked(&self.inner);
            inner.running = false;
            (inner.pid.take(), inner.kill.take())
        };
        if let Some(kill) = kill {
            let _ = kill.send(true);
        }
        if let Some(pid) = pid {
            kill_tree(pid, false).await;
        }
    }
}

impl EngineControl for Supervisor {
    fn stop_sync(&self) {
        let (pid, kill) = {
            let mut inner = locked(&self.inner);
            inner.running = false;
            (inner.pid.take(), inner.kill.take())
        };
        if let Some(kill) = kill {
            let _ = kill.send(true);
        }
        if let (Some(pid), Ok(handle)) = (pid, tokio::runtime::Handle::try_current()) {
            handle.spawn(kill_tree(pid, false));
        }
    }

    fn status(&self) -> EngineStatus {
        let inner = locked(&self.inner);
        EngineStatus {
            running: inner.running,
            port: inner.running.then_some(inner.port).flatten(),
            model: inner.running.then(|| inner.model.clone()).flatten(),
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn plan(script: &str, port: u16, timeout_ms: u64) -> SpawnPlan {
        SpawnPlan {
            program: PathBuf::from("sh"),
            args: vec!["-c".into(), script.into()],
            cwd: None,
            env: vec![],
            port,
            ready_path: "/health",
            model: "m".into(),
            timeout: Duration::from_millis(timeout_ms),
        }
    }

    #[tokio::test]
    async fn an_exiting_process_fails_with_its_output() {
        let supervisor = Supervisor::new();
        let result = supervisor.start(plan("echo boom; exit 3", 9, 5000)).await;
        match result {
            StartResult::Failed { output } => assert!(output.contains("boom") || output.is_empty()),
            StartResult::Ready => panic!("should not be ready"),
        }
        assert!(!supervisor.status().running);
    }

    #[tokio::test]
    async fn a_silent_process_times_out_and_is_stopped() {
        let supervisor = Supervisor::new();
        let result = supervisor.start(plan("sleep 30", 9, 800)).await;
        assert!(matches!(result, StartResult::Failed { .. }));
        assert!(!supervisor.status().running);
    }

    #[tokio::test]
    async fn a_missing_program_fails_cleanly() {
        let supervisor = Supervisor::new();
        let mut p = plan("", 9, 500);
        p.program = PathBuf::from("/nonexistent/engine");
        assert!(matches!(supervisor.start(p).await, StartResult::Failed { .. }));
    }
}
