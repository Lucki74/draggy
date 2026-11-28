//! The Telegram bot gateway. The bot token lives in the keystore and only the HTTP transport here
//! ever holds it. Everything that decides what an update means is plain state in `State`, so the
//! pairing, the paired-only rule and the approval buttons are tested without a network.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

/// How long a pairing code stays valid.
pub const PAIR_TTL_SECS: u64 = 600;
/// Wrong codes allowed before pairing locks.
pub const MAX_WRONG_CODES: u32 = 5;
/// How long pairing stays locked after too many wrong codes.
pub const LOCK_SECS: u64 = 600;
/// An approval nobody answers in this time is denied.
pub const APPROVAL_TTL_SECS: u64 = 600;
/// Telegram refuses a message over 4096 characters; a margin keeps multi-byte text safe.
pub const CHUNK_CHARS: usize = 4000;
/// Longest incoming text handed to the renderer.
const MAX_INCOMING_CHARS: usize = 16_000;
/// The long poll's server-side wait.
pub const LONG_POLL_SECS: u64 = 30;

/// A chat the user paired.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Paired {
    pub chat_id: i64,
    pub name: String,
}

/// What a paired chat asked for with a slash command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    New,
    Stop,
}

/// What the gateway does about one update.
#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Message {
        chat_id: i64,
        text: String,
        command: Option<Command>,
    },
    Send {
        chat_id: i64,
        text: String,
    },
    AnswerCallback {
        id: String,
        text: String,
    },
    Resolve {
        approval_id: String,
        allow: bool,
    },
    Edit {
        chat_id: i64,
        message_id: i64,
        text: String,
    },
    PairedChanged,
}

struct Pending {
    chat_id: i64,
    approval_id: String,
    asked_at: u64,
}

/// Pairing, the paired chats and the approvals waiting on a button.
#[derive(Default)]
pub struct State {
    paired: Vec<Paired>,
    code: Option<(String, u64)>,
    wrong: u32,
    locked_until: u64,
    pending: HashMap<u64, Pending>,
    next_token: u64,
}

/// Equal without stopping at the first different byte.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for index in 0..a.len().max(b.len()) {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        diff |= usize::from(left ^ right);
    }
    diff == 0
}

/// Splits text into pieces of at most `limit` characters, at a line break when one is near the end.
pub fn chunk(text: &str, limit: usize) -> Vec<String> {
    let mut parts = Vec::new();
    let mut rest: Vec<char> = text.chars().collect();
    while rest.len() > limit {
        let window = &rest[..limit];
        let cut = window
            .iter()
            .rposition(|c| *c == '\n')
            .filter(|at| *at > limit / 2)
            .map_or(limit, |at| at + 1);
        parts.push(rest[..cut].iter().collect());
        rest.drain(..cut);
    }
    if !rest.is_empty() || parts.is_empty() {
        parts.push(rest.into_iter().collect());
    }
    parts
}

fn chat_id_of(chat: &Value) -> Option<i64> {
    if chat.get("type").and_then(Value::as_str) != Some("private") {
        return None;
    }
    chat.get("id").and_then(Value::as_i64)
}

