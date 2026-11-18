//! Ollama's HTTP API on top of chat completions.
//! Thinking output is supported.
//! Not supported: `suffix`, raw prompts, templates, `context` and keep-alive (ignored), `num_ctx` (ignored).

use std::time::Instant;

use serde_json::{Map, Value, json};

use crate::dialect::{Event, Opts, Translator, read_answer, usage_of};
use crate::server::ModelEntry;

/// The version a client sees.
pub const VERSION: &str = "0.6.0";

/// `GET /api/version`.
pub fn version() -> Value {
    json!({"version": VERSION})
}

/// `GET /api/ps`: nothing is kept loaded on purpose.
pub fn running() -> Value {
    json!({"models": []})
}

/// The model name without Ollama's default `:latest` tag.
pub fn plain_name(name: &str) -> &str {
    name.strip_suffix(":latest").unwrap_or(name)
}

/// An RFC 3339 time from Unix seconds.
pub fn iso_time(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 { shifted + 3 } else { shifted - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn digest(name: &str) -> String {
    (0u8..4)
        .map(|round| {
            let mut hash: u64 = 0xcbf2_9ce4_8422_2325 ^ u64::from(round);
            for byte in name.bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
            }
            format!("{hash:016x}")
        })
        .collect()
}

fn details() -> Value {
    json!({
        "parent_model": "", "format": "gguf", "family": "", "families": [],
        "parameter_size": "", "quantization_level": "",
    })
}

/// `GET /api/tags`.
pub fn tags(entries: &[ModelEntry], created: i64) -> Value {
    let models: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "name": entry.id, "model": entry.id, "modified_at": iso_time(created),
                "size": 0, "digest": digest(&entry.id), "details": details(),
            })
        })
        .collect();
    json!({"models": models})
}

/// `POST /api/show` for one model.
pub fn show(entry: &ModelEntry) -> Value {
    let mut info = Map::new();
    info.insert("general.architecture".to_owned(), json!("llama"));
    if let Some(length) = entry.context_length {
        info.insert("llama.context_length".to_owned(), json!(length));
    }
    let mut capabilities = vec!["completion"];
    for word in ["tools", "vision"] {
        if entry.capabilities.iter().any(|have| have == word) {
            capabilities.push(word);
        }
    }
    json!({
        "license": "", "modelfile": "", "parameters": "", "template": "",
        "details": details(), "model_info": info, "capabilities": capabilities,
    })
}

/// `POST /api/embed`.
pub fn embed_reply(model: &str, vectors: &[Vec<f32>], tokens: u64) -> Value {
    json!({
        "model": model, "embeddings": vectors,
        "total_duration": 0, "load_duration": 0, "prompt_eval_count": tokens,
    })
}

/// The reply of a request that only loads the model, or `None` when the request has work to do.
pub fn load_reply(generate: bool, body: &Value, model: &str, created: i64) -> Option<Value> {
    let empty = if generate {
        body.get("prompt").and_then(Value::as_str).is_none_or(str::is_empty) && body.get("images").is_none()
    } else {
        body.get("messages").and_then(Value::as_array).is_some_and(Vec::is_empty)
    };
    if !empty {
        return None;
    }
    let mut reply = json!({"model": model, "created_at": iso_time(created), "done": true, "done_reason": "load"});
    if generate {
        reply["response"] = json!("");
    } else {
        reply["message"] = json!({"role": "assistant", "content": ""});
    }
    Some(reply)
}

fn image_url(data: &str) -> String {
    let mime = if data.starts_with("/9j/") {
        "image/jpeg"
    } else if data.starts_with("R0lGOD") {
        "image/gif"
    } else if data.starts_with("UklGR") {
        "image/webp"
    } else {
        "image/png"
    };
    format!("data:{mime};base64,{data}")
}

fn with_images(text: &str, images: Option<&Value>) -> Value {
    let images: Vec<&str> = images
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if images.is_empty() {
        return json!(text);
    }
    let mut parts = vec![json!({"type": "text", "text": text})];
    parts.extend(
        images
            .iter()
            .map(|data| json!({"type": "image_url", "image_url": {"url": image_url(data)}})),
    );
    Value::Array(parts)
}

