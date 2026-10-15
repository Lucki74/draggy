//! Test doubles for the network and the log. Replies come from a script, every request is recorded, and nothing leaves the process.
#![allow(dead_code)]

use std::collections::HashMap;
use std::collections::VecDeque;
use std::fmt::Debug;
use std::future::{Future, ready};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use draggy_mcp::net::{Http, NetError, Request, Response};
use serde_json::{Value, json};
use tracing::field::{Field, Visit};
use tracing::span;
use tracing::{Event, Metadata, Subscriber};

/// One scripted answer: a response, or a failure to reach the server.
pub type Reply = Result<Response, NetError>;

enum Script {
    /// Replies in order, whatever the URL. An empty script fails the request.
    Queue(VecDeque<Reply>),
    /// One reply per URL. A URL with no route answers 404, as a server with no such document does.
    Routes(HashMap<String, Reply>),
}

struct State {
    script: Script,
    requests: Vec<Request>,
}

/// A fake HTTP client. Clones share the same script and the same record of requests.
#[derive(Clone)]
pub struct FakeHttp {
    state: Arc<Mutex<State>>,
}

impl FakeHttp {
    pub fn queue(replies: Vec<Reply>) -> Self {
        Self::with(Script::Queue(replies.into()))
    }

    pub fn routes(routes: Vec<(String, Reply)>) -> Self {
        Self::with(Script::Routes(routes.into_iter().collect()))
    }

    fn with(script: Script) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                script,
                requests: Vec::new(),
            })),
        }
    }

    /// Every request sent so far, in order.
    pub fn requests(&self) -> Vec<Request> {
        lock(&self.state).requests.clone()
    }

    fn answer(&self, request: &Request) -> Reply {
        let mut state = lock(&self.state);
        state.requests.push(request.clone());
        match &mut state.script {
            Script::Queue(replies) => replies
                .pop_front()
                .unwrap_or_else(|| Err(NetError::Failed("no scripted reply".to_owned()))),
            Script::Routes(routes) => routes.get(&request.url).cloned().unwrap_or_else(|| {
                Ok(Response {
                    status: 404,
                    headers: Vec::new(),
                    body: String::new(),
                })
            }),
        }
    }
}

impl Http for FakeHttp {
    fn send(&self, request: Request) -> impl Future<Output = Result<Response, NetError>> + Send {
        ready(self.answer(&request))
    }
}

/// A reply with a status and body, for a script.
pub fn reply(status: u16, body: &str) -> Reply {
    Ok(Response {
        status,
        headers: Vec::new(),
        body: body.to_owned(),
    })
}

/// A reply with a status, headers and body.
pub fn reply_with(status: u16, headers: &[(&str, &str)], body: &str) -> Reply {
    Ok(Response {
        status,
        headers: headers
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
        body: body.to_owned(),
    })
}

/// A JSON reply with status 200.
pub fn json_reply(body: &Value) -> Reply {
    reply(200, &body.to_string())
}

/// A request's headers as a JSON object, the form the fixtures compare.
pub fn headers_json(headers: &[(String, String)]) -> Value {
    Value::Object(
        headers
            .iter()
            .map(|(key, value)| (key.clone(), json!(value)))
            .collect(),
    )
}

/// Runs a future on a current-thread runtime, so the fake's ready futures complete without a network.
pub fn block_on<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .map(|runtime| runtime.block_on(future))
        .unwrap_or_else(|error| panic!("cannot start a runtime: {error}"))
}

/// Runs a body and returns the log lines written while it ran, as text: the level, the target, the message and the fields.
/// One subscriber serves the whole test binary, because per-thread subscribers race on tracing's shared callsite interest.
/// Lines from tests running at the same time can appear too, so a test checks for the text it wrote, not for an exact list.
pub fn capture<T>(body: impl FnOnce() -> T) -> (T, Vec<String>) {
    let logged = GLOBAL
        .get_or_init(|| {
            let logged = Logged::default();
            let _ = tracing::subscriber::set_global_default(logged.clone());
            logged
        })
        .clone();
    let start = logged.len();
    let value = body();
    (value, logged.since(start))
}

static GLOBAL: OnceLock<Logged> = OnceLock::new();

fn lock<T>(state: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Default)]
struct Logged(Arc<Mutex<Vec<String>>>);

impl Logged {
    fn len(&self) -> usize {
        lock(&self.0).len()
    }

    fn since(&self, start: usize) -> Vec<String> {
        lock(&self.0).get(start..).unwrap_or_default().to_vec()
    }
}

impl Subscriber for Logged {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _: &span::Attributes<'_>) -> span::Id {
        span::Id::from_u64(1)
    }

    fn record(&self, _: &span::Id, _: &span::Record<'_>) {}

    fn record_follows_from(&self, _: &span::Id, _: &span::Id) {}

    fn event(&self, event: &Event<'_>) {
        let mut fields = Fields(String::new());
        event.record(&mut fields);
        let line = format!(
            "{} {} {}",
            event.metadata().level(),
            event.metadata().target(),
            fields.0
        );
        lock(&self.0).push(line);
    }

    fn enter(&self, _: &span::Id) {}

    fn exit(&self, _: &span::Id) {}
}

/// Every field of one event, as text.
#[derive(Default)]
struct Fields(String);

impl Fields {
    fn push(&mut self, name: &str, value: &dyn Debug) {
        self.0.push_str(&format!(" {name}={value:?}"));
    }
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field.name(), &value);
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push(field.name(), &value);
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.push(field.name(), &value);
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.push(field.name(), &value);
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.push(field.name(), value);
    }
}
