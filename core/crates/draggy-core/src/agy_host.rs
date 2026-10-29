//! The Antigravity CLI (`agy`) as a model: the part of the adapter that touches processes and disk. The prompt, the
//! arguments and the event stream are decoded by the providers crate; this module spawns the CLI, reads its output and
//! keeps the user's acceptance of the terms warning.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use draggy_agent::agent_loop::{
    ChatRequest, ChunkStream, FinalCounts, ModelChunk, ModelClient, RepairRequest, TurnError,
};
use draggy_providers::agy::adapter::{
    AgyEvent, EventReader, MAX_STDERR, PERMISSION_MESSAGE, PROBE_MS, VERIFY_PROMPT, WATCHDOG_MS,
    exit_failure, judge_build, locate_agy, parse_models, permission_refused, result_failure,
    to_prompt, turn_args, usage_of,
};
use draggy_providers::types::TokenUsage;
use draggy_tools::spawn::{StdChild as Child, spawn_piped_blocking};
use serde_json::{Value, json};

use crate::error::CoreError;
use crate::records::AgyConfigRecord;

/// Shown before the first sign-in. Nothing runs until the user accepts it.
pub const TERMS_WARNING: &str = "Google's Antigravity FAQ says headless mode is meant for direct scripting and CI, and that using third-party software to reach Antigravity breaks its terms and can get the account suspended. Whether Draggy's use counts is Google's call, not Draggy's. Turn this on only if you accept that risk.";

/// The warning the shells show before the first sign-in.
#[uniffi::export]
pub fn agy_terms_warning() -> String {
    TERMS_WARNING.to_owned()
}

fn find_agy(forced: Option<&str>) -> Option<PathBuf> {
    let search = std::env::var("PATH").unwrap_or_default();
    let env_forced = std::env::var("DRAGGY_AGY_PATH").ok();
    locate_agy(
        forced.or(env_forced.as_deref()),
        &search,
        cfg!(windows),
        &|path: &Path| path.is_file(),
    )
}

fn spawn(binary: &Path, args: &[String], cwd: Option<&Path>) -> std::io::Result<Child> {
    spawn_piped_blocking(binary, args, cwd)
}

fn drain(mut pipe: impl Read + Send + 'static) -> Arc<Mutex<String>> {
    let text = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&text);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let mut shown = String::from_utf8_lossy(&bytes).into_owned();
        let mut end = shown.len().min(MAX_STDERR);
        while !shown.is_char_boundary(end) {
            end -= 1;
        }
        shown.truncate(end);
        *sink.lock().unwrap_or_else(PoisonError::into_inner) = shown;
    });
    text
}

/// Runs a short command and returns its stdout, stderr and exit code. The process is killed after `limit_ms`.
fn capture(
    binary: &Path,
    args: &[String],
    limit_ms: u64,
) -> Result<(String, String, Option<i32>), String> {
    let mut child = spawn(binary, args, None).map_err(|error| error.to_string())?;
    let out = drain(child.stdout.take().ok_or("no stdout")?);
    let err = drain(child.stderr.take().ok_or("no stderr")?);
    let deadline = Instant::now() + Duration::from_millis(limit_ms);
    let status = loop {
        match child.try_wait().ok().flatten() {
            Some(status) => break Some(status),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The Antigravity CLI did not answer in time.".to_owned());
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    };
    // The reader threads end when the pipes close, which is just after the process exits.
    std::thread::sleep(Duration::from_millis(60));
    let take =
        |text: &Arc<Mutex<String>>| text.lock().unwrap_or_else(PoisonError::into_inner).clone();
    Ok((take(&out), take(&err), status.and_then(|s| s.code())))
}

enum Piece {
    Line(String),
    End,
}

fn read_lines(stdout: impl Read + Send + 'static) -> Receiver<Piece> {
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer).into_owned();
                    if send.send(Piece::Line(line)).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = send.send(Piece::End);
    });
    receive
}

/// The messages of the loop as the role and content pairs the prompt builder reads.
fn messages_of(request: &ChatRequest) -> Vec<Value> {
    request
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect()
}

/// A model that answers through one `agy` process per turn. It has no tools: `agy` runs its own and Draggy does not
/// offer them.
pub struct AgyModel {
    binary: PathBuf,
    cwd: PathBuf,
}

impl AgyModel {
    pub fn new(binary: &str, cwd: PathBuf) -> Self {
        Self {
            binary: PathBuf::from(binary),
            cwd,
        }
    }
}

