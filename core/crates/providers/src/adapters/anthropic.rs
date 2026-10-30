//! Anthropic's Messages API. The body is built from a whitelist, only Draggy's function tools go out, and signed
//! thinking travels back to the instance that wrote it, never to anyone else.

use std::collections::{HashMap, VecDeque};

use serde_json::{Map, Value, json};

use super::common::{
    Connection, Decoder, Flow, ListedModel, Stream, arguments_object, function_tools, hosted,
    level_of, non_empty, output_limit, parse_data_url, refusal, text_of, text_or_empty, think_of,
};
use crate::catalog::capabilities_for;
use crate::errors::from_response_value;
use crate::http::{HttpRequest, Method};
use crate::js::{json_text, truthy};
use crate::types::{
    ChatMessage, ChatRequest, CompletedToolCall, Completion, Content, ContentPart, FinishReason,
    ProviderError, StreamEvent,
};
use crate::usage::from_anthropic;
use std::collections::BTreeMap;

const VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: i64 = 32_000;
const MIN_BUDGET: i64 = 1024;
/// Claude 4.5 and older only think between tool calls with this beta header.
const INTERLEAVED: &str = "interleaved-thinking-2025-05-14";

/// Which thinking switch a model takes, by its id: `claude-<family>-<major>[-<minor>]`. The names match the reference.
pub fn thinking_style(model_id: &str) -> &'static str {
    let id = model_id.to_lowercase();
    if let Some(rest) = id.strip_prefix("claude-") {
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && rest[digits..].starts_with('-') {
            return "budget";
        }
    }
    let Some(rest) = id.strip_prefix("claude-") else {
        return "adaptive-only";
    };
    let family_len = rest.chars().take_while(char::is_ascii_lowercase).count();
    if family_len == 0 || !rest[family_len..].starts_with('-') {
        return "adaptive-only";
    }
    let family = &rest[..family_len];
    let after = &rest[family_len + 1..];
    let major_len = after.chars().take_while(char::is_ascii_digit).count();
    if major_len == 0 {
        return "adaptive-only";
    }
    let major: f64 = after[..major_len].parse().unwrap_or(0.0);
    let tail = &after[major_len..];
    let mut minor = 0.0;
    if let Some(minor_text) = tail.strip_prefix('-') {
        let minor_len = minor_text.chars().take_while(char::is_ascii_digit).count();
        // A minor of one or two digits counts; three digits are read as no minor at all.
        if (1..=2).contains(&minor_len) {
            minor = minor_text[..minor_len].parse::<f64>().unwrap_or(0.0);
        }
    }
    let version = major + minor / 10.0;
    if family == "fable" || family == "mythos" {
        return "adaptive-only";
    }
    if version < 4.6 {
        return "budget";
    }
    if version < 5.0 {
        return "adaptive-off-by-default";
    }
    if version >= 5.5 {
        return if family == "sonnet" {
            "between-tools"
        } else {
            "adaptive-only"
        };
    }
    "adaptive"
}

/// The thinking fields for a request, and whether the interleaved beta header goes with them.
fn thinking_of(req: &ChatRequest, model: &str, max_tokens: i64) -> (Map<String, Value>, bool) {
    let think = think_of(req);
    let level = level_of(req);
    let on = think == Some(true) && level != "low";
    let style = thinking_style(model);
    let mut fields = Map::new();
    if style == "budget" {
        if !on || max_tokens <= 2 * MIN_BUDGET {
            return (fields, false);
        }
        let asked = if level == "high" { 24_576 } else { 8_192 };
        let budget = asked.min(max_tokens - MIN_BUDGET).max(MIN_BUDGET);
        fields.insert(
            "thinking".to_owned(),
            json!({ "type": "enabled", "budget_tokens": budget }),
        );
        return (fields, true);
    }
    let adaptive = json!({ "type": "adaptive", "display": "summarized" });
    if on {
        fields.insert("thinking".to_owned(), adaptive);
        fields.insert("output_config".to_owned(), json!({ "effort": level }));
        return (fields, false);
    }
    if think.is_none() && style == "adaptive-off-by-default" {
        return (fields, false);
    }
    // Where "disabled" is refused, the least thinking the model allows is asked for instead.
    match style {
        "adaptive-only" => {
            fields.insert("thinking".to_owned(), adaptive);
            fields.insert("output_config".to_owned(), json!({ "effort": "low" }));
        }
        "between-tools" => {
            fields.insert("thinking".to_owned(), json!({ "type": "between_tools" }));
            fields.insert("output_config".to_owned(), json!({ "effort": "low" }));
        }
        _ => {
            fields.insert("thinking".to_owned(), json!({ "type": "disabled" }));
        }
    }
    (fields, false)
}