fn name_of(from: Option<&Value>) -> String {
    let field = |key: &str| {
        from.and_then(|from| from.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    field("username")
        .map(|name| format!("@{name}"))
        .or_else(|| field("first_name"))
        .unwrap_or_default()
        .chars()
        .take(64)
        .collect()
}

impl State {
    pub fn with_paired(paired: Vec<Paired>) -> Self {
        Self {
            paired,
            ..Self::default()
        }
    }

    pub fn paired(&self) -> &[Paired] {
        &self.paired
    }

    pub fn is_paired(&self, chat_id: i64) -> bool {
        self.paired.iter().any(|one| one.chat_id == chat_id)
    }

    /// Opens a pairing window with `code`. Err holds the seconds left on a lock.
    pub fn start_pairing(&mut self, code: String, now: u64) -> Result<u64, u64> {
        if now < self.locked_until {
            return Err(self.locked_until - now);
        }
        let expires = now + PAIR_TTL_SECS;
        self.code = Some((code, expires));
        Ok(expires)
    }

    /// The open pairing code and when it expires, if one is open at `now`.
    pub fn pairing(&self, now: u64) -> Option<(&str, u64)> {
        self.code
            .as_ref()
            .filter(|(_, expires)| now < *expires)
            .map(|(code, expires)| (code.as_str(), *expires))
    }

    /// Seconds pairing stays locked, zero when it is not.
    pub fn locked_secs(&self, now: u64) -> u64 {
        self.locked_until.saturating_sub(now)
    }

    pub fn cancel_pairing(&mut self) {
        self.code = None;
    }

    /// Unpairs a chat. Its waiting approvals are denied.
    pub fn unpair(&mut self, chat_id: i64) -> Vec<Action> {
        let before = self.paired.len();
        self.paired.retain(|one| one.chat_id != chat_id);
        let mut actions = self.deny_where(|pending| pending.chat_id == chat_id);
        if self.paired.len() != before {
            actions.push(Action::PairedChanged);
        }
        actions
    }

    /// Remembers an approval awaiting a button and returns the token the button carries.
    pub fn register_approval(&mut self, chat_id: i64, approval_id: &str, now: u64) -> Option<u64> {
        if !self.is_paired(chat_id) {
            return None;
        }
        self.next_token += 1;
        self.pending.insert(
            self.next_token,
            Pending {
                chat_id,
                approval_id: approval_id.to_owned(),
                asked_at: now,
            },
        );
        Some(self.next_token)
    }

    /// Denies every approval nobody answered in time.
    pub fn sweep(&mut self, now: u64) -> Vec<Action> {
        self.deny_where(|pending| now.saturating_sub(pending.asked_at) >= APPROVAL_TTL_SECS)
    }

    fn deny_where(&mut self, expired: impl Fn(&Pending) -> bool) -> Vec<Action> {
        let tokens: Vec<u64> = self
            .pending
            .iter()
            .filter(|(_, pending)| expired(pending))
            .map(|(token, _)| *token)
            .collect();
        let mut actions = Vec::new();
        for token in tokens {
            if let Some(pending) = self.pending.remove(&token) {
                actions.push(Action::Resolve {
                    approval_id: pending.approval_id,
                    allow: false,
                });
                actions.push(Action::Send {
                    chat_id: pending.chat_id,
                    text: "That request timed out and was denied.".to_owned(),
                });
            }
        }
        actions
    }

    /// Decides what one update means. Anything from a chat that is not paired is ignored, except
    /// `/pair` with a valid code.
    pub fn handle_update(&mut self, update: &Value, now: u64) -> Vec<Action> {
        if let Some(query) = update.get("callback_query") {
            return self.handle_callback(query);
        }
        let Some(message) = update.get("message") else {
            return Vec::new();
        };
        let Some(chat_id) = message.get("chat").and_then(chat_id_of) else {
            return Vec::new();
        };
        let Some(text) = message.get("text").and_then(Value::as_str) else {
            return Vec::new();
        };
        let text = text.trim();
        let (command, argument) = match text.strip_prefix('/') {
            Some(body) => {
                let (head, rest) = body.split_once(char::is_whitespace).unwrap_or((body, ""));
                let head = head.split('@').next().unwrap_or(head).to_lowercase();
                (Some(head), rest.trim())
            }
            None => (None, text),
        };
        if command.as_deref() == Some("pair") {
            return self.try_pair(chat_id, name_of(message.get("from")), argument, now);
        }
        if !self.is_paired(chat_id) {
            return Vec::new();
        }
        let send = |text: &str| {
            vec![Action::Send {
                chat_id,
                text: text.to_owned(),
            }]
        };
        match command.as_deref() {
            None => {
                if text.is_empty() {
                    return Vec::new();
                }
                vec![Action::Message {
                    chat_id,
                    text: text.chars().take(MAX_INCOMING_CHARS).collect(),
                    command: None,
                }]
            }
            Some("new") => vec![Action::Message {
                chat_id,
                text: String::new(),
                command: Some(Command::New),
            }],
            Some("stop") => vec![Action::Message {
                chat_id,
                text: String::new(),
                command: Some(Command::Stop),
            }],
            Some("start") => send(
                "Paired. Send a message to chat with Draggy. /new starts a fresh chat and /stop cancels the running one.",
            ),
            Some(_) => send("Unknown command. Try /new or /stop."),
        }
    }

    fn try_pair(&mut self, chat_id: i64, name: String, given: &str, now: u64) -> Vec<Action> {
        if now < self.locked_until {
            return Vec::new();
        }
        if self.is_paired(chat_id) {
            return vec![Action::Send {
                chat_id,
                text: "This chat is already paired.".to_owned(),
            }];
        }
        let valid = match &self.code {
            Some((code, expires)) => {
                let same = constant_time_eq(code.as_bytes(), given.as_bytes());
                same && now < *expires
            }
            None => {
                // Still compared, so the answer does not depend on whether a window is open.
                constant_time_eq(b"-", given.as_bytes());
                false
            }
        };
        if valid {
            self.code = None;
            self.wrong = 0;
            self.paired.push(Paired { chat_id, name });
            return vec![
                Action::Send {
                    chat_id,
                    text: "Paired. Send a message to chat with Draggy.".to_owned(),
                },
                Action::PairedChanged,
            ];
        }
        self.wrong += 1;
        if self.wrong >= MAX_WRONG_CODES {
            self.wrong = 0;
            self.code = None;
            self.locked_until = now + LOCK_SECS;
        }
        vec![Action::Send {
            chat_id,
            text: "That code is not valid.".to_owned(),
        }]
    }

    fn handle_callback(&mut self, query: &Value) -> Vec<Action> {
        let Some(chat) = query.get("message").and_then(|message| message.get("chat")) else {
            return Vec::new();
        };
        let Some(chat_id) = chat_id_of(chat) else {
            return Vec::new();
        };
        if !self.is_paired(chat_id) {
            return Vec::new();
        }
        let Some(id) = query.get("id").and_then(Value::as_str) else {
            return Vec::new();
        };
        let answer = |text: &str| Action::AnswerCallback {
            id: id.to_owned(),
            text: text.to_owned(),
        };
        let parsed = query
            .get("data")
            .and_then(Value::as_str)
            .and_then(parse_callback);
        let Some((token, allow)) = parsed else {
            return vec![answer("Unknown button.")];
        };
        let owned = self
            .pending
            .get(&token)
            .is_some_and(|pending| pending.chat_id == chat_id);
        if !owned {
            return vec![answer("That request is no longer waiting.")];
        }
        let Some(pending) = self.pending.remove(&token) else {
            return Vec::new();
        };
        let mut actions = vec![
            Action::Resolve {
                approval_id: pending.approval_id,
                allow,
            },
            answer(if allow { "Allowed once" } else { "Denied" }),
        ];
        if let Some(message_id) = query
            .get("message")
            .and_then(|message| message.get("message_id"))
            .and_then(Value::as_i64)
        {
            actions.push(Action::Edit {
                chat_id,
                message_id,
                text: if allow {
                    "Allowed once.".to_owned()
                } else {
                    "Denied.".to_owned()
                },
            });
        }
        actions
    }
}

/// `ap:<token>:y` or `ap:<token>:n`.
fn parse_callback(data: &str) -> Option<(u64, bool)> {
    let mut parts = data.split(':');
    if parts.next()? != "ap" {
        return None;
    }
    let token = parts.next()?.parse().ok()?;
    let allow = match parts.next()? {
        "y" => true,
        "n" => false,
        _ => return None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some((token, allow))
}

/// What a request to Telegram went wrong with. The message never carries the token.
#[derive(Clone, Debug)]
pub struct Failure {
    pub message: String,
    pub retry_after: Option<u64>,
    /// Retrying cannot help, such as a token Telegram does not know.
    pub fatal: bool,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One call to the Bot API. The real one holds the token; tests script the answers.
pub trait Transport: Send + Sync {
    fn call<'a>(
        &'a self,
        method: &'a str,
        body: Value,
        timeout: Duration,
    ) -> BoxFuture<'a, Result<Value, Failure>>;
}

/// What the gateway tells the rest of the app.
#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    Message {
        chat_id: i64,
        text: String,
        command: Option<Command>,
    },
    Approval {
        approval_id: String,
        allow: bool,
    },
    PairedChanged,
}

pub trait Sink: Send + Sync {
    fn event(&self, event: Event);
}

/// Seconds to wait after the nth failure in a row, or what Telegram asked for.
pub fn backoff_secs(failures: u32, retry_after: Option<u64>) -> u64 {
    if let Some(wait) = retry_after {
        return wait.clamp(1, 300);
    }
    (1u64 << failures.min(6)).min(60)
}

pub struct Runner {
    pub state: Mutex<State>,
    transport: Arc<dyn Transport>,
    sink: Arc<dyn Sink>,
    /// The least time between two messages to one chat.
    gap: Duration,
    last_sent: Mutex<HashMap<i64, Instant>>,
}

impl Runner {
    pub fn new(
        state: State,
        transport: Arc<dyn Transport>,
        sink: Arc<dyn Sink>,
        gap: Duration,
    ) -> Self {
        Self {
            state: Mutex::new(state),
            transport,
            sink,
            gap,
            last_sent: Mutex::new(HashMap::new()),
        }
    }

    pub fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Asks Telegram for updates once and handles each. Returns how many arrived.
    pub async fn poll_once(
        &self,
        offset: &mut i64,
        wait_secs: u64,
        now: u64,
    ) -> Result<usize, Failure> {
        let body = json!({
            "offset": *offset,
            "timeout": wait_secs,
            "allowed_updates": ["message", "callback_query"],
        });
        let result = self
            .transport
            .call("getUpdates", body, Duration::from_secs(wait_secs + 15))
            .await?;
        let updates = result.as_array().cloned().unwrap_or_default();
        for update in &updates {
            if let Some(id) = update.get("update_id").and_then(Value::as_i64) {
                *offset = (*offset).max(id + 1);
            }
            let actions = self.state().handle_update(update, now);
            self.execute(actions).await;
        }
        Ok(updates.len())
    }

    pub async fn sweep(&self, now: u64) {
        let actions = self.state().sweep(now);
        self.execute(actions).await;
    }

    pub async fn execute(&self, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::Message {
                    chat_id,
                    text,
                    command,
                } => self.sink.event(Event::Message {
                    chat_id,
                    text,
                    command,
                }),
                Action::Send { chat_id, text } => {
                    let _ = self.send_text(chat_id, &text).await;
                }
                Action::AnswerCallback { id, text } => {
                    let body = json!({ "callback_query_id": id, "text": text });
                    let _ = self
                        .transport
                        .call("answerCallbackQuery", body, Duration::from_secs(15))
                        .await;
                }
                Action::Resolve { approval_id, allow } => {
                    self.sink.event(Event::Approval { approval_id, allow });
                }
                Action::Edit {
                    chat_id,
                    message_id,
                    text,
                } => {
                    let body =
                        json!({ "chat_id": chat_id, "message_id": message_id, "text": text });
                    let _ = self
                        .transport
                        .call("editMessageText", body, Duration::from_secs(15))
                        .await;
                }
                Action::PairedChanged => self.sink.event(Event::PairedChanged),
            }
        }
    }

    /// Keeps to the least gap between messages to one chat.
    async fn pace(&self, chat_id: i64) {
        let wait = {
            let mut last = self
                .last_sent
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let now = Instant::now();
            let wait = last
                .get(&chat_id)
                .map(|at| self.gap.saturating_sub(now.duration_since(*at)))
                .unwrap_or_default();
            last.insert(chat_id, now + wait);
            wait
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }

    /// Sends text in pieces Telegram accepts.
    pub async fn send_text(&self, chat_id: i64, text: &str) -> Result<(), Failure> {
        for part in chunk(text, CHUNK_CHARS) {
            self.pace(chat_id).await;
            let body = json!({ "chat_id": chat_id, "text": part });
            self.transport
                .call("sendMessage", body, Duration::from_secs(20))
                .await?;
        }
        Ok(())
    }

    /// Asks a paired chat to allow one call, with buttons. Nothing is sent to a chat that is not paired.
    pub async fn ask_approval(
        &self,
        chat_id: i64,
        approval_id: &str,
        text: &str,
        now: u64,
    ) -> Result<(), Failure> {
        let token = self.state().register_approval(chat_id, approval_id, now);
        let Some(token) = token else {
            return Err(Failure {
                message: "chat is not paired".to_owned(),
                retry_after: None,
                fatal: false,
            });
        };
        self.pace(chat_id).await;
        let shown: String = text.chars().take(CHUNK_CHARS).collect();
        let body = json!({
            "chat_id": chat_id,
            "text": shown,
            "reply_markup": { "inline_keyboard": [[
                { "text": "Allow once", "callback_data": format!("ap:{token}:y") },
                { "text": "Don't allow", "callback_data": format!("ap:{token}:n") },
            ]] },
        });
        let sent = self
            .transport
            .call("sendMessage", body, Duration::from_secs(20))
            .await;
        if sent.is_err() {
            // The buttons never reached the chat, so the call is denied rather than left waiting.
            let actions = self
                .state()
                .deny_where(|pending| pending.approval_id == approval_id);
            self.execute(actions).await;
        }
        sent.map(|_| ())
    }
}