impl ModelClient for AgyModel {
    fn stream(&mut self, request: ChatRequest) -> Result<ChunkStream, TurnError> {
        let (prompt, _dropped) = to_prompt(&messages_of(&request));
        let model = Some(request.model.as_str()).filter(|m| !m.is_empty() && *m != "default");
        std::fs::create_dir_all(&self.cwd).map_err(|error| TurnError::Model(error.to_string()))?;
        let mut child =
            spawn(&self.binary, &turn_args(&prompt, model), Some(&self.cwd)).map_err(|error| {
                TurnError::Model(format!("Could not start the Antigravity CLI: {error}"))
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| TurnError::Model("The Antigravity CLI gave no output.".to_owned()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| TurnError::Model("The Antigravity CLI gave no output.".to_owned()))?;
        Ok(Box::new(AgyStream {
            child,
            lines: read_lines(stdout),
            stderr: drain(stderr),
            reader: EventReader::default(),
            started: Instant::now(),
            first_token: None,
            result: None,
            ended: false,
            done: false,
        }))
    }

    fn repair(&mut self, _request: RepairRequest) -> Option<String> {
        None
    }
}

struct AgyStream {
    child: Child,
    lines: Receiver<Piece>,
    stderr: Arc<Mutex<String>>,
    reader: EventReader,
    started: Instant,
    first_token: Option<Instant>,
    result: Option<Value>,
    /// The output has closed; the next call gives the verdict.
    ended: bool,
    done: bool,
}

impl AgyStream {
    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.done = true;
    }

    fn failed(&mut self, message: String) -> ModelChunk {
        self.stop();
        ModelChunk {
            error: Some(message),
            ..ModelChunk::default()
        }
    }

    fn finish(&mut self) -> ModelChunk {
        let code = self.child.wait().ok().and_then(|status| status.code());
        self.done = true;
        // The error reader ends a moment after the process does.
        std::thread::sleep(Duration::from_millis(60));
        match self.result.take() {
            Some(result) => match result_failure(&result) {
                Some(error) => ModelChunk {
                    error: Some(error.to_string()),
                    ..ModelChunk::default()
                },
                None => {
                    let usage = usage_of(result.get("usage").or_else(|| result.get("stats")));
                    ModelChunk {
                        done: Some(self.counts(
                            usage.prompt_tokens,
                            usage.output_tokens,
                            usage.tokens,
                        )),
                        ..ModelChunk::default()
                    }
                }
            },
            None => {
                let stderr = self
                    .stderr
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                ModelChunk {
                    error: Some(exit_failure(&stderr, code).to_string()),
                    ..ModelChunk::default()
                }
            }
        }
    }

    #[allow(clippy::cast_precision_loss)]
    fn counts(&self, prompt: u64, output: u64, split: Option<TokenUsage>) -> FinalCounts {
        let now = Instant::now();
        let first = self.first_token.unwrap_or(now);
        let prompt_ns = first.duration_since(self.started).as_nanos() as f64;
        let eval_ns = now.duration_since(first).as_nanos() as f64;
        FinalCounts {
            done_reason: Some("stop".to_owned()),
            prompt_eval_count: prompt as f64,
            eval_count: output as f64,
            prompt_eval_duration_ns: prompt_ns,
            eval_duration_ns: eval_ns,
            load_duration_ns: 0.0,
            total_duration_ns: prompt_ns + eval_ns,
            usage: split,
        }
    }

    /// Turns what the stream said into a chunk. `None` when it said nothing that shows.
    fn absorb(&mut self, events: Vec<AgyEvent>) -> Option<ModelChunk> {
        let mut text = String::new();
        for event in events {
            match event {
                AgyEvent::Init {
                    permission_mode, ..
                } => {
                    if permission_refused(permission_mode.as_deref()) {
                        return Some(self.failed(PERMISSION_MESSAGE.to_owned()));
                    }
                }
                AgyEvent::Delta(delta) => {
                    self.first_token.get_or_insert_with(Instant::now);
                    text.push_str(&delta);
                }
                AgyEvent::Result(result) => self.result = Some(result),
                AgyEvent::Tool { .. } | AgyEvent::Stray(_) => {}
            }
        }
        (!text.is_empty()).then(|| ModelChunk {
            content: text,
            ..ModelChunk::default()
        })
    }
}

impl Iterator for AgyStream {
    type Item = Result<ModelChunk, TurnError>;

