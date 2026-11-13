//! A ChatGPT account's chat turn: one Codex app-server per request, stopped when the reader goes. Port of
//! adapters/codex.cjs. A turn that calls a Draggy tool keeps its process until the tool results come back.
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use draggy_providers::account::threads::{Threads, same_conversation};
use draggy_providers::claude::adapter::text_of;
use draggy_providers::codex::adapter::{
    dynamic_tools, effort_of, to_input, to_items, turn_failure,
};
use draggy_providers::gateway::{AccountCall, AccountFailure, AccountRuntime, AccountSink};
use draggy_providers::rpc::Event;
use draggy_providers::sse::Delta;
use draggy_providers::types::{ErrorKind, FinishReason, ProviderError, ProviderState, Usage};
use draggy_providers::usage::from_codex;
use serde_json::{Value, json};
use tauri::AppHandle;

use super::claude_chat::trailing_results;
use super::codex::{Client, install, setup};
use super::{app_data_root, bump_stop_epoch, stop_epoch};
use crate::ipc::providers::diag;

/// How long a tool call waits for its siblings, since a call arrives as one server request each.
const SETTLE: Duration = Duration::from_millis(100);
const TICK: Duration = Duration::from_millis(100);
/// A turn parked on tool results is dropped after the same idle window the runtime uses.
const PARK: Duration = Duration::from_secs(10 * 60);
const NOT_RUN: &str = "The call was not run.";
const SIGNED_OUT: &str = "The ChatGPT account is signed out.";
const STOPPED: &str = "Codex stopped during the turn.";

static PARKED: Mutex<Vec<Turn>> = Mutex::new(Vec::new());
/// Each instance's threads the runtime still holds. They last until a stop, a sign-out or a turn that did not end cleanly.
static THREADS: Mutex<Option<HashMap<String, Threads>>> = Mutex::new(None);

fn threads_for<T>(instance: &str, work: impl FnOnce(&mut Threads) -> T) -> T {
    let mut guard = THREADS.lock().unwrap_or_else(PoisonError::into_inner);
    let threads = guard
        .get_or_insert_with(HashMap::new)
        .entry(instance.to_owned())
        .or_insert_with(|| Threads::new(instance, "threadId"));
    work(threads)
}

fn forget_thread(turn: &Turn) {
    let id = turn.thread_id.clone();
    threads_for(&turn.instance, |threads| threads.forget(&id));
}

/// Sends the buffered requests; a broken pipe ends the turn and its thread.
async fn flush_or_forget(turn: &mut Turn) -> Result<(), Box<AccountFailure>> {
    match turn.client.flush().await {
        Ok(()) => Ok(()),
        Err(_) => {
            forget_thread(turn);
            Err(stopped())
        }
    }
}

/// Forgets an instance's live threads, as a sign-out does.
pub(super) fn clear_threads(instance: &str) {
    if let Some(map) = THREADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        map.remove(instance);
    }
}

/// One turn on its own process: what it has seen, and the tool calls it still waits on.
struct Turn {
    instance: String,
    client: Client,
    thread_id: String,
    turn_start: Option<u64>,
    turn_id: Option<String>,
    messages: Vec<Value>,
    calls: Vec<Pending>,
    calls_made: u64,
    usage: Usage,
    limits: Option<Value>,
    failure: Option<AccountFailure>,
    parked: Option<Instant>,
    epoch: u64,
}

/// A tool call Codex made, answered once its result comes back in a later request.
struct Pending {
    call_id: String,
    request_id: Value,
}

/// The ChatGPT account as a gateway runtime.
pub struct CodexChat {
    app: AppHandle,
}

