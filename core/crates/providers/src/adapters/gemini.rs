//! Google's Gemini API through generateContent. Only Draggy's functions go out, with their schemas cut down to what
//! Gemini reads, and thought signatures return only to the instance that wrote them.

use std::collections::{HashMap, VecDeque};

use serde_json::{Map, Value, json};

use super::common::{
    Connection, Decoder, Flow, ListedModel, Stream, arguments_object, function_tools, hosted,
    level_of, non_empty, output_limit, parse_data_url, refusal, text_of, text_or_empty, think_of,
};
use crate::errors::from_response_value;
use crate::http::{HttpRequest, Method};
use crate::js::{self, json_text, to_string, truthy};
use crate::types::{
    ChatMessage, ChatRequest, CompletedToolCall, Completion, Content, ContentPart, FinishReason,
    ProviderError, ProviderState, StreamEvent, Usage,
};
use crate::usage::from_gemini;
use std::collections::BTreeMap;

/// Gemini 3 refuses a function call in the current turn without a signature; this is Google's stand-in.
const SKIP_SIGNATURE: &str = "skip_thought_signature_validator";
const SCHEMA_KEYS: [&str; 20] = [
    "type",
    "format",
    "title",
    "description",
    "nullable",
    "enum",
    "maxItems",
    "minItems",
    "properties",
    "required",
    "items",
    "minimum",
    "maximum",
    "anyOf",
    "minLength",
    "maxLength",
    "pattern",
    "minProperties",
    "maxProperties",
    "propertyOrdering",
];
const REFUSALS: [&str; 6] = [
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
];

/// A model's generation and family, read from its id: `gemini-2.5-flash` is version 2.5 of the flash family.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelOf {
    pub version: f64,
    pub family: &'static str,
}

/// The version and family of a model id. Ids newer than the known pattern count as Gemini 99, which works like 3.
pub fn model_of(model_id: &str) -> ModelOf {
    let lowered = model_id.to_lowercase();
    let id = lowered.strip_prefix("models/").unwrap_or(&lowered);
    let family = if id.contains("flash-lite") {
        "lite"
    } else if id.contains("flash") {
        "flash"
    } else if id.contains("pro") {
        "pro"
    } else {
        ""
    };
    let version = id
        .strip_prefix("gemini-")
        .and_then(|rest| {
            let major_len = rest.chars().take_while(char::is_ascii_digit).count();
            if major_len == 0 {
                return None;
            }
            let major = &rest[..major_len];
            let after = &rest[major_len..];
            let minor_len = after.strip_prefix('.').map_or(0, |minor| {
                minor.chars().take_while(char::is_ascii_digit).count()
            });
            let minor = if minor_len > 0 {
                &after[1..=minor_len]
            } else {
                "0"
            };
            format!("{major}.{minor}").parse::<f64>().ok()
        })
        .unwrap_or(99.0);
    ModelOf { version, family }
}

fn budget_of(level: &str) -> i64 {
    if level == "high" { 24_576 } else { 8_192 }
}

/// The thinking config for a model, or none where the model has no switch.
fn thinking_config(req: &ChatRequest, model: &str) -> Option<Map<String, Value>> {
    let think = think_of(req);
    let level = level_of(req);
    let on = think == Some(true) && level != "low";
    let ModelOf { version, family } = model_of(model);
    if version < 2.5 || (think.is_none() && version < 3.0) {
        return None;
    }
    let mut config = Map::new();
    if version < 3.0 {
        // 2.5 Pro cannot stop thinking; 128 tokens is the least it takes.
        if !on {
            config.insert(
                "thinkingBudget".to_owned(),
                json!(if family == "pro" { 128 } else { 0 }),
            );
        } else {
            config.insert("thinkingBudget".to_owned(), json!(budget_of(level)));
            config.insert("includeThoughts".to_owned(), json!(true));
        }
        return Some(config);
    }
    if on {
        config.insert("thinkingLevel".to_owned(), json!(level));
        config.insert("includeThoughts".to_owned(), json!(true));
    } else {
        config.insert(
            "thinkingLevel".to_owned(),
            json!(if family == "pro" { "low" } else { "minimal" }),
        );
    }
    Some(config)
}