    fn next(&mut self) -> Option<Self::Item> {
        let limit = Duration::from_millis(WATCHDOG_MS);
        loop {
            if self.done {
                return None;
            }
            if self.ended {
                return Some(Ok(self.finish()));
            }
            let left = limit.saturating_sub(self.started.elapsed());
            match self.lines.recv_timeout(left) {
                Ok(Piece::Line(line)) => {
                    let events = self.reader.push(&line);
                    if let Some(chunk) = self.absorb(events) {
                        return Some(Ok(chunk));
                    }
                }
                Ok(Piece::End) | Err(RecvTimeoutError::Disconnected) => {
                    self.ended = true;
                    let events = self.reader.end();
                    if let Some(chunk) = self.absorb(events) {
                        return Some(Ok(chunk));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Some(Ok(self.failed(
                        "The Antigravity CLI took too long and was stopped.".to_owned(),
                    )));
                }
            }
        }
    }
}

impl Drop for AgyStream {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// Where the account state lives, and the folder `agy` runs in so it never sees the user's files.
fn state_path(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

/// What the shells show about the Antigravity route.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq, Default)]
pub struct AgyStatus {
    /// The user accepted the terms warning.
    pub acknowledged: bool,
    /// A turn answered with the account that `agy` is signed in with.
    pub signed_in: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
}

/// The Antigravity account: whether the user accepted the warning, and whether `agy` answered.
#[derive(uniffi::Object)]
pub struct AgyAccount {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl AgyAccount {
    fn load(&self) -> AgyStatus {
        let text = std::fs::read_to_string(state_path(&self.dir)).unwrap_or_default();
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let flag = |name: &str| value.get(name).and_then(Value::as_bool).unwrap_or(false);
        let text = |name: &str| {
            value
                .get(name)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .filter(|s| !s.is_empty())
        };
        AgyStatus {
            acknowledged: flag("acknowledged"),
            signed_in: flag("signedIn"),
            binary: text("binary"),
            version: text("version"),
        }
    }

    fn save(&self, status: &AgyStatus) -> Result<(), CoreError> {
        std::fs::create_dir_all(&self.dir).map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?;
        let body = json!({
            "acknowledged": status.acknowledged,
            "signedIn": status.signed_in,
            "binary": status.binary,
            "version": status.version,
        });
        std::fs::write(state_path(&self.dir), body.to_string()).map_err(|error| {
            CoreError::Internal {
                message: error.to_string(),
            }
        })
    }

    fn working_dir(&self) -> PathBuf {
        self.dir.join("cwd")
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl AgyAccount {
    /// An account kept under `data_dir`, such as `~/.local/share/draggy/agy`.
    #[uniffi::constructor]
    pub fn new(data_dir: String) -> Arc<Self> {
        Arc::new(Self {
            dir: PathBuf::from(data_dir),
            lock: Mutex::new(()),
        })
    }

    pub fn status(&self) -> AgyStatus {
        self.load()
    }

    /// Signs in. The warning must be accepted first. Finds `agy`, checks the build and sends one short turn to prove
    /// the account answers. The CLI's own login is done in the CLI; Draggy never sees its credentials.
    pub async fn sign_in(&self, acknowledged: bool) -> Result<AgyStatus, CoreError> {
        if !acknowledged {
            return Err(CoreError::Invalid {
                message: "Accept the warning to turn on the Antigravity route.".to_owned(),
            });
        }
        let current = self.load();
        let forced = current.binary.clone();
        let dir = self.working_dir();
        let found = tokio::task::spawn_blocking(move || probe(forced.as_deref(), &dir))
            .await
            .map_err(|error| CoreError::Internal {
                message: error.to_string(),
            })??;
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let status = AgyStatus {
            acknowledged: true,
            signed_in: true,
            binary: Some(found.0),
            version: Some(found.1),
        };
        self.save(&status)?;
        Ok(status)
    }

    /// Forgets the sign-in. The accepted warning stays, so signing back in does not ask again.
    pub fn sign_out(&self) -> Result<AgyStatus, CoreError> {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let status = AgyStatus {
            signed_in: false,
            ..self.load()
        };
        self.save(&status)?;
        Ok(status)
    }

    /// The model slugs `agy models` lists.
    pub async fn models(&self) -> Result<Vec<String>, CoreError> {
        let status = self.load();
        let binary = ready_binary(&status)?;
        tokio::task::spawn_blocking(move || {
            let (out, _err, _code) = capture(&binary, &["models".to_owned()], PROBE_MS)
                .map_err(|message| CoreError::Model { message })?;
            Ok(parse_models(&out))
        })
        .await
        .map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?
    }

    /// The session setting that routes a chat through `agy`. Needs a sign-in.
    pub fn config(&self, model: Option<String>) -> Result<AgyConfigRecord, CoreError> {
        let status = self.load();
        let binary = ready_binary(&status)?.to_string_lossy().into_owned();
        Ok(AgyConfigRecord {
            binary,
            model: model.unwrap_or_default(),
            work_dir: self.working_dir().to_string_lossy().into_owned(),
        })
    }
}

fn ready_binary(status: &AgyStatus) -> Result<PathBuf, CoreError> {
    if !status.acknowledged || !status.signed_in {
        return Err(CoreError::Invalid {
            message: "Sign in to the Antigravity route first.".to_owned(),
        });
    }
    status
        .binary
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| CoreError::Invalid {
            message: "Sign in to the Antigravity route first.".to_owned(),
        })
}

/// Finds the CLI, checks its build and proves the account with one short turn. Returns the path and the version.
fn probe(forced: Option<&str>, work_dir: &Path) -> Result<(String, String), CoreError> {
    let model_error = |message: String| CoreError::Model { message };
    let binary = find_agy(forced).ok_or_else(|| CoreError::Invalid {
        message: "The Antigravity CLI (agy) was not found. Install it, or set DRAGGY_AGY_PATH."
            .to_owned(),
    })?;
    let (version, _, _) =
        capture(&binary, &["--version".to_owned()], PROBE_MS).map_err(model_error)?;
    let (help, _, _) = capture(&binary, &["--help".to_owned()], PROBE_MS).map_err(model_error)?;
    let verdict = judge_build(version.trim(), &help);
    if !verdict.ok {
        return Err(CoreError::Invalid {
            message: verdict.reason.unwrap_or_default(),
        });
    }
    std::fs::create_dir_all(work_dir).map_err(|error| CoreError::Internal {
        message: error.to_string(),
    })?;
    let mut model = AgyModel::new(&binary.to_string_lossy(), work_dir.to_path_buf());
    let request = ChatRequest {
        model: String::new(),
        num_ctx: 0,
        messages: vec![draggy_agent::agent_loop::WireMessage {
            role: "user".to_owned(),
            content: VERIFY_PROMPT.to_owned(),
            thinking: None,
            images: Vec::new(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            provider_state: None,
            draggy_ref: None,
        }],
        tools: None,
        think: None,
        thinking_level: None,
    };
    let stream = model.stream(request).map_err(|error| CoreError::Model {
        message: error.to_string(),
    })?;
    for item in stream {
        let chunk = item.map_err(|error| CoreError::Model {
            message: error.to_string(),
        })?;
        if let Some(message) = chunk.error {
            return Err(CoreError::Model { message });
        }
        if chunk.done.is_some() {
            return Ok((binary.to_string_lossy().into_owned(), verdict.version));
        }
    }
    Err(CoreError::Model {
        message: "The Antigravity CLI ended without an answer.".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_warning_names_the_risk() {
        assert!(TERMS_WARNING.contains("suspended"));
        assert_eq!(agy_terms_warning(), TERMS_WARNING);
    }

    #[test]
    fn a_missing_acceptance_blocks_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let account = AgyAccount::new(dir.path().to_string_lossy().into_owned());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let error = runtime.block_on(account.sign_in(false)).unwrap_err();
        assert!(matches!(error, CoreError::Invalid { .. }));
        assert!(!account.status().acknowledged);
    }

    #[test]
    fn sign_out_keeps_the_acceptance() {
        let dir = tempfile::tempdir().unwrap();
        let account = AgyAccount::new(dir.path().to_string_lossy().into_owned());
        account
            .save(&AgyStatus {
                acknowledged: true,
                signed_in: true,
                binary: Some("/x/agy".to_owned()),
                version: Some("1".to_owned()),
            })
            .unwrap();
        let after = account.sign_out().unwrap();
        assert!(after.acknowledged && !after.signed_in);
        assert!(account.config(None).is_err());
    }

    #[test]
    fn a_signed_out_account_gives_no_config() {
        let dir = tempfile::tempdir().unwrap();
        let account = AgyAccount::new(dir.path().to_string_lossy().into_owned());
        assert!(account.config(None).is_err());
    }
}
