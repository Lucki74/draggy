//! OpenAI Responses API on top of chat completions: the request in, and the reply or stream out.
//!
//! Not supported: built-in tools such as web search, and reasoning items.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::dialect::{Event, Translator, id_suffix, read_answer, usage_of};

/// The chat request for a Responses request body.
pub fn to_chat(body: &Value) -> Result<Value, String> {
    to_chat_after(body, &[])
}

/// The instructions of a request, when it has any.
fn instructions(object: &Map<String, Value>) -> Option<&str> {
    object
        .get("instructions")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

/// The chat request for a body that continues the chat `prior`. Instructions are the request's own and come first.
pub fn to_chat_after(body: &Value, prior: &[Value]) -> Result<Value, String> {
    let object = body
        .as_object()
        .ok_or_else(|| "The body must be a JSON object.".to_owned())?;

    let mut messages: Vec<Value> = Vec::new();
    if let Some(text) = instructions(object) {
        messages.push(json!({"role": "system", "content": text}));
    }
    messages.extend(prior.iter().cloned());
    match object.get("input") {
        Some(Value::String(text)) => messages.push(json!({"role": "user", "content": text})),
        Some(Value::Array(items)) => {
            for item in items {
                read_item(item, &mut messages);
            }
        }
        _ => return Err("input must be a string or an array of items.".to_owned()),
    }
    if messages.iter().all(|m| m["role"] == "system") {
        return Err("input needs at least one item.".to_owned());
    }

    let stream = object.get("stream") == Some(&Value::Bool(true));
    let mut chat = Map::new();
    chat.insert(
        "model".to_owned(),
        object.get("model").cloned().unwrap_or_else(|| json!("")),
    );
    chat.insert("messages".to_owned(), Value::Array(messages));
    chat.insert("stream".to_owned(), Value::Bool(stream));
    if stream {
        chat.insert("stream_options".to_owned(), json!({"include_usage": true}));
    }

    let tools = read_tools(object.get("tools"));
    if !tools.is_empty() {
        chat.insert("tools".to_owned(), Value::Array(tools));
        if let Some(choice) = read_choice(object.get("tool_choice")) {
            chat.insert("tool_choice".to_owned(), choice);
        }
        if let Some(flag) = object.get("parallel_tool_calls").filter(|v| v.is_boolean()) {
            chat.insert("parallel_tool_calls".to_owned(), flag.clone());
        }
    }
    for (from, to) in [
        ("max_output_tokens", "max_tokens"),
        ("temperature", "temperature"),
        ("top_p", "top_p"),
    ] {
        if let Some(value) = object.get(from).filter(|v| v.is_number()) {
            chat.insert(to.to_owned(), value.clone());
        }
    }
    if let Some(format) = read_format(object.get("text")) {
        chat.insert("response_format".to_owned(), format);
    }
    Ok(Value::Object(chat))
}

/// The chat messages of `chat` that belong to the exchange: all but the request's own instructions.
pub fn kept_messages(body: &Value, chat: &Value) -> Vec<Value> {
    let skip = usize::from(body.as_object().and_then(instructions).is_some());
    chat["messages"].as_array().map_or_else(Vec::new, |all| all.iter().skip(skip).cloned().collect())
}

/// The fields a Response object carries about its request.
pub fn meta(body: &Value) -> Map<String, Value> {
    let mut meta = Map::new();
    let previous = body.get("previous_response_id").filter(|id| id.is_string());
    meta.insert("previous_response_id".to_owned(), previous.cloned().unwrap_or(Value::Null));
    meta.insert("instructions".to_owned(), body.get("instructions").filter(|v| v.is_string()).cloned().unwrap_or(Value::Null));
    meta.insert("store".to_owned(), json!(body.get("store") != Some(&Value::Bool(false))));
    meta
}

/// The input items of a request, each with an id, as `GET /v1/responses/{id}/input_items` lists them.
pub fn input_items(body: &Value) -> Vec<Value> {
    let entries = match body.get("input") {
        Some(Value::String(text)) => vec![json!({"type": "message", "role": "user", "content": text})],
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(text) => json!({"type": "message", "role": "user", "content": text}),
                other => other.clone(),
            })
            .collect(),
        _ => Vec::new(),
    };
    entries
        .into_iter()
        .enumerate()
        .map(|(index, mut item)| {
            let is_message = item.get("type").is_none_or(|kind| kind == "message");
            if is_message && let Some(text) = item.get("content").and_then(Value::as_str).map(str::to_owned) {
                let kind = if item["role"] == "assistant" { "output_text" } else { "input_text" };
                item["content"] = json!([{"type": kind, "text": text}]);
            }
            if is_message && item.get("type").is_none() {
                item["type"] = json!("message");
            }
            if item.get("id").is_none_or(Value::is_null) {
                let prefix = if is_message { "msg" } else { "item" };
                item["id"] = json!(format!("{prefix}_in_{index}"));
            }
            item
        })
        .collect()
}

