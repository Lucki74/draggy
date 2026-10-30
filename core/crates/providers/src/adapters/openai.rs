//! OpenAI-compatible chat completions, for cloud providers and local servers alike. The body is built from a
//! whitelist: Draggy's own fields never leave, and only its function tools are sent.

use std::collections::{BTreeMap, VecDeque};

use serde_json::{Map, Value, json};

use super::common::{
    Connection, Decoder, Flow, ListedModel, Stream, arguments_text, content_value, count, either,
    function_tools, hosted, level_of, non_empty, output_limit, quirk, refusal,
    response_arguments_text, text_of, text_or_empty, think_of,
};
use crate::errors::from_response_value;
use crate::http::{HttpRequest, Method};
use crate::js::{json_text, to_string, truthy};
use crate::types::{
    ChatMessage, ChatRequest, CompletedToolCall, Completion, FinishReason, ProviderError,
    StreamEvent, Usage,
};
use crate::usage::from_openai;

/// The request for one chat turn of the given model.
pub fn build_request(req: &ChatRequest, conn: &Connection, model_id: &str) -> HttpRequest {
    let model = model_id.strip_suffix(":online").unwrap_or(model_id);
    let mut payload = Map::new();
    payload.insert("model".to_owned(), json!(model));
    payload.insert(
        "messages".to_owned(),
        Value::Array(to_messages(&req.messages, conn)),
    );
    payload.insert("stream".to_owned(), json!(req.stream));
    if req.stream {
        payload.insert(
            "stream_options".to_owned(),
            json!({ "include_usage": true }),
        );
    }

    let tools: Vec<Value> = function_tools(&req.tools)
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
        .collect();
    if !tools.is_empty() {
        payload.insert("tools".to_owned(), Value::Array(tools));
    }

    let limit = output_limit(req);
    if limit > 0 {
        let field = quirk(conn, "maxTokensField")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("max_tokens");
        payload.insert(field.to_owned(), json!(limit));
    }
    if let Some(temperature) = req.temperature {
        payload.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(top_p) = req.top_p {
        payload.insert("top_p".to_owned(), json!(top_p));
    }

    // A reasoning model always reasons; "low" is the least the pill can ask, never an omitted default.
    let think = think_of(req);
    if truthy(quirk(conn, "reasoningEffort"))
        && let Some(on) = think
    {
        payload.insert(
            "reasoning_effort".to_owned(),
            json!(if on { level_of(req) } else { "low" }),
        );
    }
    if truthy(quirk(conn, "enableThinking"))
        && let Some(on) = think
    {
        payload.insert("enable_thinking".to_owned(), json!(on));
    }
    if truthy(quirk(conn, "templateKwargs")) {
        if let Some(kwargs) = &req.chat_template_kwargs {
            payload.insert(
                "chat_template_kwargs".to_owned(),
                Value::Object(kwargs.clone()),
            );
        }
        if let Some(format) = &req.response_format {
            payload.insert("response_format".to_owned(), format.clone());
        }
    }

    let mut headers = conn.headers.clone();
    headers.insert("Content-Type".to_owned(), "application/json".to_owned());
    if !conn.api_key.is_empty() {
        headers.insert(
            "Authorization".to_owned(),
            format!("Bearer {}", conn.api_key),
        );
    }
    HttpRequest {
        method: Method::Post,
        url: format!("{}/chat/completions", conn.base_url),
        headers,
        body: Some(json_text(&Value::Object(payload))),
        timeout_ms: None,
    }
}

/// The messages in the OpenAI shape. Calls and their results are paired by id, and a missing id is numbered.
fn to_messages(messages: &[ChatMessage], conn: &Connection) -> Vec<Value> {
    let mut pending: VecDeque<String> = VecDeque::new();
    let mut counter = 0usize;
    let keeps_reasoning = truthy(quirk(conn, "templateKwargs"));
    let mut out = Vec::with_capacity(messages.len());
    for message in messages {
        if message.role == "tool" {
            let id = match non_empty(message.tool_call_id.as_deref()) {
                Some(id) => id.to_owned(),
                None => pending.pop_front().unwrap_or_else(|| {
                    counter += 1;
                    format!("call_{}", counter - 1)
                }),
            };
            out.push(json!({ "role": "tool", "tool_call_id": id, "content": text_of(message.content.as_ref()) }));
            continue;
        }
        let mut object = Map::new();
        object.insert("role".to_owned(), json!(message.role));
        object.insert(
            "content".to_owned(),
            content_value(message.content.as_ref()),
        );
        if message.role == "assistant" && !message.tool_calls.is_empty() {
            pending.clear();
            let calls: Vec<Value> = message
                .tool_calls
                .iter()
                .map(|call| {
                    let id = match non_empty(call.id.as_deref()) {
                        Some(id) => id.to_owned(),
                        None => {
                            counter += 1;
                            format!("call_{}", counter - 1)
                        }
                    };
                    pending.push_back(id.clone());
                    json!({
                        "id": id,
                        "type": "function",
                        "function": {
                            "name": call.function.name.clone().unwrap_or_default(),
                            "arguments": arguments_text(&call.function.arguments),
                        },
                    })
                })
                .collect();
            object.insert("tool_calls".to_owned(), Value::Array(calls));
            if text_of(message.content.as_ref()).trim().is_empty() {
                object.insert("content".to_owned(), Value::Null);
            }
        }
        // Reasoning goes back only to a server that reads it; DeepSeek rejects it outright.
        if message.role == "assistant"
            && keeps_reasoning
            && let Some(thinking) = message.thinking.as_deref().filter(|text| !text.is_empty())
        {
            object.insert("reasoning_content".to_owned(), json!(thinking));
        }
        out.push(Value::Object(object));
    }
    out
}

/// The OpenAI stream as neutral events. A hosted tool or a content filter ends the answer with an error.
pub fn stream() -> Stream<OpenAiDecoder> {
    Stream::new(OpenAiDecoder::default())
}

/// The line decoder for OpenAI's `data:` events.
#[derive(Debug, Default)]
pub struct OpenAiDecoder {
    finish: Option<String>,
    usage: Usage,
}

impl Decoder for OpenAiDecoder {
    fn line(&mut self, raw: &str, out: &mut Vec<StreamEvent>) -> Result<Flow, ProviderError> {
        let Some(data) = raw.trim().strip_prefix("data:") else {
            return Ok(Flow::Continue);
        };
        let data = data.trim();
        // TS quirk: the reference drops only the rest of the current read at [DONE]; later reads are still read.
        if data == "[DONE]" {
            return Ok(Flow::DropRest);
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            return Ok(Flow::Continue);
        };
        if truthy(json.get("error")) {
            let status = if json.pointer("/error/code").and_then(Value::as_i64) == Some(429) {
                429
            } else {
                500
            };
            return Err(from_response_value(status, &json, &BTreeMap::new(), 0));
        }
        if let Some(usage) = json.get("usage").filter(|usage| truthy(Some(usage))) {
            self.usage = from_openai(Some(usage));
        }
        let Some(choice) = json
            .pointer("/choices/0")
            .filter(|choice| truthy(Some(choice)))
        else {
            return Ok(Flow::Continue);
        };
        let empty = Value::Object(Map::new());
        let delta = choice
            .get("delta")
            .filter(|delta| truthy(Some(delta)))
            .unwrap_or(&empty);

        let mut calls = Vec::new();
        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(kind) = call.get("type").filter(|kind| truthy(Some(kind)))
                && kind.as_str() != Some("function")
            {
                return Err(hosted(&to_string(kind)));
            }
            let function = call.get("function");
            calls.push(StreamEvent::ToolCallDelta {
                index: count(call.get("index")) as u32,
                id: non_empty(call.get("id").and_then(Value::as_str)).map(str::to_owned),
                name: non_empty(function.and_then(|f| f.get("name")).and_then(Value::as_str))
                    .map(str::to_owned),
                arguments: response_arguments_text(function.and_then(|f| f.get("arguments"))),
            });
        }
        let content = text_or_empty(delta.get("content"));
        let reasoning = either(text_or_empty(delta.get("reasoning_content")), || {
            text_or_empty(delta.get("reasoning"))
        });
        if !content.is_empty() {
            out.push(StreamEvent::TextDelta { text: content });
        }
        if !reasoning.is_empty() {
            out.push(StreamEvent::ReasoningDelta { text: reasoning });
        }
        out.extend(calls);
        if let Some(reason) = choice
            .get("finish_reason")
            .filter(|reason| truthy(Some(reason)))
        {
            self.finish = Some(to_string(reason));
        }
        Ok(Flow::Continue)
    }

    fn end(&mut self, _rest: &str, out: &mut Vec<StreamEvent>) -> Result<(), ProviderError> {
        if self.finish.as_deref() == Some("content_filter") {
            return Err(refusal("content_filter"));
        }
        let reason = match self.finish.as_deref() {
            Some("length") => FinishReason::Length,
            Some("tool_calls") => FinishReason::ToolCalls,
            _ => FinishReason::Stop,
        };
        out.push(StreamEvent::Finish {
            reason,
            usage: self.usage,
        });
        Ok(())
    }
}