/// The request for one chat turn of the given model. The model name goes into the path escaped.
pub fn build_request(req: &ChatRequest, conn: &Connection, model_id: &str) -> HttpRequest {
    let model = model_id.strip_prefix("models/").unwrap_or(model_id);
    let (system, contents) = to_contents(
        &req.messages,
        conn.instance_id.as_deref(),
        model_of(model).version >= 3.0,
    );
    let mut payload = Map::new();
    payload.insert("contents".to_owned(), Value::Array(contents));
    if !system.is_empty() {
        payload.insert(
            "systemInstruction".to_owned(),
            json!({ "parts": [{ "text": system }] }),
        );
    }
    let declarations = function_declarations(&req.tools);
    if !declarations.is_empty() {
        payload.insert(
            "tools".to_owned(),
            json!([{ "functionDeclarations": declarations }]),
        );
    }
    let mut generation = Map::new();
    let limit = output_limit(req);
    if limit > 0 {
        generation.insert("maxOutputTokens".to_owned(), json!(limit));
    }
    if let Some(thinking) = thinking_config(req, model) {
        generation.insert("thinkingConfig".to_owned(), Value::Object(thinking));
    }
    if !generation.is_empty() {
        payload.insert("generationConfig".to_owned(), Value::Object(generation));
    }

    let mut headers = conn.headers.clone();
    headers.insert("Content-Type".to_owned(), "application/json".to_owned());
    if !conn.api_key.is_empty() {
        headers.insert("x-goog-api-key".to_owned(), conn.api_key.clone());
    }
    let method = if req.stream {
        "streamGenerateContent?alt=sse"
    } else {
        "generateContent"
    };
    HttpRequest {
        method: Method::Post,
        url: format!(
            "{}/models/{}:{method}",
            conn.base_url,
            js::encode_uri_component(model)
        ),
        headers,
        body: Some(json_text(&Value::Object(payload))),
        timeout_ms: None,
    }
}

