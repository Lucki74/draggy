//! The `run-code` channel: runs a short Python or JavaScript program in a scratch folder and returns what it
//! printed. Port of runner.cjs `runCode`. Python comes from PATH; JavaScript runs on the node.exe sidecar.

use std::ffi::OsString;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use draggy_engine::command::{ProcessRunner, run_text};
use draggy_tools::spawn::{CancelToken, CaptureLimits, SpawnOptions, run};
use serde_json::{Value, json};
use tauri::AppHandle;

use super::{IpcError, Registry};
use crate::mcp::config::text;

const DEFAULT_TIMEOUT: Duration = Duration::from_millis(20_000);
const MIN_TIMEOUT: Duration = Duration::from_millis(1_000);
const MAX_TIMEOUT: Duration = Duration::from_millis(120_000);
const MAX_OUTPUT_CHARS: usize = 20_000;
const MAX_SOURCE_CHARS: usize = 200_000;
/// How long shutdown waits for killed runs to finish before the app goes.
const STOP_WAIT: Duration = Duration::from_secs(3);

/// Every run in flight, so shutdown can stop them. A run takes itself out when it ends.
static LIVE: Mutex<Vec<(u64, CancelToken)>> = Mutex::new(Vec::new());
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "run-code" => run_code);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Language {
    Python,
    JavaScript,
}

impl Language {
    /// The language a renderer name means, aliases included. None for anything else.
    fn parse(name: &str) -> Option<Self> {
        match name.trim().to_lowercase().as_str() {
            "python" | "py" | "python3" => Some(Self::Python),
            "javascript" | "js" | "node" | "nodejs" => Some(Self::JavaScript),
            _ => None,
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Python => "python",
            Self::JavaScript => "javascript",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Python => ".py",
            Self::JavaScript => ".mjs",
        }
    }
}

/// The run's time limit: the request's value clamped to one second to two minutes, default twenty seconds.
fn time_limit(value: Option<&Value>) -> Duration {
    let requested = match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(digits)) => digits.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    };
    if !requested.is_finite() || requested == 0.0 {
        return DEFAULT_TIMEOUT;
    }
    Duration::from_millis(requested as u64).clamp(MIN_TIMEOUT, MAX_TIMEOUT)
}

/// The first `MAX_OUTPUT_CHARS` characters of a stream.
fn head(text: &str) -> String {
    text.chars().take(MAX_OUTPUT_CHARS).collect()
}

/// The environment a run gets: only the basics, with the scratch folder as home and temp.
fn minimal_env(workdir: &Path) -> Vec<(OsString, OsString)> {
    let home = workdir.as_os_str().to_owned();
    let inherited = |name: &str| std::env::var_os(name).unwrap_or_default();
    vec![
        ("PATH".into(), inherited("PATH")),
        ("HOME".into(), home.clone()),
        ("USERPROFILE".into(), home.clone()),
        ("TMPDIR".into(), home.clone()),
        ("TEMP".into(), home.clone()),
        ("TMP".into(), home),
        ("SYSTEMROOT".into(), inherited("SYSTEMROOT")),
        ("COMSPEC".into(), inherited("COMSPEC")),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("PYTHONUNBUFFERED".into(), "1".into()),
        ("NO_COLOR".into(), "1".into()),
        ("LANG".into(), "C.UTF-8".into()),
    ]
}

/// The node.exe sidecar, which runs JavaScript programs and stdio servers.
fn node_program() -> String {
    crate::mcp::node_path().to_string_lossy().into_owned()
}

/// The first Python the machine answers to, as the runner probe finds it.
async fn python_program() -> Option<&'static str> {
    for candidate in ["python", "py"] {
        if run_text(&ProcessRunner, candidate, &["--version"], 5000)
            .await
            .is_some()
        {
            return Some(candidate);
        }
    }
    None
}

async fn run_code(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let data_dir = crate::paths::data_dir(std::env::var_os("APPDATA")).map_err(IpcError::Failed)?;
    Ok(execute(
        &data_dir.join("code_runs"),
        args.first(),
        args.get(1),
        args.get(2),
    )
    .await)
}

