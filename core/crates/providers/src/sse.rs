//! Server-sent events in both directions: the frames Draggy writes in llama-server's shape, and the line splitter the
//! adapters read a provider's stream with. A line that arrives in pieces waits for its newline.

use serde_json::{Map, Value, json};
use tracing::info;

use crate::js::json_text;
use crate::types::{ErrorKind, FinishReason, ProviderError, ProviderState, Usage};

/// One delta as the writer takes it: text, reasoning and tool call fragments, in that order on the wire.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Delta {
    pub content: Option<String>,
    pub reasoning: Option<String>,
    pub tool_calls: Vec<Value>,
}

/// Writes a provider's answer the way llama-server streams one. The clock is read where the reference reads it,
/// so the first-token and total timings come out the same.
pub struct SseWriter<C: FnMut() -> u64> {
    clock: C,
    started_at: u64,
    first_at: Option<u64>,
    closed: bool,
    failed: Option<ErrorKind>,
    events: u64,
    skipped: u64,
    malformed: u64,
    frames: Vec<String>,
}

impl<C: FnMut() -> u64> SseWriter<C> {
    pub fn new(mut clock: C) -> Self {
        let started_at = clock();
        Self {
            clock,
            started_at,
            first_at: None,
            closed: false,
            failed: None,
            events: 0,
            skipped: 0,
            malformed: 0,
            frames: Vec::new(),
        }
    }

    /// Writes one delta, unless it is empty.
    pub fn delta(&mut self, delta: Delta) {
        let mut body = Map::new();
        if let Some(content) = delta.content.filter(|text| !text.is_empty()) {
            body.insert("content".to_owned(), Value::String(content));
        }
        if let Some(reasoning) = delta.reasoning.filter(|text| !text.is_empty()) {
            body.insert("reasoning_content".to_owned(), Value::String(reasoning));
        }
        if !delta.tool_calls.is_empty() {
            body.insert("tool_calls".to_owned(), Value::Array(delta.tool_calls));
        }
        if body.is_empty() {
            return;
        }
        self.mark_first();
        self.send(json!({ "choices": [{ "index": 0, "delta": body, "finish_reason": null }] }));
    }

    /// The last frame of an answer: its finish reason, the token counts and the timings.
    pub fn finish(&mut self, reason: Option<FinishReason>, usage: Usage) {
        self.mark_first();
        let reason_text = finish_text(reason.unwrap_or(FinishReason::Stop));
        let end = (self.clock)();
        let first = self.first_at.unwrap_or(self.started_at);
        let prompt = usage.prompt_tokens;
        let output = usage.output_tokens;
        self.send(json!({
            "choices": [{ "index": 0, "delta": {}, "finish_reason": reason_text }],
            "usage": usage_field(&usage),
            "timings": {
                "prompt_n": prompt,
                "prompt_ms": first.saturating_sub(self.started_at),
                "predicted_n": output,
                "predicted_ms": end.saturating_sub(first),
            },
        }));
    }

    /// An upstream event that was not JSON and was dropped; only the count is kept.
    pub fn malformed(&mut self) {
        self.malformed += 1;
    }

    /// The gateway's retry notice. The attempt also stands as the retry count in the summary.
    pub fn retry(&mut self, attempt: u64, of: u64, retry_after_ms: Option<u64>) {
        let mut body = Map::new();
        body.insert("attempt".to_owned(), json!(attempt));
        body.insert("of".to_owned(), json!(of));
        if let Some(ms) = retry_after_ms {
            body.insert("retryAfterMs".to_owned(), json!(ms));
        }
        self.send(json!({ "draggy_retry": body }));
    }

    /// A failure, sent as the answer's last word before done.
    pub fn error(&mut self, failure: &ProviderError) {
        self.failed = Some(failure.kind);
        self.send(json!({ "error": failure }));
    }

    /// Reasoning state the instance must keep, sent for the renderer to hand back on the next turn.
    pub fn provider_state(&mut self, state: &ProviderState) {
        self.send(json!({ "provider_state": state }));
    }