/// JSON Schema cut to Gemini's subset: unknown keywords go, `const` becomes an enum, a null type becomes `nullable`.
pub fn sanitize_schema(schema: &Value) -> Value {
    match schema {
        Value::Array(items) => Value::Array(items.iter().map(sanitize_schema).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                if key == "type" && value.is_array() {
                    let items = value.as_array().map(Vec::as_slice).unwrap_or_default();
                    let kept: Vec<&Value> = items
                        .iter()
                        .filter(|item| item.as_str() != Some("null"))
                        .collect();
                    let first = kept
                        .first()
                        .and_then(|item| item.as_str())
                        .filter(|t| !t.is_empty())
                        .unwrap_or("string");
                    out.insert("type".to_owned(), json!(first));
                    if kept.len() < items.len() {
                        out.insert("nullable".to_owned(), json!(true));
                    }
                } else if key == "const" {
                    out.insert("enum".to_owned(), json!([value]));
                } else if key == "properties" {
                    let properties = value
                        .as_object()
                        .map(|props| {
                            props
                                .iter()
                                .map(|(name, sub)| (name.clone(), sanitize_schema(sub)))
                                .collect::<Map<String, Value>>()
                        })
                        .unwrap_or_default();
                    out.insert("properties".to_owned(), Value::Object(properties));
                } else if key == "enum" {
                    let values = value
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or_default()
                        .iter()
                        .map(|item| json!(to_string(item)))
                        .collect();
                    out.insert("enum".to_owned(), Value::Array(values));
                } else if SCHEMA_KEYS.contains(&key.as_str()) {
                    out.insert(key.clone(), sanitize_schema(value));
                }
            }
            if out.contains_key("enum") && !out.contains_key("type") {
                out.insert("type".to_owned(), json!("string"));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Only Draggy's function tools; Google Search, URL context and code execution are never asked for.
fn function_declarations(tools: &[crate::types::ToolSpec]) -> Vec<Value> {
    function_tools(tools)
        .into_iter()
        .map(|function| {
            let mut declaration = Map::new();
            declaration.insert(
                "name".to_owned(),
                json!(function.name.clone().unwrap_or_default()),
            );
            declaration.insert(
                "description".to_owned(),
                json!(function.description.clone().unwrap_or_default()),
            );
            if let Some(parameters) = function.parameters.as_ref().map(sanitize_schema) {
                let has_properties = parameters
                    .get("properties")
                    .and_then(Value::as_object)
                    .is_some_and(|props| !props.is_empty());
                if has_properties {
                    declaration.insert("parameters".to_owned(), parameters);
                }
            }
            Value::Object(declaration)
        })
        .collect()
}

/// A message's parts: text with words in it, and images that are data URLs.
fn content_parts(content: Option<&Content>) -> Vec<Value> {
    match content {
        None => Vec::new(),
        Some(Content::Text(text)) if text.trim().is_empty() => Vec::new(),
        Some(Content::Text(text)) => vec![json!({ "text": text })],
        Some(Content::Parts(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text } if !text.trim().is_empty() => {
                    Some(json!({ "text": text }))
                }
                ContentPart::ImageUrl { image_url } => parse_data_url(&image_url.url).map(
                    |(mime, data)| json!({ "inlineData": { "mimeType": mime, "data": data } }),
                ),
                _ => None,
            })
            .collect(),
    }
}

/// The signatures this instance wrote for a turn, or none. A bare thinking field is never sent.
fn signatures_of(message: &ChatMessage, instance_id: Option<&str>) -> (Vec<String>, String) {
    let Some(id) = instance_id else {
        return (Vec::new(), String::new());
    };
    let Some(tagged) = message
        .provider_state
        .as_ref()
        .filter(|tagged| tagged.instance_id == id)
    else {
        return (Vec::new(), String::new());
    };
    let calls = tagged
        .state
        .get("calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| item.as_str().unwrap_or_default().to_owned())
                .collect()
        })
        .unwrap_or_default();
    let text = tagged
        .state
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    (calls, text)
}

/// The system text and the turns: consecutive turns from one role become one, and each result is a user turn.
fn to_contents(
    messages: &[ChatMessage],
    instance_id: Option<&str>,
    strict: bool,
) -> (String, Vec<Value>) {
    let mut system: Vec<String> = Vec::new();
    let mut turns: Vec<(&str, Vec<Value>)> = Vec::new();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut pending: VecDeque<String> = VecDeque::new();
    let last_user = messages
        .iter()
        .rposition(|message| message.role == "user")
        .map_or(-1, |position| position as isize);
    for (position, message) in messages.iter().enumerate() {
        match message.role.as_str() {
            "system" => {
                let text = content_parts(message.content.as_ref())
                    .iter()
                    .filter_map(|part| {
                        part.get("text")
                            .and_then(Value::as_str)
                            .filter(|t| !t.is_empty())
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                if !text.is_empty() {
                    system.push(text);
                }
            }
            "tool" => {
                let name = names
                    .get(message.tool_call_id.as_deref().unwrap_or_default())
                    .cloned()
                    .or_else(|| non_empty(message.tool_name.as_deref()).map(str::to_owned))
                    .or_else(|| pending.pop_front())
                    .unwrap_or_else(|| "tool".to_owned());
                let response = json!({ "functionResponse": { "name": name, "response": { "content": text_of(message.content.as_ref()) } } });
                push_turn(&mut turns, "user", vec![response]);
            }
            "assistant" => {
                let (calls, text) = signatures_of(message, instance_id);
                let mut parts = content_parts(message.content.as_ref());
                if !text.is_empty()
                    && let Some(last) = parts.last_mut().and_then(Value::as_object_mut)
                {
                    last.insert("thoughtSignature".to_owned(), json!(text));
                }
                if !message.tool_calls.is_empty() {
                    pending.clear();
                }
                for (index, call) in message.tool_calls.iter().enumerate() {
                    let name = call.function.name.clone().unwrap_or_default();
                    if let Some(id) = non_empty(call.id.as_deref()) {
                        names.insert(id.to_owned(), name.clone());
                    }
                    pending.push_back(name.clone());
                    let mut part = Map::new();
                    part.insert(
                        "functionCall".to_owned(),
                        json!({ "name": name, "args": arguments_object(&call.function.arguments) }),
                    );
                    let stand_in = strict && index == 0 && (position as isize) > last_user;
                    let signature = calls
                        .get(index)
                        .filter(|s| !s.is_empty())
                        .cloned()
                        .or_else(|| stand_in.then(|| SKIP_SIGNATURE.to_owned()));
                    if let Some(signature) = signature.filter(|s| !s.is_empty()) {
                        part.insert("thoughtSignature".to_owned(), json!(signature));
                    }
                    parts.push(Value::Object(part));
                }
                push_turn(&mut turns, "model", parts);
            }
            _ => push_turn(&mut turns, "user", content_parts(message.content.as_ref())),
        }
    }
    let contents = turns
        .into_iter()
        .map(|(role, parts)| json!({ "role": role, "parts": parts }))
        .collect();
    (system.join("\n\n"), contents)
}

fn push_turn<'a>(turns: &mut Vec<(&'a str, Vec<Value>)>, role: &'a str, parts: Vec<Value>) {
    if parts.is_empty() {
        return;
    }
    match turns.last_mut() {
        Some((last, existing)) if *last == role => existing.extend(parts),
        _ => turns.push((role, parts)),
    }
}

/// What one response chunk has told us so far.
#[derive(Debug, Default)]
struct Turn {
    /// One signature per call, in the order the calls came.
    calls: Vec<String>,
    /// The last thought signature on a text part.
    text: String,
    finish: Option<String>,
    usage: Usage,
}

fn refusal_of(reason: &str) -> ProviderError {
    refusal(reason)
}

/// Reads one response chunk: its text, thoughts and calls become events, and its signatures go into the turn.
fn read_chunk(
    json: &Value,
    turn: &mut Turn,
    out: &mut Vec<StreamEvent>,
) -> Result<(), ProviderError> {
    if truthy(json.get("error")) {
        let code = js::number(json.pointer("/error/code"));
        // A code outside the HTTP range is the provider's own number, not a status; it must not wrap into one.
        let status = if code.is_finite() && (100.0..=599.0).contains(&code) {
            code as u16
        } else {
            500
        };
        return Err(from_response_value(status, json, &BTreeMap::new(), 0));
    }
    if let Some(reason) = json
        .pointer("/promptFeedback/blockReason")
        .filter(|reason| truthy(Some(reason)))
    {
        return Err(refusal_of(&to_string(reason)));
    }
    if let Some(usage) = json
        .get("usageMetadata")
        .filter(|usage| truthy(Some(usage)))
    {
        turn.usage = from_gemini(Some(usage));
    }
    let Some(candidate) = json
        .pointer("/candidates/0")
        .filter(|candidate| truthy(Some(candidate)))
    else {
        return Ok(());
    };
    for part in candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if truthy(part.get("executableCode")) {
            return Err(hosted("code_execution"));
        }
        if truthy(part.get("codeExecutionResult")) {
            return Err(hosted("code_execution_result"));
        }
        if let Some(call) = part.get("functionCall").filter(|call| truthy(Some(call))) {
            let index = turn.calls.len();
            turn.calls.push(text_or_empty(part.get("thoughtSignature")));
            let id = match call.get("id").filter(|id| truthy(Some(id))) {
                Some(id) => to_string(id),
                None => format!("call_{index}"),
            };
            let name = non_empty(call.get("name").and_then(Value::as_str)).map(str::to_owned);
            let arguments = match call.get("args") {
                None | Some(Value::Null) => "{}".to_owned(),
                Some(args) => json_text(args),
            };
            out.push(StreamEvent::ToolCallDelta {
                index: index as u32,
                id: Some(id),
                name,
                arguments,
            });
            continue;
        }
        if truthy(part.get("thoughtSignature")) {
            turn.text = to_string(&part["thoughtSignature"]);
        }
        if truthy(part.get("thought")) {
            let text = text_or_empty(part.get("text"));
            if !text.is_empty() {
                out.push(StreamEvent::ReasoningDelta { text });
            }
        } else if truthy(part.get("text")) {
            out.push(StreamEvent::TextDelta {
                text: to_string(&part["text"]),
            });
        }
    }
    if truthy(candidate.get("finishReason")) {
        turn.finish = Some(to_string(&candidate["finishReason"]));
    }
    Ok(())
}

