//! Ollama's native /api/chat, whose `/v1` twin ignores the context size. It streams one JSON object per line and hands
//! tool calls whole, so they are numbered and passed on as they arrive.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::common::{
    Connection, Decoder, Flow, ListedModel, Stream, count, function_tools, non_empty, output_limit,
    text_or_empty, think_of,
};
use crate::errors::from_response_value;
use crate::http::{HttpRequest, Method};
use crate::js::{self, json_text, truthy};
use crate::types::{
    ChatMessage, ChatRequest, CompletedToolCall, Completion, Content, ContentPart, ErrorKind,
    FinishReason, ProviderError, StreamEvent, ToolSpec, Usage,
};

/// The request for one chat turn of the given model. Ollama takes no key, so none is sent.
pub fn build_request(req: &ChatRequest, conn: &Connection, model_id: &str) -> HttpRequest {
    let mut payload = Map::new();
    payload.insert("model".to_owned(), json!(model_id));
    payload.insert(
        "messages".to_owned(),
        Value::Array(to_messages(&req.messages)),
    );
    payload.insert("stream".to_owned(), json!(req.stream));
    let tools = tools_of(&req.tools);
    if !tools.is_empty() {
        payload.insert("tools".to_owned(), Value::Array(tools));
    }

    let mut options = Map::new();
    if req.options.num_ctx.unwrap_or(0) > 0 {
        options.insert(
            "num_ctx".to_owned(),
            json!(req.options.num_ctx.unwrap_or(0)),
        );
    }
    let limit = output_limit(req);
    if limit > 0 {
        options.insert("num_predict".to_owned(), json!(limit));
    }
    if let Some(temperature) = req.temperature {
        options.insert("temperature".to_owned(), json!(temperature));
    }
    if !options.is_empty() {
        payload.insert("options".to_owned(), Value::Object(options));
    }
    if let Some(on) = think_of(req) {
        payload.insert("think".to_owned(), json!(on));
    }
    if let Some(schema) = req
        .response_format
        .as_ref()
        .and_then(|format| format.pointer("/json_schema/schema"))
        .filter(|s| truthy(Some(s)))
    {
        payload.insert("format".to_owned(), schema.clone());
    }

    let mut headers = conn.headers.clone();
    headers.insert("Content-Type".to_owned(), "application/json".to_owned());
    HttpRequest {
        method: Method::Post,
        url: format!("{}/api/chat", conn.base_url),
        headers,
        body: Some(json_text(&Value::Object(payload))),
        timeout_ms: None,
    }
}

fn tools_of(tools: &[ToolSpec]) -> Vec<Value> {
    function_tools(tools)
        .into_iter()
        .map(|function| {
            json!({
                "type": "function",
                "function": {
                    "name": function.name.clone().unwrap_or_default(),
                    "description": function.description.clone().unwrap_or_default(),
                    "parameters": function.parameters.clone().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                },
            })
        })
        .collect()
}

/// Text parts join into `content`; images become Ollama's bare base64 `images`.
fn to_messages(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let mut out = Map::new();
            out.insert("role".to_owned(), json!(message.role));
            match &message.content {
                Some(Content::Parts(parts)) => {
                    let text = parts
                        .iter()
                        .filter_map(|part| match part {
                            ContentPart::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    out.insert("content".to_owned(), json!(text));
                    let images: Vec<Value> = parts
                        .iter()
                        .filter_map(|part| match part {
                            ContentPart::ImageUrl { image_url } => Some(json!(strip_data_prefix(&image_url.url))),
                            _ => None,
                        })
                        .collect();
                    if !images.is_empty() {
                        out.insert("images".to_owned(), Value::Array(images));
                    }
                }
                Some(Content::Text(text)) => {
                    out.insert("content".to_owned(), json!(text));
                }
                None => {
                    out.insert("content".to_owned(), json!(""));
                }
            }
            if message.role == "assistant"
                && let Some(thinking) = message.thinking.as_deref().filter(|text| !text.is_empty())
            {
                out.insert("thinking".to_owned(), json!(thinking));
            }
            if message.role == "assistant" && !message.tool_calls.is_empty() {
                let calls: Vec<Value> = message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        let arguments = match &call.function.arguments {
                            Value::String(text) => serde_json::from_str::<Value>(text).unwrap_or_else(|_| json!({})),
                            other => other.clone(),
                        };
                        let arguments = if arguments.is_null() { json!({}) } else { arguments };
                        json!({ "function": { "name": call.function.name.clone().unwrap_or_default(), "arguments": arguments } })
                    })
                    .collect();
                out.insert("tool_calls".to_owned(), Value::Array(calls));
            }
            if message.role == "tool"
                && let Some(name) = non_empty(message.tool_name.as_deref())
            {
                out.insert("tool_name".to_owned(), json!(name));
            }
            Value::Object(out)
        })
        .collect()
}

/// A data URL's prefix up to its first comma, as Ollama wants the bare base64 after it.
fn strip_data_prefix(url: &str) -> String {
    match url
        .strip_prefix("data:")
        .and_then(|rest| rest.find(',').map(|at| &rest[at + 1..]))
    {
        Some(data) => data.to_owned(),
        None => url.to_owned(),
    }
}

fn usage_of(json: &Value) -> Usage {
    Usage {
        prompt_tokens: count(json.get("prompt_eval_count")),
        output_tokens: count(json.get("eval_count")),
    }
}

/// The line decoder for Ollama. A line that is not JSON ends the answer, as the reference throws on it.
#[derive(Debug, Default)]
pub struct OllamaDecoder {
    calls: u32,
    last: Option<Value>,
}

/// The Ollama stream as neutral events.
pub fn stream() -> Stream<OllamaDecoder> {
    Stream::new(OllamaDecoder::default())
}