    /// The end of the stream: `[DONE]`, then the close.
    pub fn done(&mut self) {
        if self.closed {
            return;
        }
        self.send_raw("[DONE]");
        let how = match self.failed {
            None => "done",
            Some(ErrorKind::Unreachable) => "socket",
            Some(_) => "error",
        };
        self.end(how);
    }

    /// The stream was cut from our side; nothing more is written.
    pub fn stop(&mut self, how: &str) {
        if !self.closed {
            self.end(how);
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// The frames written since the last call, each ending in the blank line that closes it.
    pub fn take_frames(&mut self) -> Vec<String> {
        std::mem::take(&mut self.frames)
    }

    fn mark_first(&mut self) {
        if self.first_at.is_none() {
            self.first_at = Some((self.clock)());
        }
    }

    fn send(&mut self, payload: Value) {
        self.send_raw(&json_text(&payload));
    }

    fn send_raw(&mut self, payload: &str) {
        if self.closed {
            self.skipped += 1;
            return;
        }
        self.events += 1;
        self.frames.push(format!("data: {payload}\n\n"));
    }

    fn end(&mut self, how: &str) {
        self.closed = true;
        let now = (self.clock)();
        info!(target: "providers.sse", how, events = self.events, skipped = self.skipped, malformed = self.malformed, dur_ms = now.saturating_sub(self.started_at), "request finished");
    }
}

/// A non-streaming answer in llama-server's shape, with its usage totals.
pub fn completion(
    content: &str,
    reasoning: &str,
    tool_calls: &[Value],
    finish: FinishReason,
    usage: Usage,
) -> Value {
    let mut message = Map::new();
    message.insert("role".to_owned(), json!("assistant"));
    message.insert("content".to_owned(), json!(content));
    if !reasoning.is_empty() {
        message.insert("reasoning_content".to_owned(), json!(reasoning));
    }
    if !tool_calls.is_empty() {
        message.insert("tool_calls".to_owned(), Value::Array(tool_calls.to_vec()));
    }
    json!({
        "choices": [{ "index": 0, "message": message, "finish_reason": finish_text(finish) }],
        "usage": usage_field(&usage),
    })
}

/// llama-server's `usage`, plus `draggy_usage`: the cache and reasoning split the app prices. An answer that
/// reported nothing carries no split, so it is never read as a free reply.
fn usage_field(usage: &Usage) -> Value {
    let mut field = json!({
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.output_tokens,
        "total_tokens": usage.prompt_tokens + usage.output_tokens,
    });
    if let Some(tokens) = usage
        .tokens
        .filter(|t| t.input + t.cache_read + t.cache_write + t.output + t.reasoning > 0)
    {
        field["draggy_usage"] = serde_json::to_value(tokens).unwrap_or(Value::Null);
    }
    field
}

/// The finish reason as llama-server names it.
pub fn finish_text(reason: FinishReason) -> &'static str {
    match reason {
        FinishReason::Stop => "stop",
        FinishReason::Length => "length",
        FinishReason::ToolCalls => "tool_calls",
    }
}

/// Splits bytes into lines. A line that arrives in pieces waits for its newline, and a multi-byte character can
/// straddle two reads, since a newline byte never falls inside one.
#[derive(Debug, Default)]
pub struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    /// The complete lines the bytes so far make up, without their newlines.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(offset) = self.pending[start..].iter().position(|byte| *byte == b'\n') {
            let end = start + offset;
            lines.push(String::from_utf8_lossy(&self.pending[start..end]).into_owned());
            start = end + 1;
        }
        self.pending.drain(..start);
        lines
    }

    /// Forgets the partial line, as a reader does when it stops at `[DONE]`.
    pub fn reset(&mut self) {
        self.pending.clear();
    }

    /// The partial line left at the end of the stream, emptied.
    pub fn take_rest(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
}