fn finish_of(turn: &Turn) -> Result<FinishReason, ProviderError> {
    let finish = turn.finish.as_deref().unwrap_or_default();
    if REFUSALS.contains(&finish) {
        return Err(refusal_of(finish));
    }
    if finish == "MAX_TOKENS" {
        return Ok(FinishReason::Length);
    }
    Ok(if turn.calls.is_empty() {
        FinishReason::Stop
    } else {
        FinishReason::ToolCalls
    })
}

fn state_of(turn: &Turn, instance_id: Option<&str>) -> Option<ProviderState> {
    let instance_id = instance_id?;
    if turn.text.is_empty() && turn.calls.iter().all(String::is_empty) {
        return None;
    }
    Some(ProviderState {
        instance_id: instance_id.to_owned(),
        state: json!({ "calls": turn.calls, "text": turn.text }),
    })
}

/// The line decoder for Gemini's `data:` events. Signatures come back tagged for `instance_id`.
#[derive(Debug)]
pub struct GeminiDecoder {
    instance_id: Option<String>,
    turn: Turn,
}

/// The Gemini stream as neutral events.
pub fn stream(instance_id: Option<&str>) -> Stream<GeminiDecoder> {
    Stream::new(GeminiDecoder {
        instance_id: instance_id.map(str::to_owned),
        turn: Turn::default(),
    })
}