/// Runs one program and answers in the renderer's shape. Every failure is an answer, never an error.
async fn execute(
    runs_dir: &Path,
    language: Option<&Value>,
    source: Option<&Value>,
    timeout: Option<&Value>,
) -> Value {
    let name = text(language);
    let Some(kind) = Language::parse(&name) else {
        return json!({
            "success": false,
            "error": format!("Unsupported language \"{name}\". Use python or javascript."),
        });
    };
    let code = text(source);
    if code.trim().is_empty() {
        return json!({ "success": false, "error": "No source code provided." });
    }
    if code.chars().count() > MAX_SOURCE_CHARS {
        return json!({ "success": false, "error": "Source is too long to run." });
    }
    let program = match kind {
        Language::Python => match python_program().await {
            Some(program) => program.to_owned(),
            None => {
                return json!({
                    "success": false,
                    "error": "Python is not installed on this machine, so Python code cannot be run here.",
                });
            }
        },
        Language::JavaScript => node_program(),
    };

    let workdir = runs_dir.join(random_name());
    let script_name = format!("main{}", kind.extension());
    let script = workdir.join(&script_name);
    if let Err(error) =
        std::fs::create_dir_all(&workdir).and_then(|()| std::fs::write(&script, code.as_bytes()))
    {
        return json!({ "success": false, "error": error.to_string() });
    }

    let token = CancelToken::new();
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    LIVE.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push((id, token.clone()));
    let options = SpawnOptions {
        cwd: Some(workdir.clone()),
        env: Some(minimal_env(&workdir)),
        timeout: time_limit(timeout),
        cancel: token,
        merge_output: false,
        capture: CaptureLimits {
            limit: MAX_OUTPUT_CHARS,
            head: MAX_OUTPUT_CHARS,
            tail: 0,
        },
    };
    let started = Instant::now();
    let outcome = run(&program, &[script.to_string_lossy().into_owned()], options).await;
    LIVE.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .retain(|(known, _)| *known != id);

    let produced: Vec<String> = std::fs::read_dir(&workdir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| *name != script_name)
                .collect()
        })
        .unwrap_or_default();
    let _ = std::fs::remove_dir_all(&workdir);

    match outcome {
        Err(error) => json!({ "success": false, "error": error.to_string() }),
        Ok(output) => json!({
            "success": output.success(),
            "exitCode": output.exit_code,
            "signal": output.signal,
            "timedOut": output.timed_out,
            "stdout": head(&output.stdout.head),
            "stderr": head(&output.stderr.head),
            "truncated": output.stdout.is_cut() || output.stderr.is_cut(),
            "durationMs": started.elapsed().as_millis() as u64,
            "language": kind.key(),
            "files": produced,
        }),
    }
}

/// A 12-character hex folder name from the system's random source.
fn random_name() -> String {
    let mut bytes = [0u8; 6];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Stops every run still going and waits briefly for each to be killed. Called as the app exits.
pub fn stop_all() {
    let runs: Vec<CancelToken> = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .map(|(_, token)| token.clone())
        .collect();
    for token in &runs {
        token.cancel();
    }
    let deadline = Instant::now() + STOP_WAIT;
    while Instant::now() < deadline {
        if LIVE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_names_and_aliases_resolve() {
        assert_eq!(Language::parse("PY"), Some(Language::Python));
        assert_eq!(Language::parse(" node "), Some(Language::JavaScript));
        assert_eq!(Language::parse("ruby"), None);
    }

    #[test]
    fn the_time_limit_is_clamped() {
        assert_eq!(time_limit(None), DEFAULT_TIMEOUT);
        assert_eq!(time_limit(Some(&json!(0))), DEFAULT_TIMEOUT);
        assert_eq!(time_limit(Some(&json!(10))), MIN_TIMEOUT);
        assert_eq!(time_limit(Some(&json!(999_999))), MAX_TIMEOUT);
        assert_eq!(
            time_limit(Some(&json!("5000"))),
            Duration::from_millis(5000)
        );
    }

    #[test]
    fn output_is_cut_to_the_limit() {
        let long = "a".repeat(MAX_OUTPUT_CHARS + 5);
        assert_eq!(head(&long).chars().count(), MAX_OUTPUT_CHARS);
    }

    #[test]
    fn the_run_env_points_home_at_the_scratch_folder() {
        let env = minimal_env(Path::new("C:/scratch/abc"));
        let temp = env.iter().find(|(name, _)| name == "TEMP").unwrap();
        assert_eq!(temp.1, OsString::from("C:/scratch/abc"));
    }

    #[test]
    fn random_names_are_twelve_hex_characters() {
        let name = random_name();
        assert_eq!(name.len(), 12);
        assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
