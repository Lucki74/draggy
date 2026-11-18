//! What the Responses and Messages routes share: reading a chat reply, the stream plumbing and the error shapes.

use std::collections::VecDeque;
use std::convert::Infallible;

use axum::body::Bytes;
use axum::http::StatusCode;
use futures_util::stream::{self, Stream, StreamExt};
use serde_json::{Value, json};
use tokio_util::sync::DropGuard;

use crate::server::{ByteStream, Permit, split_event};
use crate::{messages, ollama, responses};

/// The wire format a client speaks on a translated route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    /// OpenAI `POST /v1/responses`.
    Responses,
    /// Anthropic `POST /v1/messages`.
    Messages,
    /// Ollama `POST /api/chat`.
    OllamaChat,
    /// Ollama `POST /api/generate`.
    OllamaGenerate,
}

impl Dialect {
    /// Ollama answers streams as newline-delimited JSON, not server-sent events.
    pub fn is_ollama(self) -> bool {
        matches!(self, Dialect::OllamaChat | Dialect::OllamaGenerate)
    }
}

/// One server-sent event, ready to be framed.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub name: String,
    pub data: Value,
}

impl Event {
    pub fn new(name: &str, data: Value) -> Self {
        Self {
            name: name.to_owned(),
            data,
        }
    }

    /// The SSE text: an `event:` line, a `data:` line and a blank line. A nameless event is one NDJSON line.
    pub fn frame(&self) -> String {
        if self.name.is_empty() {
            return format!("{}
", self.data);
        }
        format!("event: {}\ndata: {}\n\n", self.name, self.data)
    }
}

/// Turns the chunks of a chat stream into the events of one dialect.
pub trait Translator: Send {
    /// One parsed chat chunk.
    fn feed(&mut self, chunk: &Value) -> Vec<Event>;
    /// The upstream ended cleanly.
    fn finish(&mut self) -> Vec<Event>;
    /// The upstream failed.
    fn fail(&mut self, message: &str) -> Vec<Event>;
}

/// A translator for `dialect`, with ids derived from the chat id.
pub fn translator(dialect: Dialect, chat_id: &str, model: &str, created: i64) -> Box<dyn Translator> {
    match dialect {
        Dialect::Responses => Box::new(responses::Stream::new(chat_id, model, created)),
        Dialect::Messages => Box::new(messages::Stream::new(chat_id, model)),
        Dialect::OllamaChat => Box::new(ollama::Stream::new(false, model, created)),
        Dialect::OllamaGenerate => Box::new(ollama::Stream::new(true, model, created)),
    }
}

/// The chat request that `body` asks for, or what is wrong with it.
pub fn to_chat(dialect: Dialect, body: &Value) -> Result<Value, String> {
    match dialect {
        Dialect::Responses => responses::to_chat(body),
        Dialect::Messages => messages::to_chat(body),
        Dialect::OllamaChat => ollama::chat_to_chat(body),
        Dialect::OllamaGenerate => ollama::generate_to_chat(body),
    }
}

/// The part of a chat id after `chatcmpl-`, used to name the ids of other dialects.
pub fn id_suffix(chat_id: &str) -> &str {
    chat_id.strip_prefix("chatcmpl-").unwrap_or(chat_id)
}

/// One tool call of a chat reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// What a whole chat reply says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Answer {
    pub text: String,
    pub calls: Vec<Call>,
    pub finish: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Reads a chat completion. A missing call id is made from `suffix` and the call's place.
pub fn read_answer(chat: &Value, suffix: &str) -> Answer {
    let choice = chat.pointer("/choices/0");
    let message = choice.and_then(|c| c.get("message"));
    let text = match message.and_then(|m| m.get("content")) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect(),
        _ => String::new(),
    };
    let calls: Vec<Call> = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, call)| Call {
            id: call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map_or_else(|| format!("call_{suffix}_{index}"), str::to_owned),
            name: str_at(call, "/function/name"),
            arguments: match call.pointer("/function/arguments") {
                Some(Value::String(text)) => text.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            },
        })
        .collect();
    let finish = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(Value::as_str)
        .map_or_else(
            || if calls.is_empty() { "stop" } else { "tool_calls" }.to_owned(),
            str::to_owned,
        );
    let (input_tokens, output_tokens) = usage_of(chat);
    Answer {
        text,
        calls,
        finish,
        input_tokens,
        output_tokens,
    }
}