fn read_message(index: usize, entry: &Value, messages: &mut Vec<Value>) -> Result<(), String> {
    let role = entry.get("role").and_then(Value::as_str).unwrap_or("");
    let text = entry.get("content").and_then(Value::as_str).unwrap_or("");
    match role {
        "system" | "user" => {
            messages.push(json!({"role": role, "content": with_images(text, entry.get("images"))}));
        }
        "assistant" => {
            let calls: Vec<Value> = entry
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
                .map(|(call, item)| {
                    let arguments = match item.pointer("/function/arguments") {
                        Some(Value::String(text)) => text.clone(),
                        Some(Value::Null) | None => "{}".to_owned(),
                        Some(other) => other.to_string(),
                    };
                    json!({
                        "id": format!("call_{index}_{call}"), "type": "function",
                        "function": {
                            "name": item.pointer("/function/name").and_then(Value::as_str).unwrap_or(""),
                            "arguments": arguments,
                        },
                    })
                })
                .collect();
            let mut message = json!({"role": "assistant", "content": text});
            if !calls.is_empty() {
                message["tool_calls"] = Value::Array(calls);
            }
            messages.push(message);
        }
        "tool" => {
            let name = entry.get("tool_name").and_then(Value::as_str);
            let id = messages
                .iter()
                .rev()
                .filter_map(|message| message.get("tool_calls").and_then(Value::as_array))
                .flatten()
                .find(|call| name.is_none_or(|name| call.pointer("/function/name").and_then(Value::as_str) == Some(name)))
                .and_then(|call| call.get("id").and_then(Value::as_str))
                .unwrap_or("call_0_0")
                .to_owned();
            messages.push(json!({"role": "tool", "tool_call_id": id, "content": text}));
        }
        _ => return Err("messages[].role must be system, user, assistant or tool.".to_owned()),
    }
    Ok(())
}

fn finish_request(object: &Map<String, Value>, messages: Vec<Value>) -> Value {
    let stream = object.get("stream") != Some(&Value::Bool(false));
    let mut chat = Map::new();
    chat.insert("model".to_owned(), json!(plain_name(object.get("model").and_then(Value::as_str).unwrap_or(""))));
    chat.insert("messages".to_owned(), Value::Array(messages));
    chat.insert("stream".to_owned(), Value::Bool(stream));
    if stream {
        chat.insert("stream_options".to_owned(), json!({"include_usage": true}));
    }
    if let Some(tools) = object.get("tools").filter(|tools| tools.as_array().is_some_and(|tools| !tools.is_empty())) {
        chat.insert("tools".to_owned(), tools.clone());
    }
    match object.get("format") {
        Some(Value::String(word)) if word == "json" => {
            chat.insert("response_format".to_owned(), json!({"type": "json_object"}));
        }
        Some(schema @ Value::Object(_)) => {
            chat.insert(
                "response_format".to_owned(),
                json!({"type": "json_schema", "json_schema": {"name": "response", "schema": schema, "strict": true}}),
            );
        }
        _ => {}
    }
    if let Some(options) = object.get("options").and_then(Value::as_object) {
        for key in ["temperature", "top_p", "top_k", "seed", "stop", "presence_penalty", "frequency_penalty"] {
            if let Some(value) = options.get(key).filter(|value| !value.is_null()) {
                chat.insert(key.to_owned(), value.clone());
            }
        }
        if let Some(count) = options.get("num_predict").and_then(Value::as_i64).filter(|count| *count > 0) {
            chat.insert("max_tokens".to_owned(), json!(count));
        }
    }
    let mut chat = Value::Object(chat);
    let think = match object.get("think") {
        Some(Value::Bool(on)) => Some(*on),
        Some(Value::String(level)) => Some(level != "none"),
        _ => None,
    };
    crate::dialect::set_thinking(&mut chat, think);
    chat
}

/// The chat request for an `/api/chat` body.
pub fn chat_to_chat(body: &Value) -> Result<Value, String> {
    let object = body.as_object().ok_or_else(|| "The body must be a JSON object.".to_owned())?;
    let entries = object
        .get("messages")
        .and_then(Value::as_array)
        .filter(|entries| !entries.is_empty())
        .ok_or_else(|| "messages must be a non-empty array.".to_owned())?;
    let mut messages = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        read_message(index, entry, &mut messages)?;
    }
    Ok(finish_request(object, messages))
}

/// The chat request for an `/api/generate` body.
pub fn generate_to_chat(body: &Value) -> Result<Value, String> {
    let object = body.as_object().ok_or_else(|| "The body must be a JSON object.".to_owned())?;
    let mut messages = Vec::new();
    if let Some(system) = object.get("system").and_then(Value::as_str).filter(|text| !text.trim().is_empty()) {
        messages.push(json!({"role": "system", "content": system}));
    }
    let prompt = object.get("prompt").and_then(Value::as_str).unwrap_or("");
    messages.push(json!({"role": "user", "content": with_images(prompt, object.get("images"))}));
    Ok(finish_request(object, messages))
}

fn arguments_object(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(value @ Value::Object(_)) => value,
        _ => json!({}),
    }
}

fn done_reason(finish: &str) -> &'static str {
    if finish == "length" { "length" } else { "stop" }
}

/// The last line of a reply, or the one object of a whole reply.
fn closing(head: (bool, &str, i64), text: Option<&str>, calls: &[Value], finish: &str, usage: (u64, u64), total_ns: u64) -> Value {
    let (generate, model, created) = head;
    let mut reply = json!({"model": model, "created_at": iso_time(created)});
    if generate {
        reply["response"] = json!(text.unwrap_or(""));
    } else {
        let mut message = json!({"role": "assistant", "content": text.unwrap_or("")});
        if !calls.is_empty() {
            message["tool_calls"] = Value::Array(calls.to_vec());
        }
        reply["message"] = message;
    }
    reply["done"] = json!(true);
    reply["done_reason"] = json!(done_reason(finish));
    reply["total_duration"] = json!(total_ns);
    reply["load_duration"] = json!(0);
    reply["prompt_eval_count"] = json!(usage.0);
    reply["eval_count"] = json!(usage.1);
    reply
}

