//! Anthropic Messages API on top of chat completions: the request in, and the reply or stream out.
//!
//! Not supported: thinking blocks (dropped both ways), server tools such as web search, citations and documents.

use serde_json::{Map, Value, json};

use crate::dialect::{Event, Opts, Translator, id_suffix, read_answer, usage_of};
use crate::search::Search;

/// The chat request for a Messages request body.
pub fn to_chat(body: &Value) -> Result<Value, String> {
    let object = body
        .as_object()
        .ok_or_else(|| "The body must be a JSON object.".to_owned())?;
    let entries = object
        .get("messages")
        .and_then(Value::as_array)
        .filter(|entries| !entries.is_empty())
        .ok_or_else(|| "messages must be a non-empty array.".to_owned())?;

    let mut messages: Vec<Value> = Vec::new();
    let system = match object.get("system") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    };
    if !system.trim().is_empty() {
        messages.push(json!({"role": "system", "content": system}));
    }
    for entry in entries {
        match entry.get("role").and_then(Value::as_str) {
            Some("assistant") => read_assistant(entry.get("content"), &mut messages),
            Some("user") => read_user(entry.get("content"), &mut messages),
            _ => return Err("messages[].role must be user or assistant.".to_owned()),
        }
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
        let choice = object.get("tool_choice");
        if let Some(choice) = read_choice(choice) {
            chat.insert("tool_choice".to_owned(), choice);
        }
        if choice.and_then(|c| c.get("disable_parallel_tool_use")) == Some(&Value::Bool(true)) {
            chat.insert("parallel_tool_calls".to_owned(), Value::Bool(false));
        }
    }
    for (from, to) in [
        ("max_tokens", "max_tokens"),
        ("temperature", "temperature"),
        ("top_p", "top_p"),
        ("top_k", "top_k"),
    ] {
        if let Some(value) = object.get(from).filter(|v| v.is_number()) {
            chat.insert(to.to_owned(), value.clone());
        }
    }
    if let Some(stop) = object
        .get("stop_sequences")
        .and_then(Value::as_array)
        .filter(|stop| !stop.is_empty())
    {
        chat.insert("stop".to_owned(), Value::Array(stop.clone()));
    }
    let mut chat = Value::Object(chat);
    let thinking = match body.pointer("/thinking/type").and_then(Value::as_str) {
        Some("enabled" | "adaptive") => Some(true),
        Some("disabled") => Some(false),
        _ => None,
    };
    crate::dialect::set_thinking(&mut chat, thinking);
    Ok(chat)
}

fn read_user(content: Option<&Value>, out: &mut Vec<Value>) {
    let blocks = match content {
        Some(Value::String(text)) => {
            out.push(json!({"role": "user", "content": text}));
            return;
        }
        Some(Value::Array(blocks)) => blocks,
        _ => {
            out.push(json!({"role": "user", "content": ""}));
            return;
        }
    };
    // Tool results go first, as chat wants them straight after the call.
    let mut tools: Vec<Value> = Vec::new();
    let mut parts: Vec<Value> = Vec::new();
    let mut has_image = false;
    let mut text = String::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let piece = block.get("text").and_then(Value::as_str).unwrap_or("");
                text.push_str(piece);
                parts.push(json!({"type": "text", "text": piece}));
            }
            Some("image") => {
                if let Some(url) = image_url(block.get("source")) {
                    has_image = true;
                    parts.push(json!({"type": "image_url", "image_url": {"url": url}}));
                }
            }
            Some("tool_result") => {
                let id = block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let content = match block.get("content") {
                    Some(Value::String(text)) => text.clone(),
                    Some(Value::Array(items)) => items
                        .iter()
                        .filter_map(|item| item.get("text").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    _ => String::new(),
                };
                tools.push(json!({"role": "tool", "tool_call_id": id, "content": content}));
            }
            _ => {}
        }
    }
    out.extend(tools);
    if has_image {
        out.push(json!({"role": "user", "content": parts}));
    } else if !text.is_empty() || parts.is_empty() && out.last().is_none_or(|m| m["role"] != "tool") {
        out.push(json!({"role": "user", "content": text}));
    }
}