/// The request for one chat turn of the given model.
pub fn build_request(req: &ChatRequest, conn: &Connection, model_id: &str) -> HttpRequest {
    let asked = output_limit(req);
    let max_tokens = if asked > 0 {
        asked
    } else {
        // A zero limit is no limit, as the reference's `||` reads it.
        capabilities_for(conn.entry.as_ref(), model_id)
            .max_output_tokens
            .filter(|limit| *limit > 0)
            .map_or(DEFAULT_MAX_TOKENS, |limit| limit as i64)
    };
    let (system, messages) = to_messages(&req.messages, conn.instance_id.as_deref());
    let mut payload = Map::new();
    payload.insert("model".to_owned(), json!(model_id));
    payload.insert("max_tokens".to_owned(), json!(max_tokens));
    payload.insert("messages".to_owned(), Value::Array(messages));
    if !system.is_empty() {
        payload.insert(
            "system".to_owned(),
            json!([{ "type": "text", "text": system, "cache_control": { "type": "ephemeral" } }]),
        );
    }
    let mut tools: Vec<Value> = function_tools(&req.tools)
        .into_iter()
        .map(|function| {
            json!({
                "name": function.name.clone().unwrap_or_default(),
                "description": function.description.clone().unwrap_or_default(),
                "input_schema": function.parameters.clone().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            })
        })
        .collect();
    if let Some(last) = tools.last_mut().and_then(Value::as_object_mut) {
        last.insert("cache_control".to_owned(), json!({ "type": "ephemeral" }));
    }
    if !tools.is_empty() {
        payload.insert("tools".to_owned(), Value::Array(tools));
    }
    if req.stream {
        payload.insert("stream".to_owned(), json!(true));
    }
    // Sampling fields are left out: newer Claude models refuse them, and thinking requires the defaults.
    let (fields, interleaved) = thinking_of(req, model_id, max_tokens);
    payload.extend(fields);

    let mut headers = conn.headers.clone();
    headers.insert("Content-Type".to_owned(), "application/json".to_owned());
    headers.insert("anthropic-version".to_owned(), VERSION.to_owned());
    if !conn.api_key.is_empty() {
        headers.insert("x-api-key".to_owned(), conn.api_key.clone());
    }
    if interleaved {
        headers.insert("anthropic-beta".to_owned(), INTERLEAVED.to_owned());
    }
    HttpRequest {
        method: Method::Post,
        url: format!("{}/messages", conn.base_url),
        headers,
        body: Some(json_text(&Value::Object(payload))),
        timeout_ms: None,
    }
}

/// Anthropic's ids allow only letters, digits, `_` and `-`; each other UTF-16 unit becomes an underscore.
fn safe_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for c in id.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
        } else {
            for _ in 0..c.len_utf16() {
                out.push('_');
            }
        }
    }
    out
}

fn image_block(url: &str) -> Value {
    match parse_data_url(url) {
        Some((media_type, data)) => {
            json!({ "type": "image", "source": { "type": "base64", "media_type": media_type, "data": data } })
        }
        None => json!({ "type": "image", "source": { "type": "url", "url": url } }),
    }
}

/// The text and image blocks of a message's content; text with no words in it is left out.
fn content_blocks(content: Option<&Content>) -> Vec<Value> {
    match content {
        None => Vec::new(),
        Some(Content::Text(text)) if text.trim().is_empty() => Vec::new(),
        Some(Content::Text(text)) => vec![json!({ "type": "text", "text": text })],
        Some(Content::Parts(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text } if !text.trim().is_empty() => {
                    Some(json!({ "type": "text", "text": text }))
                }
                ContentPart::ImageUrl { image_url } if !image_url.url.is_empty() => {
                    Some(image_block(&image_url.url))
                }
                _ => None,
            })
            .collect(),
    }
}

/// The signed blocks this instance wrote. A bare thinking field has no signature and is never sent.
fn signed_blocks(message: &ChatMessage, instance_id: Option<&str>) -> Vec<Value> {
    let Some(id) = instance_id else {
        return Vec::new();
    };
    let Some(tagged) = message
        .provider_state
        .as_ref()
        .filter(|tagged| tagged.instance_id == id)
    else {
        return Vec::new();
    };
    let Some(blocks) = tagged.state.get("blocks").and_then(Value::as_array) else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|block| {
            let kind = block.get("type").and_then(Value::as_str);
            (kind == Some("thinking")
                && non_empty(block.get("signature").and_then(Value::as_str)).is_some())
                || (kind == Some("redacted_thinking") && truthy(block.get("data")))
        })
        .cloned()
        .collect()
}