impl Decoder for GeminiDecoder {
    fn line(&mut self, raw: &str, out: &mut Vec<StreamEvent>) -> Result<Flow, ProviderError> {
        let Some(data) = raw.trim().strip_prefix("data:") else {
            return Ok(Flow::Continue);
        };
        let Ok(json) = serde_json::from_str::<Value>(data.trim()) else {
            return Ok(Flow::Continue);
        };
        read_chunk(&json, &mut self.turn, out)?;
        Ok(Flow::Continue)
    }

    fn end(&mut self, _rest: &str, out: &mut Vec<StreamEvent>) -> Result<(), ProviderError> {
        let reason = finish_of(&self.turn)?;
        if let Some(state) = state_of(&self.turn, self.instance_id.as_deref()) {
            out.push(StreamEvent::ProviderState { state });
        }
        out.push(StreamEvent::Finish {
            reason,
            usage: self.turn.usage,
        });
        Ok(())
    }
}

/// A non-streaming answer as neutral form, with its signatures. A refusal or hosted code in it is an error.
pub fn translate_json(
    json: &Value,
    instance_id: Option<&str>,
) -> Result<Completion, ProviderError> {
    let mut turn = Turn::default();
    let mut events = Vec::new();
    read_chunk(json, &mut turn, &mut events)?;
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool_calls = Vec::new();
    for event in events {
        match event {
            StreamEvent::TextDelta { text } => content.push_str(&text),
            StreamEvent::ReasoningDelta { text } => reasoning.push_str(&text),
            StreamEvent::ToolCallDelta {
                id,
                name,
                arguments,
                ..
            } => {
                tool_calls.push(CompletedToolCall {
                    id,
                    name: name.unwrap_or_default(),
                    arguments,
                });
            }
            _ => {}
        }
    }
    let finish = finish_of(&turn)?;
    Ok(Completion {
        content,
        reasoning,
        tool_calls,
        finish,
        usage: turn.usage,
        provider_state: state_of(&turn, instance_id),
    })
}

/// The request that lists an instance's models.
pub fn models_request(conn: &Connection) -> HttpRequest {
    let mut headers = conn.headers.clone();
    if !conn.api_key.is_empty() {
        headers.insert("x-goog-api-key".to_owned(), conn.api_key.clone());
    }
    HttpRequest {
        method: Method::Get,
        url: format!("{}/models?pageSize=1000", conn.base_url),
        headers,
        body: None,
        timeout_ms: None,
    }
}

/// Chat models only: a model that cannot generate content (embeddings, Imagen, Veo) is left out.
pub fn parse_models(json: &Value) -> Vec<ListedModel> {
    json.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|model| {
            match model
                .get("supportedGenerationMethods")
                .and_then(Value::as_array)
            {
                Some(methods) => methods
                    .iter()
                    .any(|method| method.as_str() == Some("generateContent")),
                None => true,
            }
        })
        .filter_map(|model| {
            let raw = text_or_empty(model.get("name"));
            let id = raw.strip_prefix("models/").unwrap_or(&raw).to_owned();
            (!id.is_empty()).then(|| ListedModel {
                id,
                context_length: js::count_or_none(model.get("inputTokenLimit")),
                ..ListedModel::default()
            })
        })
        .collect()
}
