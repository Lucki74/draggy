//! A Claude account's chat turn: one Claude Code process per request, stopped when the reader goes. Port of
//! adapters/claude.cjs. A turn that calls a Draggy tool keeps its process until the tool results come back.
use std::sync::Mutex;
use std::sync::PoisonError;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use draggy_providers::account::env::private_home;
use draggy_providers::account::threads::{Threads, same_conversation, split};
use draggy_providers::claude::adapter::{
    effort_of, mcp_tools, text_of, to_content, turn_failure, usage_of,
};
use draggy_providers::claude::process::{
    SERVER, SessionArgs, TOOL_PREFIX, initialize_params, start_args,
};
use draggy_providers::gateway::{AccountCall, AccountFailure, AccountRuntime, AccountSink};
use draggy_providers::sse::Delta;
use draggy_providers::types::{ErrorKind, FinishReason, ProviderError, ProviderState, Usage};
use serde_json::{Value, json};
use tauri::AppHandle;

use super::session::Session;
use super::{Setup, app_data_root, auth_status, install, signed_in};
use crate::ipc::providers::diag;

/// How long a tool call waits for its siblings, since Claude Code sends a batch one control request each.
const SETTLE: Duration = Duration::from_millis(100);
const TICK: Duration = Duration::from_millis(100);
/// A turn parked on tool results is dropped after the same idle window the runtime uses.
const PARK: Duration = Duration::from_secs(10 * 60);

static CALLS: AtomicU64 = AtomicU64::new(0);
/// Turns waiting on their tool results. Each holds its process; dropping one kills it.
static PARKED: Mutex<Vec<Turn>> = Mutex::new(Vec::new());

/// One turn on its own process: what it has seen, and the tool calls it still waits on.
struct Turn {
    instance: String,
    session: Session,
    sid: String,
    messages: Vec<Value>,
    tools: Vec<Value>,
    calls: Vec<Pending>,
    calls_made: u64,
    at: Option<String>,
    length: bool,
    limit: Option<Value>,
    failure: Option<AccountFailure>,
    parked: Option<Instant>,
    epoch: u64,
}

/// A tool call Claude Code made, answered once its result comes back in a later request.
struct Pending {
    call_id: String,
    request_id: Value,
    rpc_id: Value,
}

/// The Claude account as a gateway runtime.
pub struct ClaudeChat {
    app: AppHandle,
}