fn call_values(chat: &Value) -> Vec<Value> {
    read_answer(chat, "ollama")
        .calls
        .iter()
        .map(|call| json!({"function": {"name": call.name, "arguments": arguments_object(&call.arguments)}}))
        .collect()
}

/// A whole chat completion as an Ollama reply. `total_duration` is left at zero.
pub fn from_chat(generate: bool, chat: &Value, model: &str, created: i64) -> Value {
    from_chat_with(generate, chat, model, created, &Opts::default())
}

/// Like `from_chat`, with the model's reasoning when the request asks for it.
pub fn from_chat_with(generate: bool, chat: &Value, model: &str, created: i64, opts: &Opts) -> Value {
    let answer = read_answer(chat, "ollama");
    let mut reply = closing((generate, model, created), Some(&answer.text), &call_values(chat), &answer.finish, (answer.input_tokens, answer.output_tokens), 0);
    if opts.thinking && !answer.reasoning.is_empty() {
        if generate {
            reply["thinking"] = json!(answer.reasoning);
        } else {
            reply["message"]["thinking"] = json!(answer.reasoning);
        }
    }
    reply
}

/// The NDJSON stream of one reply.
pub struct Stream {
    generate: bool,
    model: String,
    created: i64,
    started: Instant,
    calls: Vec<(String, String)>,
    finish: String,
    usage: (u64, u64),
    ended: bool,
    thinking: bool,
}

impl Stream {
    /// Sends the model's reasoning as `thinking` when the request asks for it.
    pub fn with_opts(mut self, opts: &Opts) -> Self {
        self.thinking = opts.thinking;
        self
    }

    pub fn new(generate: bool, model: &str, created: i64) -> Self {
        Self {
            generate,
            model: model.to_owned(),
            created,
            started: Instant::now(),
            calls: Vec::new(),
            finish: String::new(),
            usage: (0, 0),
            ended: false,
            thinking: false,
        }
    }

    fn thought(&self, text: &str) -> Event {
        let mut event = self.line("", &[]);
        if self.generate {
            event.data["thinking"] = json!(text);
        } else {
            event.data["message"]["thinking"] = json!(text);
        }
        event
    }

    fn line(&self, text: &str, calls: &[Value]) -> Event {
        let mut reply = json!({"model": self.model, "created_at": iso_time(self.created)});
        if self.generate {
            reply["response"] = json!(text);
        } else {
            let mut message = json!({"role": "assistant", "content": text});
            if !calls.is_empty() {
                message["tool_calls"] = Value::Array(calls.to_vec());
            }
            reply["message"] = message;
        }
        reply["done"] = json!(false);
        Event::new("", reply)
    }
}

impl Translator for Stream {
    fn usage(&self) -> Option<(u64, u64)> {
        Some(self.usage).filter(|usage| *usage != (0, 0))
    }

    fn feed(&mut self, chunk: &Value) -> Vec<Event> {
        let mut out = Vec::new();
        if let Some(delta) = chunk.pointer("/choices/0/delta") {
            let thought = ["reasoning_content", "reasoning"]
                .iter()
                .find_map(|key| delta.get(key).and_then(Value::as_str).filter(|t| !t.is_empty()));
            if let Some(text) = thought.filter(|_| self.thinking) {
                out.push(self.thought(text));
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                out.push(self.line(text, &[]));
            }
            for call in delta.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                while self.calls.len() <= index.min(63) {
                    self.calls.push((String::new(), String::new()));
                }
                let slot = &mut self.calls[index.min(63)];
                if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                    slot.0.push_str(name);
                }
                if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str) {
                    slot.1.push_str(arguments);
                }
            }
        }
        if let Some(reason) = chunk.pointer("/choices/0/finish_reason").and_then(Value::as_str) {
            self.finish = reason.to_owned();
        }
        let usage = usage_of(chunk);
        if usage != (0, 0) {
            self.usage = usage;
        }
        out
    }

    fn finish(&mut self) -> Vec<Event> {
        if self.ended {
            return Vec::new();
        }
        self.ended = true;
        let calls: Vec<Value> = self
            .calls
            .iter()
            .filter(|(name, _)| !name.is_empty())
            .map(|(name, arguments)| json!({"function": {"name": name, "arguments": arguments_object(arguments)}}))
            .collect();
        let mut out = Vec::new();
        if !calls.is_empty() && !self.generate {
            out.push(self.line("", &calls));
        }
        let total = u64::try_from(self.started.elapsed().as_nanos()).unwrap_or(u64::MAX);
        let finish = if self.finish.is_empty() { "stop" } else { &self.finish };
        out.push(Event::new("", closing((self.generate, &self.model, self.created), None, &[], finish, self.usage, total)));
        out
    }

    fn fail(&mut self, message: &str) -> Vec<Event> {
        self.ended = true;
        vec![Event::new("", json!({"error": message}))]
    }
}
