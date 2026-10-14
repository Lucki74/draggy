//! What the adapters share: the connection they are given, the reading of the neutral request, and the driver that
//! turns a provider's bytes into events one complete line at a time.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::catalog::CatalogEntry;
use crate::js::{json_text, to_string, truthy};
use crate::sse::LineSplitter;
use crate::types::{
    ChatRequest, Content, ContentPart, ErrorKind, FunctionSpec, ProviderError, StreamEvent,
    ToolSpec,
};

/// Where and how a request goes: the instance's address, key, headers and catalog entry.
#[derive(Debug, Clone, Default)]
pub struct Connection {
    pub instance_id: Option<String>,
    pub base_url: String,
    /// Empty when the instance has no key, and no Authorization header is sent then.
    pub api_key: String,
    pub headers: BTreeMap<String, String>,
    pub entry: Option<CatalogEntry>,
}

/// A catalog quirk by name, when the entry sets it.
pub fn quirk<'a>(conn: &'a Connection, name: &str) -> Option<&'a Value> {
    conn.entry.as_ref()?.quirks.as_ref()?.get(name)
}

/// The thinking switch: the request's own, else the template switch the local servers read.
pub fn think_of(req: &ChatRequest) -> Option<bool> {
    req.think.or_else(|| {
        req.chat_template_kwargs
            .as_ref()
            .and_then(|kwargs| kwargs.get("enable_thinking"))
            .and_then(Value::as_bool)
    })
}

/// The thinking effort the pill asked for; anything else reads as medium.
pub fn level_of(req: &ChatRequest) -> &'static str {
    match req.thinking_level.as_deref() {
        Some("low") => "low",
        Some("high") => "high",
        _ => "medium",
    }
}

/// The output limit the request asked for: its own, else the local options', else none (zero).
pub fn output_limit(req: &ChatRequest) -> i64 {
    let asked = req.max_tokens.unwrap_or(0);
    if asked > 0 {
        return asked;
    }
    let predict = req.options.num_predict.unwrap_or(0);
    if predict > 0 { predict } else { 0 }
}

/// Only Draggy's function tools that have a name; hosted tools never go to a provider.
pub fn function_tools(tools: &[ToolSpec]) -> Vec<&FunctionSpec> {
    tools
        .iter()
        .filter(|tool| tool.kind.as_deref() == Some("function"))
        .filter_map(|tool| tool.function.as_ref())
        .filter(|function| {
            function
                .name
                .as_deref()
                .is_some_and(|name| !name.is_empty())
        })
        .collect()
}

/// `String(content ?? "")` for a message: text as it is, parts as the reference's object string.
pub fn text_of(content: Option<&Content>) -> String {
    match content {
        None => String::new(),
        Some(Content::Text(text)) => text.clone(),
        Some(Content::Parts(parts)) if parts.is_empty() => String::new(),
        Some(Content::Parts(parts)) => vec!["[object Object]"; parts.len()].join(","),
    }
}

/// A `data:<type>;base64,<data>` URL as its type and data, or None for any other URL.
pub fn parse_data_url(url: &str) -> Option<(&str, &str)> {
    let rest = url.strip_prefix("data:")?;
    let end = rest.find([';', ','])?;
    if end == 0 || !rest[end..].starts_with(';') {
        return None;
    }
    let mime = &rest[..end];
    let data = rest[end + 1..].strip_prefix("base64,")?;
    Some((mime, data))
}

/// Tool-call arguments as the JSON text a provider expects: strings as they are, anything else serialised.
pub fn arguments_text(arguments: &Value) -> String {
    match arguments {
        Value::String(text) => text.clone(),
        Value::Null => "{}".to_owned(),
        other => json_text(other),
    }
}

/// A response's tool-call arguments: a missing or null value is empty, where a request's null becomes `{}`.
pub fn response_arguments_text(arguments: Option<&Value>) -> String {
    match arguments {
        None | Some(Value::Null) => String::new(),
        Some(other) => arguments_text(other),
    }
}

/// Arguments as a JSON object: an object as it is, a string parsed when it holds one, anything else empty.
pub fn arguments_object(arguments: &Value) -> Value {
    match arguments {
        Value::Object(_) | Value::Array(_) => arguments.clone(),
        Value::String(text) => match serde_json::from_str::<Value>(text) {
            Ok(parsed @ (Value::Object(_) | Value::Array(_))) => parsed,
            _ => json!({}),
        },
        _ => json!({}),
    }
}

/// `value || ""` for a text field the provider may send as anything.
pub fn text_or_empty(value: Option<&Value>) -> String {
    match value {
        Some(value) if truthy(Some(value)) => to_string(value),
        _ => String::new(),
    }
}