fn image_url(source: Option<&Value>) -> Option<String> {
    let source = source?;
    match source.get("type").and_then(Value::as_str)? {
        "base64" => {
            let media = source.get("media_type").and_then(Value::as_str)?;
            let data = source.get("data").and_then(Value::as_str)?;
            Some(format!("data:{media};base64,{data}"))
        }
        "url" => source.get("url").and_then(Value::as_str).map(str::to_owned),
        _ => None,
    }
}

fn read_assistant(content: Option<&Value>, out: &mut Vec<Value>) {
    let blocks = match content {
        Some(Value::String(text)) => {
            out.push(json!({"role": "assistant", "content": text}));
            return;
        }
        Some(Value::Array(blocks)) => blocks,
        _ => return,
    };
    let mut text = String::new();
    let mut calls: Vec<Value> = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => text.push_str(block.get("text").and_then(Value::as_str).unwrap_or("")),
            Some("tool_use") => calls.push(json!({
                "id": block.get("id").and_then(Value::as_str).unwrap_or(""),
                "type": "function",
                "function": {
                    "name": block.get("name").and_then(Value::as_str).unwrap_or(""),
                    "arguments": block.get("input").cloned().unwrap_or_else(|| json!({})).to_string(),
                },
            })),
            // Thinking, redacted thinking and server tool blocks are dropped.
            _ => {}
        }
    }
    if calls.is_empty() {
        if !text.is_empty() {
            out.push(json!({"role": "assistant", "content": text}));
        }
        return;
    }
    let content = if text.is_empty() { Value::Null } else { json!(text) };
    out.push(json!({"role": "assistant", "content": content, "tool_calls": calls}));
}

fn read_tools(tools: Option<&Value>) -> Vec<Value> {
    tools
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|tool| tool.get("input_schema").is_some_and(Value::is_object))
        .filter_map(|tool| {
            let name = tool.get("name").and_then(Value::as_str)?;
            let mut function = Map::new();
            function.insert("name".to_owned(), json!(name));
            if let Some(description) = tool.get("description").filter(|d| d.is_string()) {
                function.insert("description".to_owned(), description.clone());
            }
            function.insert("parameters".to_owned(), tool["input_schema"].clone());
            Some(json!({"type": "function", "function": function}))
        })
        .collect()
}

fn read_choice(choice: Option<&Value>) -> Option<Value> {
    let choice = choice?;
    match choice.get("type").and_then(Value::as_str)? {
        "auto" => Some(json!("auto")),
        "any" => Some(json!("required")),
        "none" => Some(json!("none")),
        "tool" => {
            let name = choice.get("name").and_then(Value::as_str)?;
            Some(json!({"type": "function", "function": {"name": name}}))
        }
        _ => None,
    }
}

/// A rough token count of a chat request: its messages and tools at four characters a token.
pub fn count_tokens(chat: &Value) -> u64 {
    let chars: usize = ["messages", "tools"]
        .iter()
        .filter_map(|key| chat.get(key))
        .map(|value| value.to_string().chars().count())
        .sum();
    (chars as u64).div_ceil(4).max(1)
}

fn stop_reason(finish: &str, has_calls: bool) -> &'static str {
    match finish {
        "tool_calls" | "function_call" => "tool_use",
        "length" => "max_tokens",
        _ if has_calls => "tool_use",
        _ => "end_turn",
    }
}

fn message_id(chat_id: &str) -> String {
    format!("msg_{}", id_suffix(chat_id))
}

/// A whole chat completion as a Message object.
pub fn from_chat(chat: &Value, chat_id: &str, model: &str) -> Value {
    from_chat_with(chat, chat_id, model, &Opts::default())
}

/// Like `from_chat`, with the searches that were run before the answer.
pub fn from_chat_with(chat: &Value, chat_id: &str, model: &str, opts: &Opts) -> Value {
    let suffix = id_suffix(chat_id);
    let answer = read_answer(chat, suffix);
    let mut content: Vec<Value> = Vec::new();
    for search in &opts.searches {
        let (call, result) = search_blocks(suffix, search);
        content.extend([call, result]);
    }
    if opts.thinking && !answer.reasoning.is_empty() {
        content.push(json!({"type": "thinking", "thinking": answer.reasoning, "signature": SIGNATURE}));
    }
    if !answer.text.is_empty() || answer.calls.is_empty() {
        content.push(json!({"type": "text", "text": answer.text}));
    }
    for call in &answer.calls {
        let input = serde_json::from_str::<Value>(&call.arguments)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        content.push(json!({"type": "tool_use", "id": call.id, "name": call.name, "input": input}));
    }
    json!({
        "id": message_id(chat_id),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason(&answer.finish, !answer.calls.is_empty()),
        "stop_sequence": null,
        "usage": usage_json(answer.input_tokens, answer.output_tokens, opts.searches.len()),
    })
}

