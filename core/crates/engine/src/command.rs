//! Runs the helper programs the engine asks questions of (nvidia-smi, reg.exe, sysctl, llama-server --version).
//! Every process starts through `draggy_tools::spawn`, so it is hidden and never goes through a shell.

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use draggy_tools::spawn::{self, CancelToken, CaptureLimits, Captured, SpawnOptions};

/// One program to run: its arguments, folder, complete environment and time limit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// The complete environment when set; the caller's own environment when None.
    pub env: Option<Vec<(String, String)>>,
    pub timeout: Duration,
}

impl ProcessSpec {
    pub fn new(program: impl Into<PathBuf>, args: &[&str], timeout: Duration) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
            cwd: None,
            env: None,
            timeout,
        }
    }
}

/// What a program printed and whether it exited with status 0 on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a program. None when it could not start.
pub trait CommandRunner: Sync {
    fn run(&self, spec: ProcessSpec) -> impl Future<Output = Option<CommandOutput>> + Send;
}

/// [`CommandRunner`] over `draggy_tools::spawn::run`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessRunner;

impl CommandRunner for ProcessRunner {
    async fn run(&self, spec: ProcessSpec) -> Option<CommandOutput> {
        let options = SpawnOptions {
            cwd: spec.cwd,
            env: spec.env.map(|vars| {
                vars.into_iter()
                    .map(|(key, value)| (key.into(), value.into()))
                    .collect()
            }),
            timeout: spec.timeout,
            cancel: CancelToken::new(),
            merge_output: false,
            capture: CaptureLimits::unbounded(),
        };
        match spawn::run(&spec.program, &spec.args, options).await {
            Ok(output) => Some(CommandOutput {
                success: output.success(),
                stdout: joined(&output.stdout),
                stderr: joined(&output.stderr),
            }),
            Err(error) => {
                tracing::warn!(target: "engine.probe", error = %error, "helper program did not start");
                None
            }
        }
    }
}

fn joined(captured: &Captured) -> String {
    format!("{}{}", captured.head, captured.tail)
}

/// The text a program printed when it exited with status 0, or None. Non-zero exits and failed starts both read as None.
pub async fn run_text(
    runner: &impl CommandRunner,
    program: &str,
    args: &[&str],
    timeout_ms: u64,
) -> Option<String> {
    let spec = ProcessSpec::new(program, args, Duration::from_millis(timeout_ms));
    runner
        .run(spec)
        .await
        .filter(|output| output.success)
        .map(|output| output.stdout)
}