/// Where the loop stands, for the settings page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoopState {
    Running,
    Retrying(String),
    Stopped(Option<String>),
}

/// Polls until `cancel` fires, backing off on errors. A token Telegram rejects ends the loop.
pub async fn poll_loop(
    runner: Arc<Runner>,
    cancel: CancellationToken,
    now: impl Fn() -> u64 + Send,
    report: impl Fn(LoopState) + Send,
) {
    let mut offset = 0i64;
    let mut failures = 0u32;
    report(LoopState::Running);
    loop {
        if cancel.is_cancelled() {
            break;
        }
        runner.sweep(now()).await;
        let polled = tokio::select! {
            () = cancel.cancelled() => break,
            polled = runner.poll_once(&mut offset, LONG_POLL_SECS, now()) => polled,
        };
        match polled {
            Ok(_) => {
                if failures > 0 {
                    report(LoopState::Running);
                }
                failures = 0;
            }
            Err(failure) if failure.fatal => {
                report(LoopState::Stopped(Some(failure.message)));
                return;
            }
            Err(failure) => {
                failures += 1;
                report(LoopState::Retrying(failure.message.clone()));
                let wait = Duration::from_secs(backoff_secs(failures, failure.retry_after));
                tokio::select! {
                    () = cancel.cancelled() => break,
                    () = tokio::time::sleep(wait) => {}
                }
            }
        }
    }
    report(LoopState::Stopped(None));
}