fn usage_json(input: u64, output: u64, searches: usize) -> Value {
    let mut usage = json!({"input_tokens": input, "output_tokens": output});
    if searches > 0 {
        usage["server_tool_use"] = json!({"web_search_requests": searches});
    }
    usage
}

/// The server tool call and its result, as blocks of a Message.
fn search_blocks(suffix: &str, search: &Search) -> (Value, Value) {
    let id = format!("srvtoolu_{suffix}_{}", search.id);
    let call = json!({"type": "server_tool_use", "id": id, "name": "web_search", "input": {"query": search.query}});
    let content = match &search.error {
        Some(code) => json!({"type": "web_search_tool_result_error", "error_code": code}),
        None => Value::Array(
            search
                .hits
                .iter()
                .map(|hit| {
                    json!({
                        "type": "web_search_result", "url": hit.url, "title": hit.title,
                        "encrypted_content": "", "page_age": null,
                    })
                })
                .collect(),
        ),
    };
    let result = json!({"type": "web_search_tool_result", "tool_use_id": id, "content": content});
    (call, result)
}

/// The signature of a thinking block. Nothing checks it, but clients expect one.
const SIGNATURE: &str = "draggy";

#[derive(PartialEq, Eq)]
enum Block {
    Thinking,
    Text,
    Tool(u64),
}

/// Translates a chat stream into the Messages event sequence.
pub struct Stream {
    id: String,
    suffix: String,
    model: String,
    started: bool,
    index: u64,
    open: Option<Block>,
    args_seen: bool,
    calls: u64,
    finish: Option<String>,
    usage: (u64, u64),
    ended: bool,
    searches: Vec<Search>,
    searched: usize,
    thinking: bool,
}

impl Stream {
    /// Adds the searches that came before the answer, and whether reasoning is sent.
    pub fn with_opts(mut self, opts: &Opts) -> Self {
        self.thinking = opts.thinking;
        self.searched = opts.searches.len();
        self.searches = opts.searches.clone();
        self
    }

    pub fn new(chat_id: &str, model: &str) -> Self {
        Self {
            id: message_id(chat_id),
            suffix: id_suffix(chat_id).to_owned(),
            model: model.to_owned(),
            started: false,
            index: 0,
            open: None,
            args_seen: false,
            calls: 0,
            finish: None,
            usage: (0, 0),
            ended: false,
            searches: Vec::new(),
            searched: 0,
            thinking: false,
        }
    }

    fn start(&mut self, out: &mut Vec<Event>) {
        if self.started {
            return;
        }
        self.started = true;
        let message = json!({
            "id": self.id, "type": "message", "role": "assistant", "model": self.model,
            "content": [], "stop_reason": null, "stop_sequence": null,
            "usage": {"input_tokens": 0, "output_tokens": 0},
        });
        out.push(Event::new("message_start", json!({"type": "message_start", "message": message})));
        for search in std::mem::take(&mut self.searches) {
            let (call, result) = search_blocks(&self.suffix, &search);
            let input = call["input"].to_string();
            let mut call_start = call;
            call_start["input"] = json!({});
            self.whole_block(out, call_start, Some(json!({"type": "input_json_delta", "partial_json": input})));
            self.whole_block(out, result, None);
        }
    }

    /// A block that arrives complete: its start, an optional delta, and its stop.
    fn whole_block(&mut self, out: &mut Vec<Event>, block: Value, delta: Option<Value>) {
        let index = self.index;
        out.push(Event::new(
            "content_block_start",
            json!({"type": "content_block_start", "index": index, "content_block": block}),
        ));
        if let Some(delta) = delta {
            out.push(Event::new(
                "content_block_delta",
                json!({"type": "content_block_delta", "index": index, "delta": delta}),
            ));
        }
        out.push(Event::new("content_block_stop", json!({"type": "content_block_stop", "index": index})));
        self.index += 1;
    }

