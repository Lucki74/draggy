//! Test doubles for the client. One script answers both the stdio process and the HTTP transport, so a session reads the
//! same whichever way the server is reached. Nothing leaves the process.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::future::{Future, ready};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use draggy_mcp::log::{Level, Log};
use draggy_mcp::net::{Http, Method, NetError, Request, Response};
use draggy_mcp::ports::{BoxFuture, Clock, MemoryVault, Ports, Provisioner};
use draggy_mcp::process::{Event, Launcher, Process};
use draggy_mcp::provision::InstallCommand;
use serde_json::{Map, Value, json};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

/// How the server answers one request.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Result(Value),
    Error(String),
    /// No answer at all, so the client's timer decides. Stdio only.
    Silent,
    /// The process exits instead of answering.
    Exit(i32),
    /// An HTTP status with a body.
    Status {
        status: u16,
        body: String,
    },
    /// The request never reaches the server.
    Fail(String),
    /// The process reports an error without ending, such as a broken pipe.
    ProcessError(String),
}

/// One scripted answer, with what surrounds it.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub answer: Answer,
    /// Raw stdout chunks written before the answer.
    pub before: Vec<String>,
    /// Stderr lines written before the answer.
    pub stderr: Vec<String>,
    /// Whether the answer arrives in two chunks.
    pub split: bool,
    /// Headers on an HTTP answer.
    pub headers: Vec<(String, String)>,
}

/// One server run: what it writes at start, how it stops, and the answers to its requests in order.
#[derive(Debug, Clone, Default)]
pub struct Session {
    pub stop_code: i32,
    pub stderr: Vec<String>,
    pub replies: VecDeque<Reply>,
    /// Set when the program cannot be started at all.
    pub spawn_error: Option<String>,
}