impl ClaudeChat {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl AccountRuntime for ClaudeChat {
    fn stream(
        &self,
        call: &AccountCall<'_>,
        sink: &mut dyn AccountSink,
    ) -> Result<(), Box<AccountFailure>> {
        tauri::async_runtime::block_on(turn(&self.app, call, sink))
    }
}

async fn turn(
    app: &AppHandle,
    call: &AccountCall<'_>,
    sink: &mut dyn AccountSink,
) -> Result<(), Box<AccountFailure>> {
    let outcome = run(app, call, sink).await;
    if let Err(failure) = &outcome {
        diag(app).warn(
            "providers.claude",
            "turn failed",
            Some(json!({ "kind": failure.failure.kind })),
        );
    }
    outcome
}

async fn run(
    app: &AppHandle,
    call: &AccountCall<'_>,
    sink: &mut dyn AccountSink,
) -> Result<(), Box<AccountFailure>> {
    let root = app_data_root().map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
    let instance = call.connection.instance.id.clone();
    let messages: Vec<Value> = call
        .body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let results = trailing_results(&messages);
    if let Some(mut waiting) = take_waiting(&results) {
        answer_pending(&mut waiting, &results).await?;
        return drive(waiting, sink).await;
    }

    let binary = install(app, &instance, &root)
        .await
        .map_err(|m| boxed(ErrorKind::AccountRuntimeUnavailable, &m))?;
    let setup = Setup::new(&root, &instance).map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
    if !signed_in(&auth_status(&binary, &setup).await) {
        return Err(boxed(
            ErrorKind::AccountSignedOut,
            "The Claude account is signed out.",
        ));
    }
    sweep(&messages);

    // A stored thread is forked at its last reply when its session is still on disk; otherwise the whole
    // conversation is sent again, as the reference does after a restart.
    let home = private_home(&root, "claude", &instance).ok();
    let stored = Threads::new(&instance, "sessionId").stored(&messages);
    let fork = stored.as_ref().and_then(|found| {
        let from = found.state["sessionId"].as_str()?;
        let at = found.state["at"].as_str()?;
        let on_disk = home.as_deref().is_some_and(|h| session_on_disk(h, from));
        on_disk.then(|| (from.to_owned(), at.to_owned()))
    });
    let (history, input) = match (&fork, stored) {
        (Some(_), Some(found)) => (found.history, found.input),
        _ => {
            let rest = split(&messages);
            (rest.history, rest.input)
        }
    };

    let sid = new_session_id();
    let system = messages
        .iter()
        .filter(|m| m["role"] == "system")
        .map(|m| text_of(&m["content"]))
        .collect::<Vec<_>>()
        .join("\n\n");
    let effort = effort_of(call.body);
    let args = start_args(&SessionArgs {
        model: Some(call.model_id),
        effort: effort["effort"].as_str(),
        thinking: effort["thinking"].as_bool(),
        system_prompt: Some(&system),
        session_id: &sid,
        resume: false,
        fork_from: fork.as_ref().map(|(from, _)| from.as_str()),
        at: fork.as_ref().map(|(_, at)| at.as_str()),
    });

    let mut session = Session::start(&binary, &setup.cwd, &setup.env, &args)
        .map_err(|m| boxed(ErrorKind::AccountRuntimeUnavailable, &m))?;
    session
        .request("initialize", initialize_params())
        .await
        .map_err(|m| boxed(ErrorKind::AccountRuntimeUnavailable, &m))?;
    let content = to_content(&history, input.as_ref());
    session
        .write(&json!({
            "type": "user",
            "message": { "role": "user", "content": content },
            "parent_tool_use_id": null,
            "session_id": "",
        }))
        .await
        .map_err(|_| stopped())?;
    diag(app).info(
        "providers.claude",
        "turn started",
        Some(json!({ "forked": fork.is_some() })),
    );

    let turn = Turn {
        instance,
        session,
        sid,
        messages,
        tools: mcp_tools(call.body.get("tools").unwrap_or(&Value::Null)),
        calls: Vec::new(),
        calls_made: 0,
        at: None,
        length: false,
        limit: None,
        failure: None,
        parked: None,
        epoch: super::stop_epoch(),
    };
    drive(turn, sink).await
}

/// Ends the parked turns and every running one, whose processes die with them.
pub fn stop_all() {
    super::bump_stop_epoch();
    PARKED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clear();
}

enum Flow {
    Go,
    Called,
    Done(Result<(), Box<AccountFailure>>),
}

/// Reads the runtime's lines into the sink until the turn ends, parks on tool calls, or the reader goes.
async fn drive(mut turn: Turn, sink: &mut dyn AccountSink) -> Result<(), Box<AccountFailure>> {
    let mut settle: Option<Instant> = None;
    loop {
        // Dropping the turn kills its process, which is how a stop ends a turn.
        if sink.cancelled() || turn.epoch != super::stop_epoch() {
            return Ok(());
        }
        if settle.is_some_and(|at| Instant::now() >= at) {
            return park(turn, sink);
        }
        let wait = settle.map_or(TICK, |at| {
            at.saturating_duration_since(Instant::now()).min(TICK)
        });
        let read = tokio::select! {
            read = turn.session.next_message() => Some(read),
            _ = tokio::time::sleep(wait) => None,
        };
        let Some(read) = read else { continue };
        let message = match read {
            Ok(Some(message)) => message,
            _ => return Err(stopped()),
        };
        match handle(&mut turn, &message, sink).await? {
            Flow::Go => {}
            Flow::Called => settle = Some(Instant::now() + SETTLE),
            Flow::Done(result) => return result,
        }
    }
}

/// Ends the request on the tool calls and keeps the process for the results the next request brings.
fn park(mut turn: Turn, sink: &mut dyn AccountSink) -> Result<(), Box<AccountFailure>> {
    sink.finish(FinishReason::ToolCalls, Usage::default());
    turn.parked = Some(Instant::now());
    PARKED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(turn);
    Ok(())
}

async fn handle(
    turn: &mut Turn,
    message: &Value,
    sink: &mut dyn AccountSink,
) -> Result<Flow, Box<AccountFailure>> {
    match message.get("type").and_then(Value::as_str) {
        Some("rate_limit_event") => {
            rate_limit(turn, message);
            Ok(Flow::Go)
        }
        Some("stream_event") => {
            streamed_into(turn, message.get("event"), sink);
            Ok(Flow::Go)
        }
        Some("assistant") => {
            assistant(turn, message);
            Ok(Flow::Go)
        }
        Some("control_request") => control(turn, message, sink).await,
        Some("result") => Ok(Flow::Done(finished(turn, message, sink))),
        _ => Ok(Flow::Go),
    }
}

fn rate_limit(turn: &mut Turn, message: &Value) {
    let info = message
        .get("rate_limit_info")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if info["status"] == "rejected" && turn.failure.is_none() {
        turn.failure = Some(AccountFailure {
            failure: failure(
                ErrorKind::AccountLimitReached,
                "The Claude plan's usage limit is reached.",
            ),
            resets_at: info.get("resetsAt").cloned(),
        });
    }
    turn.limit = Some(info);
}

/// What one stream event adds to the answer.
#[derive(Debug, PartialEq)]
enum Streamed {
    Text(String),
    Reasoning(String),
    Length,
}

fn streamed(event: &Value) -> Option<Streamed> {
    match event.get("type")?.as_str()? {
        "content_block_delta" => {
            let delta = &event["delta"];
            match delta["type"].as_str()? {
                "text_delta" => Some(Streamed::Text(delta["text"].as_str()?.to_owned())),
                "thinking_delta" => {
                    Some(Streamed::Reasoning(delta["thinking"].as_str()?.to_owned()))
                }
                _ => None,
            }
        }
        "message_delta" => {
            (event["delta"]["stop_reason"] == "max_tokens").then_some(Streamed::Length)
        }
        _ => None,
    }
}

fn streamed_into(turn: &mut Turn, event: Option<&Value>, sink: &mut dyn AccountSink) {
    match event.and_then(streamed) {
        Some(Streamed::Text(content)) => sink.delta(Delta {
            content: Some(content),
            ..Default::default()
        }),
        Some(Streamed::Reasoning(reasoning)) => sink.delta(Delta {
            reasoning: Some(reasoning),
            ..Default::default()
        }),
        Some(Streamed::Length) => turn.length = true,
        None => {}
    }
}

fn assistant(turn: &mut Turn, message: &Value) {
    if let Some(uuid) = message["uuid"].as_str() {
        turn.at = Some(uuid.to_owned());
    }
    let Some(error) = message["error"].as_str() else {
        return;
    };
    let text = text_of(&message["message"]["content"]);
    let text = if text.is_empty() {
        error.to_owned()
    } else {
        text
    };
    if turn.failure.is_none() {
        turn.failure = Some(if error == "authentication_failed" {
            AccountFailure::from(failure(ErrorKind::AccountSignedOut, &text))
        } else {
            turn_failure(&text, turn.limit.as_ref())
        });
    }
}

async fn control(
    turn: &mut Turn,
    message: &Value,
    sink: &mut dyn AccountSink,
) -> Result<Flow, Box<AccountFailure>> {
    let request_id = message.get("request_id").cloned().unwrap_or(Value::Null);
    let request = message.get("request").cloned().unwrap_or(Value::Null);
    let subtype = request["subtype"].as_str().unwrap_or_default().to_owned();

    if subtype == "mcp_message" && request["server_name"] == SERVER {
        let rpc = request.get("message").cloned().unwrap_or_else(|| json!({}));
        if rpc["method"] == "tools/call" {
            let params = rpc.get("params").cloned().unwrap_or_else(|| json!({}));
            let (name, arguments) = call_of(&params);
            let call_id = format!("call_{}", CALLS.fetch_add(1, Ordering::Relaxed));
            sink.delta(Delta {
                tool_calls: vec![tool_call_delta(
                    turn.calls_made,
                    &call_id,
                    &name,
                    &arguments,
                )],
                ..Default::default()
            });
            turn.calls_made += 1;
            turn.calls.push(Pending {
                call_id,
                request_id,
                rpc_id: rpc_id(&rpc),
            });
            return Ok(Flow::Called);
        }
        let result = mcp_result(&rpc, &turn.tools);
        let response = json!({ "mcp_response": jsonrpc(&rpc_id(&rpc), result) });
        reply(turn, &request_id, response).await?;
        return Ok(Flow::Go);
    }

    if subtype == "can_use_tool" {
        let name = request["tool_name"].as_str().unwrap_or_default().to_owned();
        if name.starts_with(TOOL_PREFIX) {
            let input = request.get("input").cloned().unwrap_or_else(|| json!({}));
            reply(
                turn,
                &request_id,
                json!({ "behavior": "allow", "updatedInput": input }),
            )
            .await?;
            return Ok(Flow::Go);
        }
        if turn.failure.is_none() {
            turn.failure = Some(AccountFailure::from(failure(
                ErrorKind::UnknownError,
                &format!(
                    "Claude Code asked to use its own tool ({name}), which Draggy never offers."
                ),
            )));
        }
        let _ = turn
            .session
            .write(&json!({
                "type": "control_request",
                "request_id": "draggy-interrupt",
                "request": { "subtype": "interrupt" },
            }))
            .await;
        let deny = json!({ "behavior": "deny", "message": "Only Draggy's tools may run." });
        reply(turn, &request_id, deny).await?;
        return Ok(Flow::Go);
    }

    let error = format!("{subtype} is not available in Draggy");
    let frame = json!({
        "type": "control_response",
        "response": { "subtype": "error", "request_id": request_id, "error": error },
    });
    turn.session.write(&frame).await.map_err(|_| stopped())?;
    Ok(Flow::Go)
}

fn finished(
    turn: &mut Turn,
    result: &Value,
    sink: &mut dyn AccountSink,
) -> Result<(), Box<AccountFailure>> {
    let usage = usage_of(result.get("usage"));
    if turn.failure.is_none() && is_success(result) {
        let recorded = Threads::new(&turn.instance, "sessionId").record(&turn.sid, &turn.messages);
        let mut state = recorded["state"].clone();
        if let Some(at) = &turn.at {
            state["at"] = json!(at);
        }
        sink.provider_state(&ProviderState {
            instance_id: turn.instance.clone(),
            state,
        });
        let reason = if turn.length {
            FinishReason::Length
        } else {
            FinishReason::Stop
        };
        sink.finish(reason, usage);
        return Ok(());
    }
    let text = result_text(result);
    let failed = turn
        .failure
        .take()
        .unwrap_or_else(|| turn_failure(&text, turn.limit.as_ref()));
    Err(Box::new(failed))
}

/// Answers the tool calls a parked turn waits on with the results the request brings, or a note when none came.
async fn answer_pending(turn: &mut Turn, results: &[Value]) -> Result<(), Box<AccountFailure>> {
    turn.calls_made = 0;
    for pending in std::mem::take(&mut turn.calls) {
        let text = results
            .iter()
            .find(|m| m["tool_call_id"] == pending.call_id.as_str())
            .map(|m| text_of(&m["content"]));
        let result = tool_result(text.as_deref());
        let response = json!({ "mcp_response": jsonrpc(&pending.rpc_id, result) });
        reply(turn, &pending.request_id, response).await?;
    }
    Ok(())
}

/// The parked turn these tool results belong to, taken out of the parked list.
fn take_waiting(results: &[Value]) -> Option<Turn> {
    if results.is_empty() {
        return None;
    }
    let mut parked = PARKED.lock().unwrap_or_else(PoisonError::into_inner);
    let index = parked.iter().position(|turn| {
        turn.calls.iter().any(|call| {
            results
                .iter()
                .any(|m| m["tool_call_id"] == call.call_id.as_str())
        })
    })?;
    Some(parked.remove(index))
}

/// Drops parked turns that were left for too long or that a new message in their conversation has moved past.
fn sweep(messages: &[Value]) {
    let mut parked = PARKED.lock().unwrap_or_else(PoisonError::into_inner);
    parked.retain(|turn| {
        turn.parked.is_some_and(|at| at.elapsed() < PARK)
            && !same_conversation(&turn.messages, messages)
    });
}

async fn reply(
    turn: &mut Turn,
    request_id: &Value,
    response: Value,
) -> Result<(), Box<AccountFailure>> {
    let frame = json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response },
    });
    turn.session.write(&frame).await.map_err(|_| stopped())
}