/// The system text and the merged turns: consecutive turns from one role become one message of blocks.
fn to_messages(messages: &[ChatMessage], instance_id: Option<&str>) -> (String, Vec<Value>) {
    let mut system: Vec<String> = Vec::new();
    let mut turns: Vec<(&str, Vec<Value>)> = Vec::new();
    let mut pending: VecDeque<String> = VecDeque::new();
    let mut counter = 0usize;
    for message in messages {
        match message.role.as_str() {
            "system" => {
                let text = match &message.content {
                    None => String::new(),
                    Some(Content::Text(text)) => {
                        if text.trim().is_empty() {
                            String::new()
                        } else {
                            text.clone()
                        }
                    }
                    Some(Content::Parts(parts)) => parts
                        .iter()
                        .filter_map(|part| match part {
                            ContentPart::Text { text } if !text.trim().is_empty() => {
                                Some(text.as_str())
                            }
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n"),
                };
                if !text.is_empty() {
                    system.push(text);
                }
            }
            "tool" => {
                let id = match non_empty(message.tool_call_id.as_deref()) {
                    Some(id) => safe_id(id),
                    None => pending.pop_front().unwrap_or_else(|| {
                        counter += 1;
                        format!("call_{}", counter - 1)
                    }),
                };
                let text = text_of(message.content.as_ref());
                let mut block = json!({ "type": "tool_result", "tool_use_id": id });
                if !text.is_empty() {
                    block["content"] = json!(text);
                }
                push_turn(&mut turns, "user", vec![block]);
            }
            "assistant" => {
                if !message.tool_calls.is_empty() {
                    pending.clear();
                }
                let uses: Vec<Value> = message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        let id = match non_empty(call.id.as_deref()) {
                            Some(id) => safe_id(id),
                            None => {
                                counter += 1;
                                format!("call_{}", counter - 1)
                            }
                        };
                        pending.push_back(id.clone());
                        json!({ "type": "tool_use", "id": id, "name": call.function.name.clone().unwrap_or_default(), "input": arguments_object(&call.function.arguments) })
                    })
                    .collect();
                let mut blocks = signed_blocks(message, instance_id);
                blocks.extend(content_blocks(message.content.as_ref()));
                blocks.extend(uses);
                push_turn(&mut turns, "assistant", blocks);
            }
            _ => push_turn(&mut turns, "user", content_blocks(message.content.as_ref())),
        }
    }
    let messages = turns
        .into_iter()
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect();
    (system.join("\n\n"), messages)
}

fn push_turn<'a>(turns: &mut Vec<(&'a str, Vec<Value>)>, role: &'a str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    match turns.last_mut() {
        Some((last, content)) if *last == role => content.extend(blocks),
        _ => turns.push((role, blocks)),
    }
}

/// A failed event as the reference names it: its error type sets the status.
fn failure_of(error: &Value) -> ProviderError {
    let status = match error.get("type").and_then(Value::as_str) {
        Some("overloaded_error") => 529,
        Some("rate_limit_error") => 429,
        _ => 500,
    };
    from_response_value(status, &json!({ "error": error }), &BTreeMap::new(), 0)
}

/// Whether a block is one Draggy has no way to run: a server tool or an MCP call the model made by itself.
fn is_hosted(kind: &str) -> bool {
    kind == "server_tool_use" || kind == "mcp_tool_use" || kind.ends_with("_tool_result")
}

fn finish_of(stop: Option<&str>) -> Result<FinishReason, ProviderError> {
    match stop {
        Some("refusal") => Err(refusal("refusal")),
        Some("max_tokens") => Ok(FinishReason::Length),
        Some("tool_use") => Ok(FinishReason::ToolCalls),
        _ => Ok(FinishReason::Stop),
    }
}

/// A content block as the stream opened it, kept until it stops.
#[derive(Debug, Clone)]
enum Block {
    ToolUse { index: u32, args: bool },
    Thinking { thinking: String, signature: String },
    Other,
}

/// The line decoder for Anthropic's `data:` events. The signed thinking comes back tagged for `instance_id`.
#[derive(Debug)]
pub struct AnthropicDecoder {
    instance_id: Option<String>,
    blocks: HashMap<u64, Block>,
    signed: Vec<Value>,
    tool_index: u32,
    stop: Option<String>,
    /// Every count the stream has reported so far, later ones replacing earlier.
    counts: serde_json::Map<String, Value>,
}