impl CodexChat {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl AccountRuntime for CodexChat {
    fn stream(
        &self,
        call: &AccountCall<'_>,
        sink: &mut dyn AccountSink,
    ) -> Result<(), Box<AccountFailure>> {
        tauri::async_runtime::block_on(turn(&self.app, call, sink))
    }
}

/// Ends the parked turns and every running one, whose processes die with them.
pub fn stop_all() {
    bump_stop_epoch();
    *THREADS.lock().unwrap_or_else(PoisonError::into_inner) = None;
    PARKED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clear();
}

async fn turn(
    app: &AppHandle,
    call: &AccountCall<'_>,
    sink: &mut dyn AccountSink,
) -> Result<(), Box<AccountFailure>> {
    let outcome = run(app, call, sink).await;
    if let Err(failure) = &outcome {
        diag(app).warn(
            "providers.codex",
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
    let (home, env) = setup(&root, &instance).map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
    let mut client = Client::start(&binary, &home, &env)
        .await
        .map_err(|m| boxed(ErrorKind::AccountRuntimeUnavailable, &m))?;
    require_sign_in(&mut client).await?;
    sweep(&messages);

    let plan = threads_for(&instance, |threads| threads.plan(&messages));
    let thread_id = match plan.id {
        Some(id) => id,
        None => {
            let system = messages
                .iter()
                .filter(|m| m["role"] == "system")
                .map(|m| text_of(&m["content"]))
                .collect::<Vec<_>>()
                .join("\n\n");
            let started = client
                .request(
                    "thread/start",
                    json!({
                        "model": call.model_id,
                        "cwd": home,
                        "environments": [],
                        "ephemeral": true,
                        "baseInstructions": system,
                        "dynamicTools": dynamic_tools(call.body.get("tools").unwrap_or(&Value::Null)),
                    }),
                )
                .await
                .map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
            started["thread"]["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| boxed(ErrorKind::UnknownError, "Codex gave no thread."))?
        }
    };

    let items: Vec<Value> = plan.history.iter().flat_map(to_items).collect();
    if !items.is_empty() {
        client
            .request(
                "thread/inject_items",
                json!({ "threadId": thread_id, "items": items }),
            )
            .await
            .map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
    }

    let mut params = json!({ "threadId": thread_id, "input": to_input(plan.input.as_ref()) });
    if let Some(effort) = effort_of(call.body).as_object() {
        for (key, value) in effort {
            params[key.as_str()] = value.clone();
        }
    }
    let mut turn = Turn {
        instance,
        client,
        thread_id,
        turn_start: None,
        turn_id: None,
        messages,
        calls: Vec::new(),
        calls_made: 0,
        usage: Usage::default(),
        limits: None,
        failure: None,
        parked: None,
        epoch: stop_epoch(),
    };
    let id = turn
        .client
        .rpc
        .call("turn/start", Some(params), None)
        .map_err(|error| boxed(ErrorKind::UnknownError, &error.message))?;
    turn.turn_start = Some(id);
    flush_or_forget(&mut turn).await?;
    drive(turn, sink).await
}

async fn require_sign_in(client: &mut Client) -> Result<(), Box<AccountFailure>> {
    let read = client
        .request("account/read", json!({}))
        .await
        .map_err(|m| boxed(ErrorKind::UnknownError, &m))?;
    match read.get("account") {
        Some(account) if !account.is_null() => Ok(()),
        _ => Err(boxed(ErrorKind::AccountSignedOut, SIGNED_OUT)),
    }
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
        // Dropping the turn kills its process, which is how a stop or a reader that left ends a turn.
        if sink.cancelled() || turn.epoch != stop_epoch() {
            forget_thread(&turn);
            return Ok(());
        }
        if settle.is_some_and(|at| Instant::now() >= at) {
            return park(turn, sink);
        }
        let events = turn.client.rpc.take_events();
        if events.is_empty() {
            let wait = settle.map_or(TICK, |at| {
                at.saturating_duration_since(Instant::now()).min(TICK)
            });
            let read = tokio::select! {
                line = turn.client.lines.next_line() => Some(line),
                _ = tokio::time::sleep(wait) => None,
            };
            let Some(read) = read else { continue };
            let line = match read {
                Ok(Some(line)) => line,
                _ => {
                    forget_thread(&turn);
                    return Err(stopped());
                }
            };
            turn.client.rpc.feed(format!("{line}\n").as_bytes());
            flush_or_forget(&mut turn).await?;
            continue;
        }
        for event in events {
            match handle(&mut turn, event, sink) {
                Flow::Go => {}
                Flow::Called => settle = Some(Instant::now() + SETTLE),
                Flow::Done(result) => return result,
            }
        }
        flush_or_forget(&mut turn).await?;
    }
}

/// Ends the request on the tool calls and keeps the process for the results the next request brings.
fn park(mut turn: Turn, sink: &mut dyn AccountSink) -> Result<(), Box<AccountFailure>> {
    sink.finish(FinishReason::ToolCalls, turn.usage);
    turn.parked = Some(Instant::now());
    PARKED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(turn);
    Ok(())
}

fn handle(turn: &mut Turn, event: Event, sink: &mut dyn AccountSink) -> Flow {
    match event {
        Event::Notification { method, params } => {
            notified(turn, &method, &params.unwrap_or(Value::Null), sink)
        }
        Event::Request { id, method, params } => {
            requested(turn, id, &method, &params.unwrap_or(Value::Null), sink)
        }
        Event::Settled { id, result } if Some(id) == turn.turn_start => match result {
            Ok(value) => {
                turn.turn_start = None;
                turn.turn_id = value["turn"]["id"].as_str().map(str::to_owned);
                Flow::Go
            }
            Err(error) => Flow::Done(Err(boxed(ErrorKind::UnknownError, &error.message))),
        },
        Event::Closed(_) => Flow::Done(Err(stopped())),
        _ => Flow::Go,
    }
}

fn notified(turn: &mut Turn, method: &str, params: &Value, sink: &mut dyn AccountSink) -> Flow {
    if method == "account/rateLimits/updated" {
        merge_limits(turn, &params["rateLimits"]);
        return Flow::Go;
    }
    if params["threadId"].as_str() != Some(turn.thread_id.as_str()) {
        return Flow::Go;
    }
    match streamed_of(method, params) {
        Some(Streamed::Text(content)) => sink.delta(Delta {
            content: Some(content),
            ..Default::default()
        }),
        Some(Streamed::Reasoning(reasoning)) => sink.delta(Delta {
            reasoning: Some(reasoning),
            ..Default::default()
        }),
        None => {}
    }
    match method {
        "thread/tokenUsage/updated" => turn.usage = from_codex(params["tokenUsage"].get("last")),
        "turn/completed" => return completed(turn, &params["turn"], sink),
        _ => {}
    }
    Flow::Go
}

fn merge_limits(turn: &mut Turn, rate_limits: &Value) {
    turn.limits = Some(merged_limits(turn.limits.take(), rate_limits));
}

/// The windows Codex reports: each one present replaces the last, and a null one leaves the last alone.
fn merged_limits(current: Option<Value>, update: &Value) -> Value {
    let mut limits = current.unwrap_or_else(|| json!({}));
    if let Some(windows) = update.as_object() {
        for (key, window) in windows.iter().filter(|(_, window)| !window.is_null()) {
            limits[key.as_str()] = window.clone();
        }
    }
    limits
}

/// What one Codex notification adds to the answer.
#[derive(Debug, PartialEq)]
enum Streamed {
    Text(String),
    Reasoning(String),
}

fn streamed_of(method: &str, params: &Value) -> Option<Streamed> {
    let delta = params["delta"].as_str()?.to_owned();
    match method {
        "item/agentMessage/delta" => Some(Streamed::Text(delta)),
        "item/reasoning/summaryTextDelta" => Some(Streamed::Reasoning(delta)),
        _ => None,
    }
}

/// How a finished turn ends: stopped, cut at the context window, failed, or with no answer to give.
#[derive(Debug, PartialEq)]
enum Ending {
    Stop,
    Length,
    Failed(Box<AccountFailure>),
    Quiet,
}

fn ending_of(result: &Value, failure: Option<AccountFailure>, limits: Option<&Value>) -> Ending {
    let status = result["status"].as_str();
    if status == Some("completed") && failure.is_none() {
        return Ending::Stop;
    }
    if let Some(failure) = failure {
        return Ending::Failed(Box::new(failure));
    }
    if status == Some("failed") {
        let error = result.get("error");
        if error.and_then(|e| e["codexErrorInfo"].as_str()) == Some("contextWindowExceeded") {
            return Ending::Length;
        }
        return Ending::Failed(Box::new(turn_failure(error, limits)));
    }
    Ending::Quiet
}

fn completed(turn: &mut Turn, result: &Value, sink: &mut dyn AccountSink) -> Flow {
    let ending = ending_of(result, turn.failure.take(), turn.limits.as_ref());
    if !matches!(ending, Ending::Stop) {
        forget_thread(turn);
    }
    match ending {
        Ending::Stop => {
            let recorded = threads_for(&turn.instance, |threads| {
                threads.record(&turn.thread_id, &turn.messages)
            });
            sink.provider_state(&ProviderState {
                instance_id: turn.instance.clone(),
                state: recorded["state"].clone(),
            });
            sink.finish(FinishReason::Stop, turn.usage);
            Flow::Done(Ok(()))
        }
        Ending::Length => {
            sink.finish(FinishReason::Length, turn.usage);
            Flow::Done(Ok(()))
        }
        Ending::Failed(failure) => Flow::Done(Err(failure)),
        Ending::Quiet => Flow::Done(Ok(())),
    }
}

/// Codex's own requests: the answer Draggy gives, or None when Draggy gives none and refuses with an error.
fn built_in(method: &str) -> Option<Option<Value>> {
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            Some(Some(json!({ "decision": "decline" })))
        }
        "applyPatchApproval" | "execCommandApproval" => Some(Some(json!({ "decision": "denied" }))),
        "mcpServer/elicitation/request" => Some(Some(
            json!({ "action": "decline", "content": null, "_meta": null }),
        )),
        "item/permissions/requestApproval" | "item/tool/requestUserInput" => Some(None),
        _ => None,
    }
}

fn requested(
    turn: &mut Turn,
    id: Value,
    method: &str,
    params: &Value,
    sink: &mut dyn AccountSink,
) -> Flow {
    if method == "item/tool/call" {
        return tool_called(turn, id, params, sink);
    }
    if let Some(answer) = built_in(method) {
        turn.failure = Some(AccountFailure::from(ProviderError {
            kind: ErrorKind::UnknownError,
            status: Some(0),
            message: Some(format!(
                "Codex asked to use its own tool ({method}), which Draggy never offers."
            )),
            provider_message: None,
            retry_after: None,
        }));
        interrupt(turn);
        if let Some(answer) = answer {
            turn.client.rpc.answer(id, Ok(answer));
            return Flow::Go;
        }
    }
    turn.client.rpc.answer(
        id,
        Err((None, format!("{method} is not available in Draggy"))),
    );
    Flow::Go
}

fn tool_called(turn: &mut Turn, id: Value, params: &Value, sink: &mut dyn AccountSink) -> Flow {
    let call_id = params["callId"].as_str().unwrap_or_default().to_owned();
    sink.delta(Delta {
        tool_calls: vec![tool_delta(turn.calls_made, &call_id, params)],
        ..Default::default()
    });
    turn.calls_made += 1;
    turn.calls.push(Pending {
        call_id,
        request_id: id,
    });
    Flow::Called
}

/// The tool call delta for one request: its name, and its arguments as text.
fn tool_delta(index: u64, call_id: &str, params: &Value) -> Value {
    let arguments = match &params["arguments"] {
        Value::String(text) => text.clone(),
        Value::Null => "{}".to_owned(),
        other => other.to_string(),
    };
    json!({
        "index": index,
        "id": call_id,
        "type": "function",
        "function": { "name": params["tool"].as_str().unwrap_or_default(), "arguments": arguments },
    })
}

/// Asks Codex to stop the turn; best effort, since the process is killed with the turn anyway.
fn interrupt(turn: &mut Turn) {
    if let Some(turn_id) = turn.turn_id.clone() {
        let params = json!({ "threadId": turn.thread_id, "turnId": turn_id });
        let _ = turn.client.rpc.call("turn/interrupt", Some(params), None);
    }
}

/// Answers the tool calls a parked turn waits on with the results the request brings, or a note when none came.
async fn answer_pending(turn: &mut Turn, results: &[Value]) -> Result<(), Box<AccountFailure>> {
    turn.calls_made = 0;
    for pending in std::mem::take(&mut turn.calls) {
        let text = results
            .iter()
            .find(|m| m["tool_call_id"] == pending.call_id.as_str())
            .map(|m| text_of(&m["content"]));
        let answer = json!({
            "contentItems": [{ "type": "inputText", "text": text.clone().unwrap_or_else(|| NOT_RUN.to_owned()) }],
            "success": text.is_some(),
        });
        turn.client.rpc.answer(pending.request_id, Ok(answer));
    }
    turn.client.flush().await.map_err(|_| stopped())
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

fn stopped() -> Box<AccountFailure> {
    boxed(ErrorKind::AccountRuntimeUnavailable, STOPPED)
}

fn boxed(kind: ErrorKind, message: &str) -> Box<AccountFailure> {
    Box::new(AccountFailure::from(ProviderError {
        kind,
        status: Some(0),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(line: &str) -> Value {
        serde_json::from_str(line).expect("fixture")
    }

    #[test]
    fn message_deltas_map_to_text_and_reasoning_for_their_thread() {
        let text = fixture(r#"{"threadId":"t1","turnId":"u1","delta":"Hi"}"#);
        assert_eq!(
            streamed_of("item/agentMessage/delta", &text),
            Some(Streamed::Text("Hi".to_owned()))
        );
        let reasoning = fixture(r#"{"threadId":"t1","delta":"hmm","summaryIndex":0}"#);
        assert_eq!(
            streamed_of("item/reasoning/summaryTextDelta", &reasoning),
            Some(Streamed::Reasoning("hmm".to_owned()))
        );
        assert_eq!(streamed_of("item/started", &text), None);
        assert_eq!(
            streamed_of("item/agentMessage/delta", &fixture(r#"{"threadId":"t1"}"#)),
            None
        );
    }

    #[test]
    fn a_completed_turn_stops_and_a_failed_one_names_its_limit_and_reset() {
        let done = fixture(r#"{"status":"completed","error":null}"#);
        assert_eq!(ending_of(&done, None, None), Ending::Stop);

        let limits = fixture(r#"{"primary":{"usedPercent":100,"resetsAt":1800000000}}"#);
        let spent = fixture(
            r#"{"status":"failed","error":{"message":"Usage limit reached","codexErrorInfo":"usageLimitExceeded"}}"#,
        );
        match ending_of(&spent, None, Some(&limits)) {
            Ending::Failed(failure) => {
                assert_eq!(failure.failure.kind, ErrorKind::AccountLimitReached);
                assert_eq!(
                    failure.failure.message.as_deref(),
                    Some("Usage limit reached")
                );
                assert_eq!(failure.resets_at, Some(json!(1800000000)));
            }
            other => panic!("expected a limit failure, got {other:?}"),
        }

        let long = fixture(
            r#"{"status":"failed","error":{"message":"Too long","codexErrorInfo":"contextWindowExceeded"}}"#,
        );
        assert_eq!(ending_of(&long, None, None), Ending::Length);
        let stopped_turn = fixture(r#"{"status":"interrupted","error":null}"#);
        assert_eq!(ending_of(&stopped_turn, None, None), Ending::Quiet);
    }

    #[test]
    fn a_refused_built_in_request_fails_the_turn_even_when_the_turn_completes() {
        assert_eq!(
            built_in("item/fileChange/requestApproval"),
            Some(Some(json!({ "decision": "decline" })))
        );
        assert_eq!(built_in("item/permissions/requestApproval"), Some(None));
        assert_eq!(built_in("item/tool/call"), None);

        let stale = AccountFailure::from(ProviderError {
            kind: ErrorKind::UnknownError,
            status: Some(0),
            message: Some("refused".to_owned()),
            provider_message: None,
            retry_after: None,
        });
        let done = fixture(r#"{"status":"completed"}"#);
        match ending_of(&done, Some(stale), None) {
            Ending::Failed(failure) => assert_eq!(failure.failure.kind, ErrorKind::UnknownError),
            other => panic!("expected the refusal to fail the turn, got {other:?}"),
        }
    }

    #[test]
    fn tool_calls_keep_their_name_and_arguments_as_text() {
        let object = fixture(
            r#"{"threadId":"t1","callId":"call_9","tool":"mcp__draggy__read","arguments":{"path":"a.txt"}}"#,
        );
        let delta = tool_delta(0, "call_9", &object);
        assert_eq!(delta["function"]["name"], "mcp__draggy__read");
        assert_eq!(delta["function"]["arguments"], r#"{"path":"a.txt"}"#);
        assert_eq!(delta["type"], "function");
        let text = fixture(r#"{"callId":"c","tool":"x","arguments":"{\"a\":1}"}"#);
        assert_eq!(
            tool_delta(2, "c", &text)["function"]["arguments"],
            r#"{"a":1}"#
        );
        let bare = fixture(r#"{"callId":"c","tool":"x"}"#);
        assert_eq!(tool_delta(0, "c", &bare)["function"]["arguments"], "{}");
    }

    #[test]
    fn a_limit_update_keeps_the_windows_it_does_not_name() {
        let update = fixture(r#"{"secondary":{"usedPercent":9},"primary":null}"#);
        let limits = merged_limits(Some(json!({ "primary": { "usedPercent": 5 } })), &update);
        assert_eq!(limits["primary"]["usedPercent"], 5);
        assert_eq!(limits["secondary"]["usedPercent"], 9);
    }

    #[test]
    fn an_instances_threads_last_until_it_is_cleared() {
        let instance = "codex-test-threads-clear";
        threads_for(instance, |_| ());
        let held = |id: &str| {
            THREADS
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
                .is_some_and(|map| map.contains_key(id))
        };
        assert!(held(instance));
        clear_threads(instance);
        assert!(!held(instance));
    }
}