/// The prompt and completion token counts of a chat reply or chunk, zero when missing.
pub fn usage_of(value: &Value) -> (u64, u64) {
    let count = |key: &str| {
        value
            .pointer(&format!("/usage/{key}"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    (count("prompt_tokens"), count("completion_tokens"))
}

fn str_at(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

/// An error body in the shape of the dialect: Anthropic's for Messages, otherwise OpenAI's.
pub fn error_json(dialect: Option<Dialect>, status: StatusCode, message: &str, kind: &str) -> String {
    if dialect.is_some_and(Dialect::is_ollama) {
        return json!({"error": message}).to_string();
    }
    if dialect == Some(Dialect::Messages) {
        let kind = match status.as_u16() {
            400 => "invalid_request_error",
            401 => "authentication_error",
            403 => "permission_error",
            404 => "not_found_error",
            413 => "request_too_large",
            429 => "rate_limit_error",
            529 => "overloaded_error",
            _ => "api_error",
        };
        return json!({"type": "error", "error": {"type": kind, "message": message}}).to_string();
    }
    crate::server::error_body(message, kind)
}

/// The message inside an upstream error body, or its text when it is not JSON.
pub fn upstream_message(bytes: &[u8]) -> String {
    let fallback = || {
        let text = String::from_utf8_lossy(bytes);
        let text = text.trim();
        if text.is_empty() || text.len() > 500 {
            "The reply failed.".to_owned()
        } else {
            text.to_owned()
        }
    };
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value) => value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .map_or_else(fallback, str::to_owned),
        Err(_) => fallback(),
    }
}

/// A whole chat reply as the dialect's reply. `None` when the reply is not a chat completion.
pub fn whole_reply(dialect: Dialect, chat: &Value, chat_id: &str, model: &str, created: i64) -> Option<Value> {
    chat.get("choices")?;
    Some(match dialect {
        Dialect::Responses => responses::from_chat(chat, chat_id, model, created),
        Dialect::Messages => messages::from_chat(chat, chat_id, model),
        Dialect::OllamaChat => ollama::from_chat(false, chat, model, created),
        Dialect::OllamaGenerate => ollama::from_chat(true, chat, model, created),
    })
}

/// A chat stream on its way to the client, translated event by event.
struct Translated {
    upstream: ByteStream,
    buffer: Vec<u8>,
    pending: VecDeque<Bytes>,
    translator: Box<dyn Translator>,
    finished: bool,
    cancel: Option<DropGuard>,
    permit: Option<Permit>,
}

impl Translated {
    fn push(&mut self, events: Vec<Event>) {
        self.pending
            .extend(events.iter().map(|event| Bytes::from(event.frame())));
    }

    fn take_events(&mut self, upstream_ended: bool) {
        while let Some(event) = split_event(&mut self.buffer) {
            self.event(&String::from_utf8_lossy(&event));
        }
        if upstream_ended && !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            self.event(&String::from_utf8_lossy(&rest));
        }
    }

    fn event(&mut self, raw: &str) {
        if self.finished {
            return;
        }
        let data: Vec<&str> = raw
            .split('\n')
            .filter_map(|line| line.trim_end_matches('\r').strip_prefix("data:"))
            .map(str::trim)
            .collect();
        let payload = data.join("\n");
        if payload.is_empty() || payload == "[DONE]" {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&payload) else {
            return;
        };
        if value.get("error").is_some() && value.get("choices").is_none() {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("The reply failed.")
                .to_owned();
            self.fail(&message);
            return;
        }
        let events = self.translator.feed(&value);
        self.push(events);
    }

    fn fail(&mut self, message: &str) {
        tracing::warn!(target: "net.api", streamed = true, "model stream failed");
        let events = self.translator.fail(message);
        self.push(events);
        self.end();
    }

    fn finish(&mut self) {
        let events = self.translator.finish();
        self.push(events);
        self.end();
    }

    fn end(&mut self) {
        self.finished = true;
        if let Some(guard) = self.cancel.take() {
            let _ = guard.disarm();
        }
        self.permit = None;
    }
}

async fn next_translated(mut state: Translated) -> Option<(Result<Bytes, Infallible>, Translated)> {
    loop {
        if let Some(frame) = state.pending.pop_front() {
            return Some((Ok(frame), state));
        }
        if state.finished {
            return None;
        }
        match state.upstream.next().await {
            Some(Ok(bytes)) => {
                state.buffer.extend_from_slice(&bytes);
                state.take_events(false);
            }
            Some(Err(error)) => {
                state.take_events(true);
                if !state.finished {
                    let message = if error.message.is_empty() {
                        "The reply failed.".to_owned()
                    } else {
                        error.message
                    };
                    state.fail(&message);
                }
            }
            None => {
                state.take_events(true);
                if !state.finished {
                    state.finish();
                }
            }
        }
    }
}

/// The translated stream. The guard cancels the request when the client leaves, and the permit frees the slot at the end.
pub(crate) fn translated_stream(
    upstream: ByteStream,
    translator: Box<dyn Translator>,
    cancel: DropGuard,
    permit: Permit,
) -> impl Stream<Item = Result<Bytes, Infallible>> {
    stream::unfold(
        Translated {
            upstream,
            buffer: Vec::new(),
            pending: VecDeque::new(),
            translator,
            finished: false,
            cancel: Some(cancel),
            permit: Some(permit),
        },
        next_translated,
    )
}