/// The real Bot API. The token is part of the base address and goes nowhere else.
pub struct HttpTransport {
    client: reqwest::Client,
    base: String,
}

impl HttpTransport {
    pub fn new(token: &str) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .build()
            .map_err(|error| error.without_url().to_string())?;
        Ok(Self {
            client,
            base: format!("https://api.telegram.org/bot{token}"),
        })
    }
}

impl Transport for HttpTransport {
    fn call<'a>(
        &'a self,
        method: &'a str,
        body: Value,
        timeout: Duration,
    ) -> BoxFuture<'a, Result<Value, Failure>> {
        Box::pin(async move {
            // reqwest puts the address into its errors, and the address holds the token.
            let wrap = |error: reqwest::Error| Failure {
                message: error.without_url().to_string(),
                retry_after: None,
                fatal: false,
            };
            let response = self
                .client
                .post(format!("{}/{method}", self.base))
                .timeout(timeout)
                .header("content-type", "application/json")
                .body(body.to_string())
                .send()
                .await
                .map_err(wrap)?;
            let status = response.status();
            let bytes = response.bytes().await.map_err(wrap)?;
            let answer: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            if answer.get("ok").and_then(Value::as_bool) == Some(true) {
                return Ok(answer.get("result").cloned().unwrap_or(Value::Null));
            }
            Err(Failure {
                message: answer
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("Telegram refused the request")
                    .chars()
                    .take(200)
                    .collect(),
                retry_after: answer
                    .get("parameters")
                    .and_then(|parameters| parameters.get("retry_after"))
                    .and_then(Value::as_u64),
                fatal: matches!(status.as_u16(), 401 | 403 | 404),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    const NOW: u64 = 1_000;

    fn message(chat: i64, text: &str) -> Value {
        json!({ "update_id": 1, "message": {
            "chat": { "id": chat, "type": "private" },
            "from": { "id": chat, "first_name": "Ada", "username": "ada" },
            "text": text,
        } })
    }

    fn callback(chat: i64, data: &str) -> Value {
        json!({ "update_id": 2, "callback_query": {
            "id": "cb1",
            "data": data,
            "message": { "message_id": 77, "chat": { "id": chat, "type": "private" } },
        } })
    }

    fn paired_state() -> State {
        State::with_paired(vec![Paired {
            chat_id: 5,
            name: "@ada".to_owned(),
        }])
    }

    #[test]
    fn a_valid_code_pairs_once() {
        let mut state = State::default();
        state.start_pairing("123456".to_owned(), NOW).expect("open");
        let actions = state.handle_update(&message(9, "/pair 123456"), NOW + 5);
        assert!(actions.contains(&Action::PairedChanged));
        assert!(state.is_paired(9));
        // Single use: the same code pairs nobody else.
        state.handle_update(&message(10, "/pair 123456"), NOW + 6);
        assert!(!state.is_paired(10));
    }

    #[test]
    fn an_expired_code_does_not_pair() {
        let mut state = State::default();
        state.start_pairing("123456".to_owned(), NOW).expect("open");
        state.handle_update(&message(9, "/pair 123456"), NOW + PAIR_TTL_SECS);
        assert!(!state.is_paired(9));
    }

    #[test]
    fn pairing_locks_after_five_wrong_codes() {
        let mut state = State::default();
        state.start_pairing("123456".to_owned(), NOW).expect("open");
        for _ in 0..MAX_WRONG_CODES {
            state.handle_update(&message(9, "/pair 000000"), NOW + 1);
        }
        // Even the right code is refused while locked, and the window was closed.
        let actions = state.handle_update(&message(9, "/pair 123456"), NOW + 2);
        assert!(actions.is_empty());
        assert!(!state.is_paired(9));
        assert!(state.start_pairing("654321".to_owned(), NOW + 3).is_err());
        assert!(
            state
                .start_pairing("654321".to_owned(), NOW + LOCK_SECS + 1)
                .is_ok()
        );
    }

    #[test]
    fn pairing_without_an_open_window_counts_as_wrong() {
        let mut state = State::default();
        for _ in 0..MAX_WRONG_CODES {
            state.handle_update(&message(9, "/pair 123456"), NOW);
        }
        assert!(state.start_pairing("1".to_owned(), NOW + 1).is_err());
    }

    #[test]
    fn unpaired_chats_are_ignored() {
        let mut state = paired_state();
        assert!(state.handle_update(&message(9, "hello"), NOW).is_empty());
        assert!(state.handle_update(&message(9, "/new"), NOW).is_empty());
        assert!(state.handle_update(&message(9, "/stop"), NOW).is_empty());
        let approval = state.register_approval(5, "a1", NOW).expect("token");
        let data = format!("ap:{approval}:y");
        assert!(state.handle_update(&callback(9, &data), NOW).is_empty());
        // The approval is still waiting: the stranger did not resolve it.
        assert_eq!(state.pending.len(), 1);
    }

    #[test]
    fn group_chats_are_ignored() {
        let mut state = paired_state();
        let update = json!({ "message": {
            "chat": { "id": 5, "type": "group" },
            "text": "hello",
        } });
        assert!(state.handle_update(&update, NOW).is_empty());
    }

    #[test]
    fn paired_messages_and_commands_reach_the_app() {
        let mut state = paired_state();
        assert_eq!(
            state.handle_update(&message(5, "hello there"), NOW),
            vec![Action::Message {
                chat_id: 5,
                text: "hello there".to_owned(),
                command: None
            }]
        );
        assert_eq!(
            state.handle_update(&message(5, "/new@DraggyBot"), NOW),
            vec![Action::Message {
                chat_id: 5,
                text: String::new(),
                command: Some(Command::New)
            }]
        );
        assert_eq!(
            state.handle_update(&message(5, "/stop"), NOW),
            vec![Action::Message {
                chat_id: 5,
                text: String::new(),
                command: Some(Command::Stop)
            }]
        );
    }

    #[test]
    fn a_button_resolves_only_its_own_chats_approval() {
        let mut state = paired_state();
        state.paired.push(Paired {
            chat_id: 6,
            name: String::new(),
        });
        let token = state.register_approval(5, "a1", NOW).expect("token");
        // Another paired chat cannot answer for this one.
        let other = state.handle_update(&callback(6, &format!("ap:{token}:y")), NOW);
        assert!(!other.iter().any(|a| matches!(a, Action::Resolve { .. })));
        let own = state.handle_update(&callback(5, &format!("ap:{token}:y")), NOW);
        assert!(own.contains(&Action::Resolve {
            approval_id: "a1".to_owned(),
            allow: true
        }));
        // A second press finds nothing waiting.
        let again = state.handle_update(&callback(5, &format!("ap:{token}:y")), NOW);
        assert!(!again.iter().any(|a| matches!(a, Action::Resolve { .. })));
    }

    #[test]
    fn the_deny_button_denies() {
        let mut state = paired_state();
        let token = state.register_approval(5, "a1", NOW).expect("token");
        let actions = state.handle_update(&callback(5, &format!("ap:{token}:n")), NOW);
        assert!(actions.contains(&Action::Resolve {
            approval_id: "a1".to_owned(),
            allow: false
        }));
    }

    #[test]
    fn malformed_button_data_resolves_nothing() {
        let mut state = paired_state();
        state.register_approval(5, "a1", NOW);
        for data in [
            "",
            "ap",
            "ap:1",
            "ap:x:y",
            "ap:1:maybe",
            "ap:1:y:z",
            "zz:1:y",
        ] {
            let actions = state.handle_update(&callback(5, data), NOW);
            assert!(
                !actions.iter().any(|a| matches!(a, Action::Resolve { .. })),
                "{data}"
            );
        }
    }

    #[test]
    fn an_unanswered_approval_is_denied_after_ten_minutes() {
        let mut state = paired_state();
        state.register_approval(5, "a1", NOW);
        assert!(state.sweep(NOW + APPROVAL_TTL_SECS - 1).is_empty());
        let actions = state.sweep(NOW + APPROVAL_TTL_SECS);
        assert!(actions.contains(&Action::Resolve {
            approval_id: "a1".to_owned(),
            allow: false
        }));
        assert!(state.sweep(NOW + APPROVAL_TTL_SECS + 1).is_empty());
    }

    #[test]
    fn unpairing_denies_what_was_waiting() {
        let mut state = paired_state();
        state.register_approval(5, "a1", NOW);
        let actions = state.unpair(5);
        assert!(actions.contains(&Action::Resolve {
            approval_id: "a1".to_owned(),
            allow: false
        }));
        assert!(!state.is_paired(5));
        assert!(state.register_approval(5, "a2", NOW).is_none());
    }

    #[test]
    fn long_text_is_chunked() {
        assert_eq!(chunk("short", 10), vec!["short".to_owned()]);
        let text = "a".repeat(9000);
        let parts = chunk(&text, CHUNK_CHARS);
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.chars().count() <= CHUNK_CHARS));
        assert_eq!(parts.concat(), text);
        let lines = format!("{}\n{}", "b".repeat(3000), "c".repeat(3000));
        let parts = chunk(&lines, CHUNK_CHARS);
        assert_eq!(parts[0].chars().count(), 3001);
        assert_eq!(parts.concat(), lines);
        let wide = "é".repeat(5000);
        assert_eq!(chunk(&wide, CHUNK_CHARS).concat(), wide);
    }

    #[test]
    fn the_comparison_sees_every_difference() {
        assert!(constant_time_eq(b"123456", b"123456"));
        assert!(!constant_time_eq(b"123456", b"123457"));
        assert!(!constant_time_eq(b"123456", b"12345"));
        assert!(!constant_time_eq(b"", b"1"));
    }

    #[test]
    fn backoff_grows_and_stops_growing() {
        assert_eq!(backoff_secs(1, None), 2);
        assert_eq!(backoff_secs(3, None), 8);
        assert_eq!(backoff_secs(20, None), 60);
        assert_eq!(backoff_secs(1, Some(7)), 7);
    }

    #[derive(Default)]
    struct FakeTransport {
        calls: Mutex<Vec<(String, Value)>>,
        replies: Mutex<VecDeque<Result<Value, Failure>>>,
    }

    impl FakeTransport {
        fn called(&self, method: &str) -> Vec<Value> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(name, _)| name == method)
                .map(|(_, body)| body.clone())
                .collect()
        }
    }

    impl Transport for FakeTransport {
        fn call<'a>(
            &'a self,
            method: &'a str,
            body: Value,
            _timeout: Duration,
        ) -> BoxFuture<'a, Result<Value, Failure>> {
            Box::pin(async move {
                self.calls.lock().unwrap().push((method.to_owned(), body));
                self.replies
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or_else(|| Ok(json!(true)))
            })
        }
    }

    #[derive(Default)]
    struct Events(Mutex<Vec<Event>>);

    impl Sink for Events {
        fn event(&self, event: Event) {
            self.0.lock().unwrap().push(event);
        }
    }

    fn runner(state: State) -> (Arc<Runner>, Arc<FakeTransport>, Arc<Events>) {
        let transport = Arc::new(FakeTransport::default());
        let events = Arc::new(Events::default());
        let runner = Arc::new(Runner::new(
            state,
            transport.clone(),
            events.clone(),
            Duration::ZERO,
        ));
        (runner, transport, events)
    }

    #[tokio::test]
    async fn polling_pairs_and_forwards_only_paired_text() {
        let (runner, transport, events) = runner(State::default());
        runner
            .state()
            .start_pairing("424242".to_owned(), NOW)
            .expect("open");
        let updates = json!([
            { "update_id": 10, "message": { "chat": { "id": 9, "type": "private" }, "text": "sneaky" } },
            { "update_id": 11, "message": { "chat": { "id": 9, "type": "private" }, "from": { "id": 9, "first_name": "Eve" }, "text": "/pair 424242" } },
            { "update_id": 12, "message": { "chat": { "id": 9, "type": "private" }, "text": "hi" } },
        ]);
        transport.replies.lock().unwrap().push_back(Ok(updates));
        let mut offset = 0;
        let count = runner
            .poll_once(&mut offset, 0, NOW + 1)
            .await
            .expect("poll");
        assert_eq!(count, 3);
        assert_eq!(offset, 13);
        let seen = events.0.lock().unwrap();
        assert!(seen.contains(&Event::PairedChanged));
        let texts: Vec<_> = seen
            .iter()
            .filter_map(|event| match event {
                Event::Message { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["hi"]);
        // The stranger's first message got no reply; the pairing did.
        let replies = transport.called("sendMessage");
        assert_eq!(replies.len(), 1);
    }

    #[tokio::test]
    async fn approval_buttons_are_sent_and_resolved() {
        let (runner, transport, events) = runner(paired_state());
        runner
            .ask_approval(5, "a1", "Run ls?", NOW)
            .await
            .expect("sent");
        let sent = transport.called("sendMessage");
        let data = sent[0]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
            .as_str()
            .expect("data")
            .to_owned();
        let update = callback(5, &data);
        let actions = runner.state().handle_update(&update, NOW + 1);
        runner.execute(actions).await;
        assert!(events.0.lock().unwrap().contains(&Event::Approval {
            approval_id: "a1".to_owned(),
            allow: true
        }));
        assert_eq!(transport.called("answerCallbackQuery").len(), 1);
        assert_eq!(transport.called("editMessageText").len(), 1);
    }

    #[tokio::test]
    async fn an_approval_that_could_not_be_sent_is_denied() {
        let (runner, transport, events) = runner(paired_state());
        transport.replies.lock().unwrap().push_back(Err(Failure {
            message: "down".to_owned(),
            retry_after: None,
            fatal: false,
        }));
        assert!(runner.ask_approval(5, "a1", "Run ls?", NOW).await.is_err());
        assert!(events.0.lock().unwrap().contains(&Event::Approval {
            approval_id: "a1".to_owned(),
            allow: false
        }));
    }

    #[tokio::test]
    async fn nothing_is_asked_of_an_unpaired_chat() {
        let (runner, transport, _events) = runner(State::default());
        assert!(runner.ask_approval(5, "a1", "Run ls?", NOW).await.is_err());
        assert!(transport.called("sendMessage").is_empty());
    }

    #[tokio::test]
    async fn long_replies_go_out_in_pieces() {
        let (runner, transport, _events) = runner(paired_state());
        runner.send_text(5, &"x".repeat(9000)).await.expect("sent");
        assert_eq!(transport.called("sendMessage").len(), 3);
    }

    #[tokio::test]
    async fn the_loop_backs_off_then_stops_on_a_fatal_failure() {
        let (runner, transport, _events) = runner(State::default());
        transport.replies.lock().unwrap().push_back(Err(Failure {
            message: "Unauthorized".to_owned(),
            retry_after: None,
            fatal: true,
        }));
        let states = Arc::new(Mutex::new(Vec::new()));
        let seen = states.clone();
        poll_loop(
            runner,
            CancellationToken::new(),
            || NOW,
            move |state| seen.lock().unwrap().push(state),
        )
        .await;
        let states = states.lock().unwrap();
        assert_eq!(
            states.last(),
            Some(&LoopState::Stopped(Some("Unauthorized".to_owned())))
        );
    }
}