    fn close(&mut self, out: &mut Vec<Event>) {
        let Some(block) = self.open.take() else { return };
        if block == Block::Thinking {
            let delta = json!({"type": "signature_delta", "signature": SIGNATURE});
            out.push(Event::new(
                "content_block_delta",
                json!({"type": "content_block_delta", "index": self.index, "delta": delta}),
            ));
        }
        if matches!(block, Block::Tool(_)) && !self.args_seen {
            let delta = json!({"type": "input_json_delta", "partial_json": "{}"});
            out.push(Event::new(
                "content_block_delta",
                json!({"type": "content_block_delta", "index": self.index, "delta": delta}),
            ));
        }
        out.push(Event::new(
            "content_block_stop",
            json!({"type": "content_block_stop", "index": self.index}),
        ));
        self.index += 1;
    }

    fn think(&mut self, out: &mut Vec<Event>, text: &str) {
        if self.open != Some(Block::Thinking) {
            self.close(out);
            self.open = Some(Block::Thinking);
            out.push(Event::new(
                "content_block_start",
                json!({
                    "type": "content_block_start", "index": self.index,
                    "content_block": {"type": "thinking", "thinking": "", "signature": ""},
                }),
            ));
        }
        let delta = json!({"type": "thinking_delta", "thinking": text});
        out.push(Event::new(
            "content_block_delta",
            json!({"type": "content_block_delta", "index": self.index, "delta": delta}),
        ));
    }

    fn text(&mut self, out: &mut Vec<Event>, text: &str) {
        if self.open != Some(Block::Text) {
            self.close(out);
            self.open = Some(Block::Text);
            out.push(Event::new(
                "content_block_start",
                json!({
                    "type": "content_block_start", "index": self.index,
                    "content_block": {"type": "text", "text": ""},
                }),
            ));
        }
        let delta = json!({"type": "text_delta", "text": text});
        out.push(Event::new(
            "content_block_delta",
            json!({"type": "content_block_delta", "index": self.index, "delta": delta}),
        ));
    }

    fn call(&mut self, out: &mut Vec<Event>, call: &Value) {
        let slot = call.get("index").and_then(Value::as_u64).unwrap_or(0);
        if self.open != Some(Block::Tool(slot)) {
            self.close(out);
            self.open = Some(Block::Tool(slot));
            self.args_seen = false;
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map_or_else(|| format!("toolu_{}_{}", self.suffix, self.calls), str::to_owned);
            self.calls += 1;
            let name = call.pointer("/function/name").and_then(Value::as_str).unwrap_or("");
            out.push(Event::new(
                "content_block_start",
                json!({
                    "type": "content_block_start", "index": self.index,
                    "content_block": {"type": "tool_use", "id": id, "name": name, "input": {}},
                }),
            ));
        }
        let fragment = call
            .pointer("/function/arguments")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !fragment.is_empty() {
            self.args_seen = true;
            let delta = json!({"type": "input_json_delta", "partial_json": fragment});
            out.push(Event::new(
                "content_block_delta",
                json!({"type": "content_block_delta", "index": self.index, "delta": delta}),
            ));
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
            let thought = ["reasoning_content", "reasoning"]
                .iter()
                .find_map(|key| delta.get(key).and_then(Value::as_str).filter(|t| !t.is_empty()));
            if let Some(text) = thought.filter(|_| self.thinking) {
                self.think(&mut out, text);
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                self.text(&mut out, text);
            }
            for call in delta
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                self.call(&mut out, call);
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
        self.close(&mut out);
        let reason = stop_reason(self.finish.as_deref().unwrap_or("stop"), self.calls > 0);
        out.push(Event::new(
            "message_delta",
            json!({
                "type": "message_delta",
                "delta": {"stop_reason": reason, "stop_sequence": null},
                "usage": usage_json(self.usage.0, self.usage.1, self.searched),
            }),
        ));
        out.push(Event::new("message_stop", json!({"type": "message_stop"})));
        out
    }

    fn fail(&mut self, message: &str) -> Vec<Event> {
        let mut out = Vec::new();
        if self.ended {
            return out;
        }
        self.ended = true;
        out.push(Event::new(
            "error",
            json!({"type": "error", "error": {"type": "api_error", "message": message}}),
        ));
        out
    }
}