/// A non-empty string field, or None.
pub fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// A count the provider sent as a number; anything else counts as none.
pub fn count(value: Option<&Value>) -> u64 {
    match value {
        Some(Value::Number(n)) => n
            .as_u64()
            .or_else(|| n.as_f64().filter(|f| *f > 0.0).map(|f| f as u64))
            .unwrap_or(0),
        _ => 0,
    }
}

/// The failure a provider's refusal names, with the status the reference gives it.
pub fn refusal(message: &str) -> ProviderError {
    ProviderError {
        kind: ErrorKind::Refused,
        status: Some(200),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }
}

/// The failure of a hosted tool the model ran on its own: Draggy never offered one, so the turn ends. The reference
/// names the tool in the message and leaves the status at 0 with an empty provider message.
pub fn hosted(tool: &str) -> ProviderError {
    ProviderError {
        kind: ErrorKind::UnknownError,
        status: Some(0),
        message: Some(format!(
            "The provider called its own tool ({tool}), which Draggy never offers."
        )),
        provider_message: Some(String::new()),
        retry_after: None,
    }
}

/// The content of a message as the wire wants it: a string, or the text and image parts.
pub fn content_value(content: Option<&Content>) -> Value {
    match content {
        None => json!(""),
        Some(Content::Text(text)) => json!(text),
        Some(Content::Parts(parts)) => Value::Array(
            parts
                .iter()
                .filter_map(|part| match part {
                    ContentPart::Text { text } => Some(json!({ "type": "text", "text": text })),
                    ContentPart::ImageUrl { image_url } => {
                        Some(json!({ "type": "image_url", "image_url": { "url": image_url.url } }))
                    }
                    ContentPart::Other => None,
                })
                .collect(),
        ),
    }
}

/// One model as a listing gives it. The adapters fill what their listing says; the rest stays empty.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ListedModel {
    pub id: String,
    pub name: Option<String>,
    pub resolved: Option<String>,
    pub context_length: Option<u64>,
    pub supported: Option<Vec<String>>,
    pub input_modalities: Option<Vec<String>>,
    /// The flags a listing states outright, such as LM Studio's capability names.
    pub capabilities: Option<Vec<String>>,
    /// Served from the provider's cloud rather than this computer.
    pub cloud: bool,
}

/// `first` when it has words, else `fallback()`.
pub fn either(first: String, fallback: impl FnOnce() -> String) -> String {
    if first.is_empty() { fallback() } else { first }
}

/// What a line decoder asks of the driver after a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    /// Keep reading.
    Continue,
    /// Drop the rest of the bytes read so far, and keep reading later bytes (OpenAI's `[DONE]`).
    DropRest,
    /// Stop reading the provider altogether (Anthropic's `message_stop`).
    Stop,
}

/// Turns one line of a provider's stream into events. `end` runs once the stream is over.
pub trait Decoder {
    fn line(&mut self, line: &str, out: &mut Vec<StreamEvent>) -> Result<Flow, ProviderError>;
    fn end(&mut self, rest: &str, out: &mut Vec<StreamEvent>) -> Result<(), ProviderError>;
}

/// Reads a provider's bytes: holds a partial line until its end, and ends the answer at the first failure.
pub struct Stream<D: Decoder> {
    lines: LineSplitter,
    decoder: D,
    failed: bool,
    stopped: bool,
}

impl<D: Decoder> Stream<D> {
    pub fn new(decoder: D) -> Self {
        Self {
            lines: LineSplitter::default(),
            decoder,
            failed: false,
            stopped: false,
        }
    }

    /// The events the bytes so far produce. After a failure or a stop, nothing more comes.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        let mut out = Vec::new();
        if self.failed || self.stopped {
            return out;
        }
        for line in self.lines.push(bytes) {
            match self.decoder.line(&line, &mut out) {
                Ok(Flow::Continue) => {}
                Ok(Flow::DropRest) => {
                    self.lines.reset();
                    break;
                }
                Ok(Flow::Stop) => {
                    self.stopped = true;
                    break;
                }
                Err(error) => {
                    self.failed = true;
                    out.push(StreamEvent::Error { error });
                    return out;
                }
            }
        }
        out
    }

    /// The last events: the finish, or the failure that ends the answer.
    pub fn finish(&mut self) -> Vec<StreamEvent> {
        let mut out = Vec::new();
        if self.failed {
            return out;
        }
        let rest = self.lines.take_rest();
        if let Err(error) = self.decoder.end(&rest, &mut out) {
            out.push(StreamEvent::Error { error });
        }
        out
    }
}