impl Decoder for OllamaDecoder {
    fn line(&mut self, raw: &str, out: &mut Vec<StreamEvent>) -> Result<Flow, ProviderError> {
        if raw.trim().is_empty() {
            return Ok(Flow::Continue);
        }
        // TS quirk: the reference throws on a line that is not JSON and reports an empty error object; the port reports the kind alone.
        let json = serde_json::from_str::<Value>(raw)
            .map_err(|_| ProviderError::kind_only(ErrorKind::UnknownError))?;
        if truthy(json.get("error")) {
            let error = json.get("error").cloned().unwrap_or(Value::Null);
            return Err(from_response_value(
                500,
                &serde_json::json!({ "error": { "message": error } }),
                &BTreeMap::new(),
                0,
            ));
        }
        let message = json
            .get("message")
            .filter(|message| truthy(Some(message)))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let content = text_or_empty(message.get("content"));
        let reasoning = text_or_empty(message.get("thinking"));
        if !content.is_empty() {
            out.push(StreamEvent::TextDelta { text: content });
        }
        if !reasoning.is_empty() {
            out.push(StreamEvent::ReasoningDelta { text: reasoning });
        }
        for call in message
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let index = self.calls;
            self.calls += 1;
            let function = call.get("function");
            out.push(StreamEvent::ToolCallDelta {
                index,
                id: Some(format!("call_{index}")),
                name: non_empty(function.and_then(|f| f.get("name")).and_then(Value::as_str))
                    .map(str::to_owned),
                arguments: json_text(
                    &function
                        .and_then(|f| f.get("arguments"))
                        .filter(|a| !a.is_null())
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                ),
            });
        }
        if truthy(json.get("done")) {
            self.last = Some(json);
        }
        Ok(Flow::Continue)
    }

    fn end(&mut self, rest: &str, out: &mut Vec<StreamEvent>) -> Result<(), ProviderError> {
        if !rest.trim().is_empty() {
            self.line(rest, out)?;
        }
        let last = self.last.clone().unwrap_or_else(|| json!({}));
        let reason = if last.get("done_reason").and_then(Value::as_str) == Some("length") {
            FinishReason::Length
        } else if self.calls > 0 {
            FinishReason::ToolCalls
        } else {
            FinishReason::Stop
        };
        out.push(StreamEvent::Finish {
            reason,
            usage: usage_of(&last),
        });
        Ok(())
    }
}

/// A non-streaming answer as neutral form. Calls are numbered from zero.
pub fn translate_json(json: &Value) -> Completion {
    let message = json
        .get("message")
        .filter(|m| truthy(Some(m)))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let tool_calls: Vec<CompletedToolCall> = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, call)| {
            let function = call.get("function");
            CompletedToolCall {
                id: Some(format!("call_{index}")),
                name: function
                    .and_then(|f| f.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                arguments: json_text(
                    &function
                        .and_then(|f| f.get("arguments"))
                        .filter(|a| !a.is_null())
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                ),
            }
        })
        .collect();
    let finish = if json.get("done_reason").and_then(Value::as_str) == Some("length") {
        FinishReason::Length
    } else if !tool_calls.is_empty() {
        FinishReason::ToolCalls
    } else {
        FinishReason::Stop
    };
    Completion {
        content: text_or_empty(message.get("content")),
        reasoning: text_or_empty(message.get("thinking")),
        tool_calls,
        finish,
        usage: usage_of(json),
        provider_state: None,
    }
}

/// The request that lists the models the local server has pulled.
pub fn models_request(conn: &Connection) -> HttpRequest {
    HttpRequest {
        method: Method::Get,
        url: format!("{}/api/tags", conn.base_url),
        headers: conn.headers.clone(),
        body: None,
        timeout_ms: None,
    }
}

/// A model served from Ollama's cloud rather than this computer: its data leaves the machine.
fn is_cloud(model: &Value) -> bool {
    let name = text_or_empty(
        model
            .get("name")
            .filter(|n| truthy(Some(n)))
            .or_else(|| model.get("model")),
    );
    name.ends_with(":cloud") || name.ends_with("-cloud") || truthy(model.get("remote_host"))
}

pub fn parse_models(json: &Value) -> Vec<ListedModel> {
    json.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = text_or_empty(
                model
                    .get("name")
                    .filter(|n| truthy(Some(n)))
                    .or_else(|| model.get("model")),
            );
            (!id.is_empty()).then(|| ListedModel {
                id,
                cloud: is_cloud(model),
                ..ListedModel::default()
            })
        })
        .collect()
}

/// What a model can do and its window, from `/api/show`.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelShow {
    pub capabilities: Vec<String>,
    pub context_length: Option<u64>,
}

/// The request that asks one model what it can do.
pub fn show_request(conn: &Connection, model_id: &str) -> HttpRequest {
    let mut headers = conn.headers.clone();
    headers.insert("Content-Type".to_owned(), "application/json".to_owned());
    HttpRequest {
        method: Method::Post,
        url: format!("{}/api/show", conn.base_url),
        headers,
        body: Some(json_text(&json!({ "model": model_id }))),
        timeout_ms: None,
    }
}

pub fn parse_show(json: &Value) -> ModelShow {
    let info = json.get("model_info").and_then(Value::as_object);
    let context_key =
        info.and_then(|info| info.keys().find(|key| key.ends_with(".context_length")));
    let context_length = match (info, context_key) {
        (Some(info), Some(key)) => js::count_or_none(info.get(key)),
        _ => None,
    };
    let capabilities = json
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|c| ["tools", "vision", "thinking"].contains(c))
        .map(str::to_owned)
        .collect();
    ModelShow {
        capabilities,
        context_length,
    }
}