/// A non-streaming answer as neutral form. A hosted call in it is an error.
pub fn translate_json(json: &Value) -> Result<Completion, ProviderError> {
    let empty = Value::Object(Map::new());
    let choice = json
        .pointer("/choices/0")
        .filter(|choice| truthy(Some(choice)))
        .unwrap_or(&empty);
    let message = choice
        .get("message")
        .filter(|message| truthy(Some(message)))
        .unwrap_or(&empty);
    let calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(kind) = calls
        .iter()
        .filter_map(|call| call.get("type").filter(|kind| truthy(Some(kind))))
        .find(|kind| kind.as_str() != Some("function"))
    {
        return Err(hosted(&to_string(kind)));
    }
    let tool_calls = calls
        .iter()
        .map(|call| {
            let function = call.get("function");
            CompletedToolCall {
                id: call.get("id").and_then(Value::as_str).map(str::to_owned),
                name: function
                    .and_then(|f| f.get("name"))
                    .map(to_string)
                    .filter(|name| !name.is_empty())
                    .unwrap_or_default(),
                arguments: response_arguments_text(function.and_then(|f| f.get("arguments"))),
            }
        })
        .collect();
    let reason = match choice.get("finish_reason").and_then(Value::as_str) {
        Some("length") => FinishReason::Length,
        Some("tool_calls") => FinishReason::ToolCalls,
        _ => FinishReason::Stop,
    };
    let reasoning = either(text_or_empty(message.get("reasoning_content")), || {
        text_or_empty(message.get("reasoning"))
    });
    Ok(Completion {
        content: text_or_empty(message.get("content")),
        reasoning,
        tool_calls,
        finish: reason,
        usage: from_openai(json.get("usage")),
        provider_state: None,
    })
}

