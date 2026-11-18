//! Built-in web search for the Responses and Messages routes.
//!
//! The model sees one function tool. Its calls run here, one round at a time, until it answers.

use axum::body::Bytes;
use futures_util::{StreamExt, stream};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::dialect::Dialect;
use crate::server::{Backend, BackendError, ByteStream};

/// The function name the model calls.
pub const TOOL: &str = "web_search";
/// Searches one request may run when it does not say.
pub const DEFAULT_USES: u32 = 5;
/// No request runs more than this, whatever it asks for.
const CEILING: u32 = 10;

/// One result of a search.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// One search the model asked for, and what came of it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Search {
    pub id: String,
    pub query: String,
    pub hits: Vec<Hit>,
    /// Why it did not run, when it did not.
    pub error: Option<String>,
}

/// How many searches the request allows, when it asks for the built-in web search.
pub fn requested(dialect: Dialect, body: &Value) -> Option<u32> {
    let tools = body.get("tools").and_then(Value::as_array)?;
    let tool = tools.iter().find(|tool| {
        tool.get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind.starts_with("web_search"))
    })?;
    match dialect {
        Dialect::Messages => {
            let uses = tool.get("max_uses").and_then(Value::as_u64).map_or(DEFAULT_USES, |n| {
                u32::try_from(n).unwrap_or(CEILING)
            });
            Some(uses.min(CEILING))
        }
        Dialect::Responses => Some(DEFAULT_USES),
        _ => None,
    }
}

fn tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": TOOL,
            "description": "Search the web for current information. Returns result titles, links and snippets.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What to search for."}},
                "required": ["query"],
            },
        },
    })
}

/// What the rounds produced: the final chat reply, and the searches that led to it.
pub struct Rounded {
    pub chat: Value,
    pub searches: Vec<Search>,
}

/// Why the rounds stopped without an answer.
pub enum Failure {
    Backend(BackendError),
    /// The model answered with an error status, or with something that is not a chat reply.
    Upstream(u16, Vec<u8>),
}

/// How the rounds run.
pub struct Plan {
    pub max: u32,
    /// False when the setting for web tools in agents is off. Searches then answer with an error.
    pub enabled: bool,
}

/// Asks the model, runs the searches it makes, and asks again until it answers or calls something else.
pub async fn rounds<B: Backend>(
    backend: &B,
    mut body: Value,
    plan: &Plan,
    cancel: &CancellationToken,
) -> Result<Rounded, Failure> {
    body["stream"] = Value::Bool(false);
    if let Some(object) = body.as_object_mut() {
        object.remove("stream_options");
    }
    let mut searches: Vec<Search> = Vec::new();
    let mut usage = (0u64, 0u64);
    for round in 0..=plan.max + 1 {
        let open = u32::try_from(searches.len()).unwrap_or(u32::MAX) < plan.max;
        set_tool(&mut body, open);
        let reply = backend.forward(body.clone(), cancel.clone()).await.map_err(Failure::Backend)?;
        let status = reply.status;
        let mut bytes = Vec::new();
        let mut upstream = reply.body;
        while let Some(chunk) = upstream.next().await {
            bytes.extend_from_slice(&chunk.map_err(Failure::Backend)?);
        }
        let parsed = serde_json::from_slice::<Value>(&bytes).ok().filter(|chat| chat.get("choices").is_some());
        let Some(mut chat) = parsed.filter(|_| (200..300).contains(&status)) else {
            return Err(Failure::Upstream(status, bytes));
        };
        let (prompt, completion) = crate::dialect::usage_of(&chat);
        usage = (usage.0 + prompt, usage.1 + completion);
        let calls = chat
            .pointer("/choices/0/message/tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (ours, theirs): (Vec<Value>, Vec<Value>) = calls
            .into_iter()
            .partition(|call| call.pointer("/function/name").and_then(Value::as_str) == Some(TOOL));
        if ours.is_empty() || !theirs.is_empty() || !open {
            if !ours.is_empty() {
                chat["choices"][0]["message"]["tool_calls"] = Value::Array(theirs);
            }
            chat["usage"] = json!({
                "prompt_tokens": usage.0,
                "completion_tokens": usage.1,
                "total_tokens": usage.0 + usage.1,
            });
            return Ok(Rounded { chat, searches });
        }
        let mut message = chat["choices"][0]["message"].clone();
        let mut answers = Vec::new();
        for (place, call) in ours.iter().enumerate() {
            let call_id = call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map_or_else(|| format!("call_search_{round}_{place}"), str::to_owned);
            message["tool_calls"][place]["id"] = json!(call_id);
            let search = run_one(backend, call, plan, searches.len(), cancel).await;
            answers.push(json!({"role": "tool", "tool_call_id": call_id, "content": result_text(&search)}));
            searches.push(search);
        }
        if let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) {
            messages.push(message);
            messages.extend(answers);
        }
    }
    Err(Failure::Backend(BackendError {
        message: "The model kept asking to search.".to_owned(),
    }))
}