/// The Anthropic stream as neutral events.
pub fn stream(instance_id: Option<&str>) -> Stream<AnthropicDecoder> {
    Stream::new(AnthropicDecoder {
        instance_id: instance_id.map(str::to_owned),
        blocks: HashMap::new(),
        signed: Vec::new(),
        tool_index: 0,
        stop: None,
        counts: serde_json::Map::new(),
    })
}

impl AnthropicDecoder {
    fn handle(&mut self, json: &Value, out: &mut Vec<StreamEvent>) -> Result<bool, ProviderError> {
        let index = json.get("index").and_then(Value::as_u64).unwrap_or(0);
        let kind = json.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "error" => return Err(failure_of(json.get("error").unwrap_or(&Value::Null))),
            "message_start" => {
                if let Some(usage) = json.pointer("/message/usage").and_then(Value::as_object) {
                    self.counts.extend(usage.clone());
                }
            }
            "content_block_start" => {
                let block = json.get("content_block").cloned().unwrap_or(Value::Null);
                let block_kind = block.get("type").and_then(Value::as_str).unwrap_or("");
                if is_hosted(block_kind) {
                    return Err(hosted(block_kind));
                }
                match block_kind {
                    "tool_use" => {
                        let tool = self.tool_index;
                        self.tool_index += 1;
                        self.blocks.insert(
                            index,
                            Block::ToolUse {
                                index: tool,
                                args: false,
                            },
                        );
                        out.push(StreamEvent::ToolCallDelta {
                            index: tool,
                            id: non_empty(block.get("id").and_then(Value::as_str))
                                .map(str::to_owned),
                            name: non_empty(block.get("name").and_then(Value::as_str))
                                .map(str::to_owned),
                            arguments: String::new(),
                        });
                    }
                    "thinking" => {
                        self.blocks.insert(
                            index,
                            Block::Thinking {
                                thinking: text_or_empty(block.get("thinking")),
                                signature: text_or_empty(block.get("signature")),
                            },
                        );
                    }
                    "redacted_thinking" => {
                        let mut kept = Map::new();
                        kept.insert("type".to_owned(), json!("redacted_thinking"));
                        if let Some(data) = block.get("data") {
                            kept.insert("data".to_owned(), data.clone());
                        }
                        self.signed.push(Value::Object(kept));
                    }
                    _ => {
                        self.blocks.insert(index, Block::Other);
                    }
                }
            }
            "content_block_delta" => {
                let delta = json.get("delta").cloned().unwrap_or(Value::Null);
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => {
                        let text = text_or_empty(delta.get("text"));
                        if !text.is_empty() {
                            out.push(StreamEvent::TextDelta { text });
                        }
                    }
                    "thinking_delta" => {
                        let piece = text_or_empty(delta.get("thinking"));
                        if let Some(Block::Thinking { thinking, .. }) = self.blocks.get_mut(&index)
                        {
                            thinking.push_str(&piece);
                        }
                        if !piece.is_empty() {
                            out.push(StreamEvent::ReasoningDelta { text: piece });
                        }
                    }
                    "signature_delta" => {
                        if let Some(Block::Thinking { signature, .. }) = self.blocks.get_mut(&index)
                        {
                            *signature = text_or_empty(delta.get("signature"));
                        }
                    }
                    "input_json_delta" => {
                        if let Some(Block::ToolUse { index: tool, args }) =
                            self.blocks.get_mut(&index)
                        {
                            *args = true;
                            out.push(StreamEvent::ToolCallDelta {
                                index: *tool,
                                id: None,
                                name: None,
                                arguments: text_or_empty(delta.get("partial_json")),
                            });
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                match self.blocks.get(&index) {
                    Some(Block::ToolUse {
                        index: tool,
                        args: false,
                    }) => {
                        // A call with no arguments streams none, and an empty string is not an object.
                        out.push(StreamEvent::ToolCallDelta {
                            index: *tool,
                            id: None,
                            name: None,
                            arguments: "{}".to_owned(),
                        });
                    }
                    Some(Block::Thinking {
                        thinking,
                        signature,
                    }) if !signature.is_empty() => {
                        self.signed.push(json!({ "type": "thinking", "thinking": thinking, "signature": signature }));
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(reason) = json
                    .pointer("/delta/stop_reason")
                    .and_then(Value::as_str)
                    .filter(|r| !r.is_empty())
                {
                    self.stop = Some(reason.to_owned());
                }
                if let Some(usage) = json.get("usage").and_then(Value::as_object) {
                    for (key, value) in usage.iter().filter(|(_, value)| value.is_number()) {
                        self.counts.insert(key.clone(), value.clone());
                    }
                }
            }
            "message_stop" => return Ok(true),
            _ => {}
        }
        Ok(false)
    }
}

impl Decoder for AnthropicDecoder {
    fn line(&mut self, raw: &str, out: &mut Vec<StreamEvent>) -> Result<Flow, ProviderError> {
        let Some(data) = raw.trim().strip_prefix("data:") else {
            return Ok(Flow::Continue);
        };
        let Ok(json) = serde_json::from_str::<Value>(data.trim()) else {
            return Ok(Flow::Continue);
        };
        Ok(if self.handle(&json, out)? {
            Flow::Stop
        } else {
            Flow::Continue
        })
    }

    fn end(&mut self, _rest: &str, out: &mut Vec<StreamEvent>) -> Result<(), ProviderError> {
        let reason = finish_of(self.stop.as_deref())?;
        if let Some(instance_id) = self.instance_id.clone().filter(|_| !self.signed.is_empty()) {
            let state = crate::types::ProviderState {
                instance_id,
                state: json!({ "blocks": self.signed }),
            };
            out.push(StreamEvent::ProviderState { state });
        }
        out.push(StreamEvent::Finish {
            reason,
            usage: from_anthropic(Some(&Value::Object(std::mem::take(&mut self.counts)))),
        });
        Ok(())
    }
}

/// A non-streaming answer as neutral form, with its signed thinking. A hosted block in it is an error.
pub fn translate_json(
    json: &Value,
    instance_id: Option<&str>,
) -> Result<Completion, ProviderError> {
    let blocks = json
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(kind) = blocks
        .iter()
        .filter_map(|block| block.get("type").and_then(Value::as_str))
        .find(|kind| is_hosted(kind))
    {
        return Err(hosted(kind));
    }
    let signed: Vec<Value> = blocks
        .iter()
        .filter_map(|block| match block.get("type").and_then(Value::as_str) {
            Some("thinking") if truthy(block.get("signature")) => {
                Some(json!({ "type": "thinking", "thinking": text_or_empty(block.get("thinking")), "signature": block.get("signature") }))
            }
            Some("redacted_thinking") => {
                let mut kept = Map::new();
                kept.insert("type".to_owned(), json!("redacted_thinking"));
                if let Some(data) = block.get("data") {
                    kept.insert("data".to_owned(), data.clone());
                }
                Some(Value::Object(kept))
            }
            _ => None,
        })
        .collect();
    let content = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .map(|block| text_or_empty(block.get("text")))
        .collect::<String>();
    let reasoning = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        .map(|block| text_or_empty(block.get("thinking")))
        .collect::<String>();
    let tool_calls = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        .map(|block| CompletedToolCall {
            id: block.get("id").and_then(Value::as_str).map(str::to_owned),
            name: block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            arguments: json_text(
                block
                    .get("input")
                    .filter(|input| !input.is_null())
                    .unwrap_or(&json!({})),
            ),
        })
        .collect();
    let finish = finish_of(json.get("stop_reason").and_then(Value::as_str))?;
    let provider_state =
        instance_id
            .filter(|_| !signed.is_empty())
            .map(|id| crate::types::ProviderState {
                instance_id: id.to_owned(),
                state: json!({ "blocks": signed }),
            });
    Ok(Completion {
        content,
        reasoning,
        tool_calls,
        finish,
        usage: from_anthropic(json.get("usage")),
        provider_state,
    })
}

/// The request that lists an instance's models.
pub fn models_request(conn: &Connection) -> HttpRequest {
    let mut headers = conn.headers.clone();
    headers.insert("anthropic-version".to_owned(), VERSION.to_owned());
    if !conn.api_key.is_empty() {
        headers.insert("x-api-key".to_owned(), conn.api_key.clone());
    }
    HttpRequest {
        method: Method::Get,
        url: format!("{}/models?limit=1000", conn.base_url),
        headers,
        body: None,
        timeout_ms: None,
    }
}

/// The models in a listing, with their input window. A model with no id is left out.
pub fn parse_models(json: &Value) -> Vec<ListedModel> {
    json.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = text_or_empty(model.get("id"));
            (!id.is_empty()).then(|| ListedModel {
                id,
                context_length: crate::js::count_or_none(model.get("max_input_tokens")),
                ..ListedModel::default()
            })
        })
        .collect()
}