/// The chat messages that a finished response adds to the conversation: its text and its function calls.
pub fn assistant_messages(response: &Value) -> Vec<Value> {
    let mut text = String::new();
    let mut calls: Vec<Value> = Vec::new();
    for item in response["output"].as_array().into_iter().flatten() {
        match item["type"].as_str() {
            Some("message") => {
                for part in item["content"].as_array().into_iter().flatten() {
                    text.push_str(part["text"].as_str().unwrap_or(""));
                }
            }
            Some("function_call") => calls.push(json!({
                "id": item["call_id"], "type": "function",
                "function": {"name": item["name"], "arguments": item["arguments"]},
            })),
            _ => {}
        }
    }
    if text.is_empty() && calls.is_empty() {
        return Vec::new();
    }
    let content = if text.is_empty() && !calls.is_empty() { Value::Null } else { json!(text) };
    let mut message = json!({"role": "assistant", "content": content});
    if !calls.is_empty() {
        message["tool_calls"] = Value::Array(calls);
    }
    vec![message]
}

fn read_item(item: &Value, out: &mut Vec<Value>) {
    if let Value::String(text) = item {
        out.push(json!({"role": "user", "content": text}));
        return;
    }
    match item.get("type").and_then(Value::as_str).unwrap_or("message") {
        "message" => read_message(item, out),
        "function_call" => read_call(item, out),
        "function_call_output" => {
            let id = item
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            out.push(json!({"role": "tool", "tool_call_id": id, "content": output_text(item.get("output"))}));
        }
        // Reasoning items and tools the model cannot run are dropped.
        _ => {}
    }
}