fn set_tool(body: &mut Value, open: bool) {
    let Some(object) = body.as_object_mut() else { return };
    let tools = object.entry("tools").or_insert_with(|| json!([]));
    let Some(list) = tools.as_array_mut() else { return };
    list.retain(|tool| tool.pointer("/function/name").and_then(Value::as_str) != Some(TOOL));
    if open {
        list.push(tool_definition());
    }
    if list.is_empty() {
        object.remove("tools");
        object.remove("tool_choice");
    }
}

async fn run_one<B: Backend>(
    backend: &B,
    call: &Value,
    plan: &Plan,
    done: usize,
    cancel: &CancellationToken,
) -> Search {
    let arguments = call.pointer("/function/arguments").and_then(Value::as_str).unwrap_or("");
    let query = serde_json::from_str::<Value>(arguments)
        .ok()
        .and_then(|args| args.get("query").and_then(Value::as_str).map(str::trim).map(str::to_owned))
        .unwrap_or_default();
    let mut search = Search {
        id: format!("{}", done + 1),
        query: query.clone(),
        ..Search::default()
    };
    if query.is_empty() {
        search.error = Some("invalid_tool_input".to_owned());
    } else if !plan.enabled {
        search.error = Some("unavailable".to_owned());
    } else if u32::try_from(done).unwrap_or(u32::MAX) >= plan.max {
        search.error = Some("max_uses_exceeded".to_owned());
    } else {
        match backend.web_search(&query, cancel.clone()).await {
            Ok(hits) => search.hits = hits,
            Err(_) => search.error = Some("unavailable".to_owned()),
        }
    }
    search
}

/// What the model reads back for one search.
fn result_text(search: &Search) -> String {
    if let Some(error) = &search.error {
        return format!("The search failed: {error}.");
    }
    if search.hits.is_empty() {
        return "No results.".to_owned();
    }
    search
        .hits
        .iter()
        .enumerate()
        .map(|(place, hit)| format!("{}. {}\n{}\n{}", place + 1, hit.title, hit.url, hit.snippet))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// A whole chat reply as a one-chunk chat stream, so a translator can stream it.
pub fn as_stream(chat: &Value) -> ByteStream {
    let message = chat.pointer("/choices/0/message").cloned().unwrap_or(Value::Null);
    let mut delta = json!({});
    for key in ["content", "reasoning_content"] {
        if let Some(text) = message.get(key).and_then(Value::as_str).filter(|text| !text.is_empty()) {
            delta[key] = json!(text);
        }
    }
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array).filter(|calls| !calls.is_empty()) {
        let numbered: Vec<Value> = calls
            .iter()
            .enumerate()
            .map(|(index, call)| {
                let mut call = call.clone();
                call["index"] = json!(index);
                call
            })
            .collect();
        delta["tool_calls"] = Value::Array(numbered);
    }
    let finish = chat.pointer("/choices/0/finish_reason").cloned().unwrap_or_else(|| json!("stop"));
    let chunk = json!({
        "id": chat.get("id").cloned().unwrap_or(Value::Null),
        "object": "chat.completion.chunk",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        "usage": chat.get("usage").cloned().unwrap_or(Value::Null),
    });
    let frames = vec![
        Ok(Bytes::from(format!("data: {chunk}\n\n"))),
        Ok(Bytes::from_static(b"data: [DONE]\n\n")),
    ];
    Box::pin(stream::iter(frames))
}

/// A whole chat reply as the body of a non-streamed answer.
pub fn as_bytes(chat: &Value) -> ByteStream {
    Box::pin(stream::iter(vec![Ok(Bytes::from(chat.to_string()))]))
}