/// The request that lists an instance's models.
pub fn models_request(conn: &Connection) -> HttpRequest {
    let mut headers = conn.headers.clone();
    if !conn.api_key.is_empty() {
        headers.insert(
            "Authorization".to_owned(),
            format!("Bearer {}", conn.api_key),
        );
    }
    HttpRequest {
        method: Method::Get,
        url: format!("{}/models", conn.base_url),
        headers,
        body: None,
        timeout_ms: None,
    }
}

/// The models in a listing. A model with no id is left out.
pub fn parse_models(json: &Value) -> Vec<ListedModel> {
    let list = json
        .get("data")
        .filter(|data| truthy(Some(data)))
        .or_else(|| json.get("models"))
        .and_then(Value::as_array);
    list.into_iter()
        .flatten()
        .filter_map(|model| {
            let id = either(text_or_empty(model.get("id")), || {
                text_or_empty(model.get("name"))
            });
            if id.is_empty() {
                return None;
            }
            let context_length = [
                model.get("context_length"),
                model.get("context_window"),
                model.get("max_context_length"),
                model.pointer("/top_provider/context_length"),
            ]
            .into_iter()
            .flatten()
            .find(|value| truthy(Some(value)))
            .and_then(|value| crate::js::count_or_none(Some(value)));
            Some(ListedModel {
                id,
                context_length,
                supported: model
                    .get("supported_parameters")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().map(to_string).collect()),
                input_modalities: model
                    .pointer("/architecture/input_modalities")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().map(to_string).collect()),
                ..ListedModel::default()
            })
        })
        .collect()
}