fn read_message(item: &Value, out: &mut Vec<Value>) {
    let role = match item.get("role").and_then(Value::as_str) {
        Some("assistant") => "assistant",
        Some("system" | "developer") => "system",
        _ => "user",
    };
    let mut text = String::new();
    let mut parts: Vec<Value> = Vec::new();
    let mut has_image = false;
    match item.get("content") {
        Some(Value::String(plain)) => text.push_str(plain),
        Some(Value::Array(items)) => {
            for part in items {
                match part.get("type").and_then(Value::as_str) {
                    Some("input_text" | "output_text" | "text") => {
                        let piece = part.get("text").and_then(Value::as_str).unwrap_or("");
                        text.push_str(piece);
                        parts.push(json!({"type": "text", "text": piece}));
                    }
                    Some("input_image") => {
                        let url = match part.get("image_url") {
                            Some(Value::String(url)) => Some(url.as_str()),
                            Some(other) => other.get("url").and_then(Value::as_str),
                            None => None,
                        };
                        if let Some(url) = url {
                            has_image = true;
                            parts.push(json!({"type": "image_url", "image_url": {"url": url}}));
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    if role == "user" && has_image {
        out.push(json!({"role": role, "content": parts}));
    } else if !text.is_empty() || role == "user" {
        out.push(json!({"role": role, "content": text}));
    }
}

fn read_call(item: &Value, out: &mut Vec<Value>) {
    let id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let arguments = match item.get("arguments") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Null) | None => "{}".to_owned(),
        Some(other) => other.to_string(),
    };
    let call = json!({
        "id": id,
        "type": "function",
        "function": {"name": item.get("name").and_then(Value::as_str).unwrap_or(""), "arguments": arguments},
    });
    if let Some(last) = out.last_mut().filter(|m| m["role"] == "assistant") {
        match last.get_mut("tool_calls").and_then(Value::as_array_mut) {
            Some(calls) => calls.push(call),
            None => last["tool_calls"] = json!([call]),
        }
        return;
    }
    out.push(json!({"role": "assistant", "content": null, "tool_calls": [call]}));
}

fn output_text(output: Option<&Value>) -> String {
    match output {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn read_tools(tools: Option<&Value>) -> Vec<Value> {
    tools
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|tool| tool.get("type").and_then(Value::as_str) == Some("function"))
        .filter_map(|tool| {
            let name = tool.get("name").and_then(Value::as_str)?;
            let mut function = Map::new();
            function.insert("name".to_owned(), json!(name));
            if let Some(description) = tool.get("description").filter(|d| d.is_string()) {
                function.insert("description".to_owned(), description.clone());
            }
            let parameters = tool
                .get("parameters")
                .filter(|p| p.is_object())
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            function.insert("parameters".to_owned(), parameters);
            Some(json!({"type": "function", "function": function}))
        })
        .collect()
}

fn read_choice(choice: Option<&Value>) -> Option<Value> {
    match choice? {
        Value::String(text) if matches!(text.as_str(), "auto" | "none" | "required") => {
            Some(json!(text))
        }
        Value::Object(object) if object.get("type").and_then(Value::as_str) == Some("function") => {
            let name = object.get("name").and_then(Value::as_str)?;
            Some(json!({"type": "function", "function": {"name": name}}))
        }
        _ => None,
    }
}

fn read_format(text: Option<&Value>) -> Option<Value> {
    let format = text?.get("format")?;
    match format.get("type").and_then(Value::as_str)? {
        "json_schema" => {
            let mut schema = Map::new();
            schema.insert(
                "name".to_owned(),
                format.get("name").cloned().unwrap_or_else(|| json!("response")),
            );
            for key in ["schema", "strict", "description"] {
                if let Some(value) = format.get(key) {
                    schema.insert(key.to_owned(), value.clone());
                }
            }
            Some(json!({"type": "json_schema", "json_schema": schema}))
        }
        "json_object" => Some(json!({"type": "json_object"})),
        _ => None,
    }
}

fn usage_json(input: u64, output: u64) -> Value {
    json!({
        "input_tokens": input,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": output,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": input.saturating_add(output),
    })
}

fn message_item(item_id: &str, text: &str) -> Value {
    json!({
        "id": item_id,
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    })
}

fn call_item(item_id: &str, call_id: &str, name: &str, arguments: &str) -> Value {
    json!({
        "id": item_id,
        "type": "function_call",
        "status": "completed",
        "call_id": call_id,
        "name": name,
        "arguments": arguments,
    })
}

fn response_object(
    id: &str,
    model: &str,
    created: i64,
    status: &str,
    output: Vec<Value>,
    usage: Value,
) -> Value {
    json!({
        "id": id,
        "object": "response",
        "created_at": created,
        "status": status,
        "error": null,
        "incomplete_details": if status == "incomplete" { json!({"reason": "max_output_tokens"}) } else { Value::Null },
        "model": model,
        "output": output,
        "parallel_tool_calls": true,
        "tool_choice": "auto",
        "tools": [],
        "usage": usage,
    })
}

/// A whole chat completion as a Response object.
pub fn from_chat(chat: &Value, chat_id: &str, model: &str, created: i64) -> Value {
    from_chat_with(chat, chat_id, model, created, &Map::new())
}

/// Like `from_chat`, with fields to add to the object.
pub fn from_chat_with(chat: &Value, chat_id: &str, model: &str, created: i64, meta: &Map<String, Value>) -> Value {
    let suffix = id_suffix(chat_id);
    let answer = read_answer(chat, suffix);
    let mut output = Vec::new();
    if !answer.text.is_empty() || answer.calls.is_empty() {
        output.push(message_item(&format!("msg_{suffix}"), &answer.text));
    }
    for (index, call) in answer.calls.iter().enumerate() {
        output.push(call_item(
            &format!("fc_{suffix}_{index}"),
            &call.id,
            &call.name,
            &call.arguments,
        ));
    }
    let status = if answer.finish == "length" { "incomplete" } else { "completed" };
    let mut response = response_object(
        &format!("resp_{suffix}"),
        model,
        created,
        status,
        output,
        usage_json(answer.input_tokens, answer.output_tokens),
    );
    merge(&mut response, meta);
    response
}

fn merge(response: &mut Value, meta: &Map<String, Value>) {
    for (key, value) in meta {
        response[key] = value.clone();
    }
}

struct Text {
    index: usize,
    item_id: String,
    text: String,
}

struct Call {
    index: usize,
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
}

/// Translates a chat stream into the Responses event sequence.
pub struct Stream {
    id: String,
    suffix: String,
    model: String,
    created: i64,
    seq: u64,
    started: bool,
    next_index: usize,
    text: Option<Text>,
    calls: BTreeMap<u64, Call>,
    output: BTreeMap<usize, Value>,
    finish: Option<String>,
    usage: (u64, u64),
    ended: bool,
    meta: Map<String, Value>,
    response: Option<Value>,
}

impl Stream {
    /// Adds fields to every Response object of the stream.
    pub fn with_meta(mut self, meta: Map<String, Value>) -> Self {
        self.meta = meta;
        self
    }

    pub fn new(chat_id: &str, model: &str, created: i64) -> Self {
        let suffix = id_suffix(chat_id).to_owned();
        Self {
            id: format!("resp_{suffix}"),
            suffix,
            model: model.to_owned(),
            created,
            seq: 0,
            started: false,
            next_index: 0,
            text: None,
            calls: BTreeMap::new(),
            output: BTreeMap::new(),
            finish: None,
            usage: (0, 0),
            ended: false,
            meta: Map::new(),
            response: None,
        }
    }

    fn emit(&mut self, out: &mut Vec<Event>, name: &str, mut data: Value) {
        data["type"] = json!(name);
        data["sequence_number"] = json!(self.seq);
        self.seq += 1;
        out.push(Event::new(name, data));
    }

    fn start(&mut self, out: &mut Vec<Event>) {
        if self.started {
            return;
        }
        self.started = true;
        let mut response = response_object(
            &self.id,
            &self.model,
            self.created,
            "in_progress",
            Vec::new(),
            Value::Null,
        );
        merge(&mut response, &self.meta);
        self.emit(out, "response.created", json!({"response": response}));
        self.emit(out, "response.in_progress", json!({"response": response}));
    }

    fn add_text(&mut self, out: &mut Vec<Event>, delta: &str) {
        if self.text.is_none() {
            let index = self.next_index;
            self.next_index += 1;
            let item_id = format!("msg_{}_{index}", self.suffix);
            let item = json!({
                "id": item_id, "type": "message", "status": "in_progress", "role": "assistant", "content": [],
            });
            self.emit(
                out,
                "response.output_item.added",
                json!({"output_index": index, "item": item}),
            );
            self.emit(
                out,
                "response.content_part.added",
                json!({
                    "item_id": item_id, "output_index": index, "content_index": 0,
                    "part": {"type": "output_text", "text": "", "annotations": []},
                }),
            );
            self.text = Some(Text { index, item_id, text: String::new() });
        }
        let Some(text) = self.text.as_mut() else { return };
        text.text.push_str(delta);
        let (index, item_id) = (text.index, text.item_id.clone());
        self.emit(
            out,
            "response.output_text.delta",
            json!({"item_id": item_id, "output_index": index, "content_index": 0, "delta": delta}),
        );
    }

    fn close_text(&mut self, out: &mut Vec<Event>) {
        let Some(text) = self.text.take() else { return };
        let (index, item_id) = (text.index, text.item_id);
        self.emit(
            out,
            "response.output_text.done",
            json!({"item_id": item_id, "output_index": index, "content_index": 0, "text": text.text}),
        );
        let part = json!({"type": "output_text", "text": text.text, "annotations": []});
        self.emit(
            out,
            "response.content_part.done",
            json!({"item_id": item_id, "output_index": index, "content_index": 0, "part": part}),
        );
        let item = message_item(&item_id, &text.text);
        self.emit(
            out,
            "response.output_item.done",
            json!({"output_index": index, "item": item}),
        );
        self.output.insert(index, item);
    }

    fn add_call(&mut self, out: &mut Vec<Event>, call: &Value) {
        let slot = call.get("index").and_then(Value::as_u64).unwrap_or(0);
        let name = call
            .pointer("/function/name")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !self.calls.contains_key(&slot) {
            self.close_text(out);
            let index = self.next_index;
            self.next_index += 1;
            let item_id = format!("fc_{}_{index}", self.suffix);
            let call_id = call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map_or_else(|| format!("call_{}_{index}", self.suffix), str::to_owned);
            let item = json!({
                "id": item_id, "type": "function_call", "status": "in_progress",
                "call_id": call_id, "name": name, "arguments": "",
            });
            self.emit(
                out,
                "response.output_item.added",
                json!({"output_index": index, "item": item}),
            );
            self.calls.insert(
                slot,
                Call { index, item_id, call_id, name: name.to_owned(), arguments: String::new() },
            );
        }
        let Some(state) = self.calls.get_mut(&slot) else { return };
        if state.name.is_empty() {
            state.name = name.to_owned();
        }
        let fragment = call
            .pointer("/function/arguments")
            .and_then(Value::as_str)
            .unwrap_or("");
        if fragment.is_empty() {
            return;
        }
        state.arguments.push_str(fragment);
        let (index, item_id) = (state.index, state.item_id.clone());
        self.emit(
            out,
            "response.function_call_arguments.delta",
            json!({"item_id": item_id, "output_index": index, "delta": fragment}),
        );
    }

    fn close_calls(&mut self, out: &mut Vec<Event>) {
        for call in std::mem::take(&mut self.calls).into_values() {
            self.emit(
                out,
                "response.function_call_arguments.done",
                json!({"item_id": call.item_id, "output_index": call.index, "arguments": call.arguments}),
            );
            let item = call_item(&call.item_id, &call.call_id, &call.name, &call.arguments);
            self.emit(
                out,
                "response.output_item.done",
                json!({"output_index": call.index, "item": item}),
            );
            self.output.insert(call.index, item);
        }
    }
}

impl Translator for Stream {
    fn feed(&mut self, chunk: &Value) -> Vec<Event> {
        let mut out = Vec::new();
        if self.ended {
            return out;
        }
        self.start(&mut out);
        if chunk.get("usage").is_some_and(Value::is_object) {
            self.usage = usage_of(chunk);
        }
        let Some(choice) = chunk.pointer("/choices/0") else {
            return out;
        };
        if let Some(delta) = choice.get("delta") {
            if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                self.add_text(&mut out, text);
            }
            for call in delta
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                self.add_call(&mut out, call);
            }
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish = Some(reason.to_owned());
        }
        out
    }

    fn finish(&mut self) -> Vec<Event> {
        let mut out = Vec::new();
        if self.ended {
            return out;
        }
        self.ended = true;
        self.start(&mut out);
        self.close_text(&mut out);
        self.close_calls(&mut out);
        let incomplete = self.finish.as_deref() == Some("length");
        let mut response = response_object(
            &self.id,
            &self.model,
            self.created,
            if incomplete { "incomplete" } else { "completed" },
            self.output.values().cloned().collect(),
            usage_json(self.usage.0, self.usage.1),
        );
        merge(&mut response, &self.meta);
        let name = if incomplete { "response.incomplete" } else { "response.completed" };
        self.emit(&mut out, name, json!({"response": response}));
        self.response = Some(response);
        out
    }

    fn completed(&self) -> Option<Value> {
        self.response.clone()
    }

    fn fail(&mut self, message: &str) -> Vec<Event> {
        let mut out = Vec::new();
        if self.ended {
            return out;
        }
        self.ended = true;
        self.start(&mut out);
        let mut response = response_object(
            &self.id,
            &self.model,
            self.created,
            "failed",
            self.output.values().cloned().collect(),
            Value::Null,
        );
        merge(&mut response, &self.meta);
        response["error"] = json!({"code": "server_error", "message": message});
        self.emit(&mut out, "response.failed", json!({"response": response}));
        out
    }
}