/// The reply to one MCP request, or None for a tool call, which is answered once its result arrives.
fn mcp_result(rpc: &Value, tools: &[Value]) -> Value {
    match rpc["method"].as_str() {
        Some("initialize") => json!({
            "protocolVersion": rpc["params"]["protocolVersion"],
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER, "version": env!("CARGO_PKG_VERSION") },
        }),
        Some("tools/list") => json!({ "tools": tools }),
        _ => json!({}),
    }
}

/// The MCP result for a tool call: its text, or a note that the call was not run.
fn tool_result(text: Option<&str>) -> Value {
    json!({
        "content": [{ "type": "text", "text": text.unwrap_or("The call was not run.") }],
        "isError": text.is_none(),
    })
}

fn jsonrpc(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_id(rpc: &Value) -> Value {
    match rpc.get("id") {
        Some(id) if !id.is_null() => id.clone(),
        _ => json!(0),
    }
}

/// The name and JSON text of a tool call's arguments, as the tool call delta carries them.
fn call_of(params: &Value) -> (String, String) {
    let name = params["name"].as_str().unwrap_or_default().to_owned();
    let arguments = match params.get("arguments") {
        Some(args) if !args.is_null() => args.to_string(),
        _ => "{}".to_owned(),
    };
    (name, arguments)
}

fn tool_call_delta(index: u64, id: &str, name: &str, arguments: &str) -> Value {
    json!({
        "index": index,
        "id": id,
        "type": "function",
        "function": { "name": name, "arguments": arguments },
    })
}

fn is_success(result: &Value) -> bool {
    result["subtype"] == "success" && !result["is_error"].as_bool().unwrap_or(false)
}

/// The runtime's words for a failed turn: its result text, else its errors joined.
fn result_text(result: &Value) -> String {
    match result["result"].as_str().filter(|text| !text.is_empty()) {
        Some(text) => text.to_owned(),
        None => result["errors"]
            .as_array()
            .map(|errors| {
                errors
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default(),
    }
}

/// The tool results at the end of a request, in order.
pub(super) fn trailing_results(messages: &[Value]) -> Vec<Value> {
    let mut results: Vec<Value> = messages
        .iter()
        .rev()
        .take_while(|m| m["role"] == "tool")
        .cloned()
        .collect();
    results.reverse();
    results
}

/// Claude Code files each session under a folder named for its working folder, so any of them may hold it.
fn session_on_disk(home: &str, sid: &str) -> bool {
    let valid = !sid.is_empty() && sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if !valid {
        return false;
    }
    let projects = std::path::Path::new(home).join("projects");
    std::fs::read_dir(projects).is_ok_and(|dirs| {
        dirs.flatten()
            .any(|dir| dir.path().join(format!("{sid}.jsonl")).exists())
    })
}

/// A random version 4 UUID, which the runtime requires for a session id.
fn new_session_id() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

fn failure(kind: ErrorKind, message: &str) -> ProviderError {
    ProviderError {
        kind,
        status: Some(0),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }
}

fn boxed(kind: ErrorKind, message: &str) -> Box<AccountFailure> {
    Box::new(AccountFailure::from(failure(kind, message)))
}

fn stopped() -> Box<AccountFailure> {
    boxed(
        ErrorKind::AccountRuntimeUnavailable,
        "Claude Code stopped during the turn.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(line: &str) -> Option<Streamed> {
        let message: Value = serde_json::from_str(line).expect("fixture");
        streamed(&message["event"])
    }

    #[test]
    fn stream_events_map_to_text_reasoning_and_length() {
        assert_eq!(
            event(
                r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}"#
            ),
            Some(Streamed::Text("Hi".to_owned()))
        );
        assert_eq!(
            event(
                r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}}"#
            ),
            Some(Streamed::Reasoning("hmm".to_owned()))
        );
        assert_eq!(
            event(
                r#"{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}}"#
            ),
            Some(Streamed::Length)
        );
        assert_eq!(
            event(r#"{"type":"stream_event","event":{"type":"message_start"}}"#),
            None
        );
    }

    #[test]
    fn tool_calls_carry_their_name_and_arguments() {
        let params: Value =
            serde_json::from_str(r#"{"name":"mcp__draggy__read","arguments":{"path":"a.txt"}}"#)
                .expect("fixture");
        let (name, arguments) = call_of(&params);
        assert_eq!(name, "mcp__draggy__read");
        assert_eq!(arguments, r#"{"path":"a.txt"}"#);
        assert_eq!(call_of(&json!({"name": "x"})).1, "{}");
        let delta = tool_call_delta(0, "call_1", &name, &arguments);
        assert_eq!(delta["function"]["name"], "mcp__draggy__read");
        assert_eq!(delta["type"], "function");
    }

    #[test]
    fn mcp_requests_are_answered_from_the_tools_list() {
        let tools = vec![json!({"name": "read"})];
        let list: Value =
            serde_json::from_str(r#"{"method":"tools/list","id":3}"#).expect("fixture");
        assert_eq!(mcp_result(&list, &tools), json!({"tools": tools}));
        assert_eq!(rpc_id(&list), json!(3));
        let init: Value = serde_json::from_str(
            r#"{"method":"initialize","id":1,"params":{"protocolVersion":"2025-06-18"}}"#,
        )
        .expect("fixture");
        let result = mcp_result(&init, &[]);
        assert_eq!(result["protocolVersion"], "2025-06-18");
        assert_eq!(result["serverInfo"]["name"], SERVER);
        assert_eq!(rpc_id(&json!({})), json!(0));
    }

    #[test]
    fn tool_results_answer_by_call_id_or_say_the_call_was_not_run() {
        let answered = tool_result(Some("42"));
        assert_eq!(answered["content"][0]["text"], "42");
        assert_eq!(answered["isError"], false);
        let missing = tool_result(None);
        assert_eq!(missing["content"][0]["text"], "The call was not run.");
        assert_eq!(missing["isError"], true);
    }

    #[test]
    fn a_finished_turn_is_a_success_only_without_an_error_flag() {
        let ok: Value = serde_json::from_str(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done"}"#,
        )
        .expect("fixture");
        assert!(is_success(&ok));
        assert_eq!(result_text(&ok), "Done");
        let failed: Value = serde_json::from_str(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["a","b"]}"#,
        )
        .expect("fixture");
        assert!(!is_success(&failed));
        assert_eq!(result_text(&failed), "a b");
        assert_eq!(usage_of(ok.get("usage")).prompt_tokens, 0);
    }

    #[test]
    fn only_trailing_tool_messages_are_results() {
        let messages = vec![
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "content": ""}),
            json!({"role": "tool", "tool_call_id": "call_a", "content": "1"}),
            json!({"role": "tool", "tool_call_id": "call_b", "content": "2"}),
        ];
        let results = trailing_results(&messages);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["tool_call_id"], "call_a");
        assert!(trailing_results(&messages[..2]).is_empty());
    }

    #[test]
    fn session_ids_are_version_four_uuids_and_bad_ids_are_never_on_disk() {
        let sid = new_session_id();
        assert_eq!(sid.len(), 36);
        assert_eq!(sid.as_bytes()[14], b'4');
        assert!(sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        assert!(!session_on_disk("C:\\nowhere", "../../etc"));
        assert!(!session_on_disk("C:\\nowhere", &sid));
    }

    #[test]
    fn a_turn_failure_keeps_the_reset_time_the_runtime_names() {
        let limit = json!({"resetsAt": 1700000000});
        let failure = turn_failure("Claude AI usage limit reached|1800000000", Some(&limit));
        assert_eq!(failure.failure.kind, ErrorKind::AccountLimitReached);
        assert_eq!(failure.resets_at, Some(json!(1800000000u64)));
    }
}