impl Session {
    /// Reads one session from a fixture. An answer is the first of `result`, `error`, `silent`, `exit`, `status` or `fail` present.
    pub fn from_json(value: &Value) -> Self {
        Self {
            stop_code: value.get("stop_code").and_then(Value::as_i64).unwrap_or(0) as i32,
            stderr: strings(value.get("stderr")),
            replies: value
                .get("replies")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(reply_from_json)
                .collect(),
            spawn_error: value
                .get("spawn_error")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }
}

fn reply_from_json(value: &Value) -> Reply {
    let answer = if let Some(result) = value.get("result") {
        Answer::Result(result.clone())
    } else if let Some(error) = value.get("error") {
        Answer::Error(
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        )
    } else if let Some(message) = value.get("process_error") {
        Answer::ProcessError(message.as_str().unwrap_or_default().to_owned())
    } else if value.get("silent").is_some() {
        Answer::Silent
    } else if let Some(code) = value.get("exit") {
        Answer::Exit(code.as_i64().unwrap_or(1) as i32)
    } else if let Some(status) = value.get("status") {
        Answer::Status {
            status: status.as_u64().unwrap_or(500) as u16,
            body: value
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        }
    } else {
        Answer::Fail(
            value
                .get("fail")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        )
    };

    let headers = value
        .get("headers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_owned()))
        .collect();

    Reply {
        answer,
        before: strings(value.get("before")),
        stderr: strings(value.get("stderr")),
        split: value.get("split").and_then(Value::as_bool).unwrap_or(false),
        headers,
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

#[derive(Default)]
struct Script {
    sessions: VecDeque<Session>,
    current: Session,
    wire: Vec<Value>,
}

/// The script shared by everything a test starts. `begin_session` moves to the next session, as a start does.
#[derive(Clone, Default)]
pub struct Fake {
    state: Arc<Mutex<Script>>,
}

impl Fake {
    pub fn new(sessions: Vec<Session>) -> Self {
        Self {
            state: Arc::new(Mutex::new(Script {
                sessions: sessions.into(),
                ..Script::default()
            })),
        }
    }

    /// Moves to the next session. A start with no session left gets an empty one, which answers nothing.
    pub fn begin_session(&self) {
        let mut script = lock(&self.state);
        script.current = script.sessions.pop_front().unwrap_or_default();
    }

    /// Every message the client sent, in order. HTTP requests are recorded with their key headers.
    pub fn wire(&self) -> Vec<Value> {
        lock(&self.state).wire.clone()
    }

    fn record(&self, entry: Value) {
        lock(&self.state).wire.push(entry);
    }

    fn take_reply(&self) -> Option<Reply> {
        lock(&self.state).current.replies.pop_front()
    }

    fn current_session(&self) -> (i32, Vec<String>) {
        let script = lock(&self.state);
        (script.current.stop_code, script.current.stderr.clone())
    }

    fn spawn_error(&self) -> Option<String> {
        lock(&self.state).current.spawn_error.clone()
    }
}

fn lock<T>(state: &Mutex<T>) -> MutexGuard<'_, T> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A reply with nothing around it.
pub fn reply(answer: Answer) -> Reply {
    Reply {
        answer,
        before: Vec::new(),
        stderr: Vec::new(),
        split: false,
        headers: Vec::new(),
    }
}

/// Starts processes from the shared script.
#[derive(Clone)]
pub struct FakeLauncher {
    pub fake: Fake,
}

impl Launcher for FakeLauncher {
    type Process = ScriptedProcess;

    fn program_name(&self) -> String {
        "node".to_owned()
    }

    fn spawn(
        &self,
        _args: &[String],
        _env: &Map<String, Value>,
    ) -> Result<ScriptedProcess, String> {
        if let Some(message) = self.fake.spawn_error() {
            return Err(message);
        }
        let (events, receiver) = mpsc::unbounded_channel();
        let (stop_code, stderr) = self.fake.current_session();
        for line in stderr {
            let _ = events.send(Event::Stderr(format!("{line}\n")));
        }
        Ok(ScriptedProcess {
            fake: self.fake.clone(),
            stop_code,
            events,
            receiver: AsyncMutex::new(receiver),
            closed: Mutex::new(false),
        })
    }
}

/// A process whose answers come from the script. Writes are answered at once, as a real server answers within the turn.
pub struct ScriptedProcess {
    fake: Fake,
    stop_code: i32,
    events: mpsc::UnboundedSender<Event>,
    receiver: AsyncMutex<mpsc::UnboundedReceiver<Event>>,
    closed: Mutex<bool>,
}

impl Process for ScriptedProcess {
    fn write_line(&self, line: String) -> impl Future<Output = bool> + Send {
        ready(self.handle(&line))
    }

    async fn next_event(&self) -> Event {
        let mut receiver = self.receiver.lock().await;
        receiver.recv().await.unwrap_or(Event::Exited(None))
    }

    fn stop(&self) {
        let closed = *lock_flag(&self.closed);
        if !closed {
            self.exit(self.stop_code);
        }
    }
}

impl ScriptedProcess {
    fn handle(&self, line: &str) -> bool {
        if *lock_flag(&self.closed) {
            return false;
        }

        let message: Value = serde_json::from_str(line.trim()).unwrap_or(Value::Null);
        self.fake.record(message.clone());

        let Some(id) = message.get("id").cloned() else {
            return true;
        };
        if let Some(reply) = self.fake.take_reply() {
            self.answer(id, reply);
        }
        true
    }

    fn answer(&self, id: Value, reply: Reply) {
        for chunk in reply.before {
            self.push(Event::Stdout(chunk));
        }
        for line in reply.stderr {
            self.push(Event::Stderr(format!("{line}\n")));
        }

        if let Answer::ProcessError(message) = reply.answer {
            self.push(Event::Failed(message));
            return;
        }

        let envelope = match reply.answer {
            Answer::Silent | Answer::Status { .. } | Answer::Fail(_) => return,
            Answer::ProcessError(_) => return,
            Answer::Exit(code) => return self.exit(code),
            Answer::Result(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Answer::Error(message) => {
                json!({"jsonrpc": "2.0", "id": id, "error": {"message": message}})
            }
        };

        let text = format!("{envelope}\n");
        if reply.split {
            let middle = text.len() / 2;
            self.push(Event::Stdout(text[..middle].to_owned()));
            self.push(Event::Stdout(text[middle..].to_owned()));
        } else {
            self.push(Event::Stdout(text));
        }
    }

    fn exit(&self, code: i32) {
        *lock_flag(&self.closed) = true;
        self.push(Event::Exited(Some(code)));
    }

    fn push(&self, event: Event) {
        let _ = self.events.send(event);
    }
}

fn lock_flag(flag: &Mutex<bool>) -> MutexGuard<'_, bool> {
    flag.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the provisioner knows, shared so a test can read back the installs it was asked for.
#[derive(Debug, Default)]
pub struct ProvisionState {
    pub ready: bool,
    pub npm: bool,
    pub installed: Vec<String>,
    /// The outcome an install reports. An install that succeeds makes its package found.
    pub install_outcome: Option<Result<(), String>>,
    /// The arguments of each install asked for.
    pub installs: Vec<Vec<String>>,
    /// Whether a successful install makes its package found. False models an install that leaves no entry point.
    pub adds_on_install: bool,
}

/// A provisioner the test scripts: which packages are on disk, whether npm exists, and how an install ends.
#[derive(Clone)]
pub struct FakeProvisioner {
    pub state: Arc<Mutex<ProvisionState>>,
}

impl FakeProvisioner {
    pub fn new(ready: bool, npm: bool, installed: &[&str]) -> Self {
        Self {
            state: Arc::new(Mutex::new(ProvisionState {
                ready,
                npm,
                installed: installed.iter().map(|pkg| (*pkg).to_owned()).collect(),
                install_outcome: None,
                installs: Vec::new(),
                adds_on_install: true,
            })),
        }
    }
}

impl Provisioner for FakeProvisioner {
    fn ready(&self) -> bool {
        lock_provision(&self.state).ready
    }

    fn install_command(&self, package: &str) -> Option<InstallCommand> {
        let state = lock_provision(&self.state);
        state.npm.then(|| InstallCommand {
            file: "npm".to_owned(),
            args: vec!["install".to_owned(), package.to_owned()],
        })
    }

    fn entry_point(&self, package: &str) -> Option<String> {
        lock_provision(&self.state)
            .installed
            .iter()
            .any(|found| found == package)
            .then(|| format!("/fake/node_modules/{package}/index.js"))
    }

    fn install(&self, command: &InstallCommand) -> BoxFuture<'_, Result<(), String>> {
        let mut state = lock_provision(&self.state);
        state.installs.push(command.args.clone());
        let outcome = state.install_outcome.clone().unwrap_or(Ok(()));
        if let (Ok(()), true, Some(package)) = (
            &outcome,
            state.adds_on_install,
            command.args.get(1).cloned(),
        ) {
            state.installed.push(package);
        }
        Box::pin(std::future::ready(outcome))
    }
}

fn lock_provision(state: &Mutex<ProvisionState>) -> MutexGuard<'_, ProvisionState> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A clock that always reads the same time.
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub f64);

impl Clock for FixedClock {
    fn now_ms(&self) -> f64 {
        self.0
    }
}

/// The ports a test runs with: an empty vault, the given provisioner and a clock at zero.
pub fn ports(provisioner: FakeProvisioner) -> Ports {
    Ports {
        vault: Arc::new(MemoryVault::default()),
        provisioner: Arc::new(provisioner),
        clock: Arc::new(FixedClock(0.0)),
    }
}

/// HTTP answers from the same script. Each request takes the next answer of the current session.
#[derive(Clone)]
pub struct FakeHttp {
    pub fake: Fake,
}

impl Http for FakeHttp {
    fn send(&self, request: Request) -> impl Future<Output = Result<Response, NetError>> + Send {
        ready(self.answer(request))
    }
}

impl FakeHttp {
    fn answer(&self, request: Request) -> Result<Response, NetError> {
        let headers = key_headers(&request.headers);

        if request.method == Method::Delete {
            self.fake
                .record(json!({"http": "DELETE", "headers": headers, "message": Value::Null}));
            return Ok(response(200, Vec::new(), String::new()));
        }

        let message: Value = request
            .body
            .as_deref()
            .and_then(|body| serde_json::from_str(body).ok())
            .unwrap_or(Value::Null);
        self.fake
            .record(json!({"http": "POST", "headers": headers, "message": message.clone()}));

        let Some(id) = message.get("id").cloned() else {
            return Ok(response(202, Vec::new(), String::new()));
        };

        let Some(reply) = self.fake.take_reply() else {
            return Ok(response(500, Vec::new(), String::new()));
        };

        match reply.answer {
            Answer::Result(result) => Ok(json_response(
                &json!({"jsonrpc": "2.0", "id": id, "result": result}),
                reply.headers,
            )),
            Answer::Error(message) => Ok(json_response(
                &json!({"jsonrpc": "2.0", "id": id, "error": {"message": message}}),
                reply.headers,
            )),
            Answer::Status { status, body } => Ok(response(status, reply.headers, body)),
            Answer::Fail(message) => Err(NetError::Failed(message)),
            Answer::Silent | Answer::Exit(_) | Answer::ProcessError(_) => {
                Ok(response(500, Vec::new(), String::new()))
            }
        }
    }
}

fn response(status: u16, headers: Vec<(String, String)>, body: String) -> Response {
    Response {
        status,
        headers,
        body,
    }
}

fn json_response(body: &Value, extra: Vec<(String, String)>) -> Response {
    let mut headers = vec![("content-type".to_owned(), "application/json".to_owned())];
    headers.extend(extra);
    response(200, headers, body.to_string())
}

/// The API-key headers and the bearer header, under lowercase names whatever case the client used. Other headers are not recorded.
fn key_headers(headers: &[(String, String)]) -> Value {
    let mut object = Map::new();
    // The bearer header only appears when a token is held, which no fixture does.
    for name in ["x-consumer-api-key", "x-api-key", "authorization"] {
        if let Some((_, value)) = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
        {
            object.insert(name.to_owned(), json!(value));
        }
    }
    Value::Object(object)
}

/// Keeps every log line as level, scope, message and data, in the order written.
#[derive(Default)]
pub struct Recorder {
    lines: Mutex<Vec<Value>>,
}

impl Recorder {
    pub fn lines(&self) -> Vec<Value> {
        lock(&self.lines).clone()
    }
}

impl Log for Recorder {
    fn line(&self, level: Level, scope: &str, message: &str, data: Value) {
        lock(&self.lines).push(json!({
            "level": level.as_str(),
            "scope": scope,
            "msg": message,
            "data": data,
        }));
    }
}
