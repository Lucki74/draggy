//! Agent turn loop, driven the way `src/__tests__/agentLoop.test.ts` drives `runAgentTurn`: scripted fake models,
//! tools, host and observer behind the traits, with a fixed clock and ids so every run is the same.

use std::cell::Cell;
use std::collections::{BTreeMap, VecDeque};

use draggy_agent::agent_loop::{
    AgentResult, ApprovalAnswer, ApprovalRequest, ChatRequest, ChunkStream, Clock, DraggyRef,
    Engine, FinalCounts, FixedContext, IdSource, InvokedSkill, MessageRefs, ModelChunk,
    ModelClient, ModelProfile, Permission, PlanItem, PlanStatus, Ports, PreparedTurn,
    ProviderState, RepairRequest, Retry, StreamingCall, TailNotes, ToolAccess, ToolCall,
    ToolContext, ToolRuntime, TurnError, TurnEvent, TurnHost, TurnObserver, TurnRequest,
    Unsendable, WireMessage, parse_plan, prepare_turn, run_turn, to_wire_message, unsendable_notes,
};
use draggy_agent::compaction::CompactionState;
use draggy_agent::effort::Effort;
use draggy_agent::permissions::{Grant, PermissionMode, ToolAnnotations};
use draggy_agent::prompts::{
    ProjectMemory, PromptEnvironment, PromptProfile, PromptSettings, PromptTool, WebMode,
    render_memory,
};
use draggy_agent::resume::SearchStep;
use draggy_agent::skills::{InstalledSkill, LoadedSkill, SkillReader};
use draggy_agent::task_manager::{CancelSignal, Message, Seed};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use serde_json::{Value, json};

const MODEL: &str = "test-model";

/// A clock that moves forward a fixed step on every read, so durations are positive and repeatable.
struct StepClock {
    now: Cell<f64>,
    step: f64,
}

impl StepClock {
    fn new(step: f64) -> Self {
        Self {
            now: Cell::new(1_000.0),
            step,
        }
    }
}

impl Clock for StepClock {
    fn now_ms(&self) -> f64 {
        let now = self.now.get() + self.step;
        self.now.set(now);
        now
    }
}

/// Step ids the way the renderer makes them: a counter, so a test can name a step before it exists.
#[derive(Default)]
struct Ids(u32);

impl IdSource for Ids {
    fn next_id(&mut self) -> String {
        self.0 += 1;
        format!("s{}", self.0)
    }
}

/// One scripted pass: its chunks, and optionally a stop the user makes after `stop.0` chunks have arrived.
#[derive(Default)]
struct Pass {
    chunks: Vec<Result<ModelChunk, TurnError>>,
    stop: Option<(usize, CancelSignal)>,
}

impl Pass {
    fn of(chunks: Vec<ModelChunk>) -> Self {
        Self {
            chunks: chunks.into_iter().map(Ok).collect(),
            stop: None,
        }
    }
}

/// Serves a pass chunk by chunk, and reads as stopped once the user's stop has landed.
struct PassStream {
    chunks: std::vec::IntoIter<Result<ModelChunk, TurnError>>,
    served: usize,
    stop: Option<(usize, CancelSignal)>,
}

impl Iterator for PassStream {
    type Item = Result<ModelChunk, TurnError>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some((after, cancel)) = &self.stop
            && self.served == *after
        {
            cancel.abort();
            return None;
        }
        self.served += 1;
        self.chunks.next()
    }
}

/// Scripted model: each pass takes the next script, and an exhausted script reads as an empty reply.
#[derive(Default)]
struct FakeModel {
    passes: VecDeque<Pass>,
    requests: Vec<ChatRequest>,
    repairs: VecDeque<Option<String>>,
    repair_requests: Vec<RepairRequest>,
}

impl FakeModel {
    fn with_passes(passes: Vec<Vec<ModelChunk>>) -> Self {
        Self {
            passes: passes.into_iter().map(Pass::of).collect(),
            ..Self::default()
        }
    }
}

impl ModelClient for FakeModel {
    fn stream(&mut self, request: ChatRequest) -> Result<ChunkStream, TurnError> {
        self.requests.push(request);
        let pass = self.passes.pop_front().unwrap_or_default();
        Ok(Box::new(PassStream {
            chunks: pass.chunks.into_iter(),
            served: 0,
            stop: pass.stop,
        }))
    }

    fn repair(&mut self, request: RepairRequest) -> Option<String> {
        self.repair_requests.push(request);
        self.repairs.pop_front().flatten()
    }
}

/// Engine stand-in: a fixed window, a loaded flag the test sets, and a record of what was asked of it.
struct FakeEngine {
    window: i64,
    loaded: Option<bool>,
    context_asks: Vec<(i64, Option<i64>, Option<FixedContext>)>,
    starts: Vec<(String, i64, bool)>,
    gpu: Option<f64>,
}

impl Default for FakeEngine {
    fn default() -> Self {
        Self {
            window: 4096,
            loaded: Some(true),
            context_asks: Vec::new(),
            starts: Vec::new(),
            gpu: None,
        }
    }
}

impl Engine for FakeEngine {
    fn context_size(
        &mut self,
        _model: &str,
        chars: i64,
        max_context: Option<i64>,
        fixed: Option<FixedContext>,
    ) -> i64 {
        self.context_asks.push((chars, max_context, fixed));
        match fixed {
            Some(FixedContext::Tokens(tokens)) => tokens,
            Some(FixedContext::Max) => max_context.unwrap_or(self.window),
            None => self.window,
        }
    }

    fn is_loaded_at(&mut self, _model: &str, _num_ctx: i64) -> Option<bool> {
        self.loaded
    }

    fn start(&mut self, model: &str, num_ctx: i64, exact: bool) -> Result<(), String> {
        self.starts.push((model.to_string(), num_ctx, exact));
        Ok(())
    }

    fn gpu_percent(&mut self, _model: &str) -> Option<f64> {
        self.gpu
    }
}

type ToolBody = Box<dyn FnMut(&Value, &mut ToolContext<'_>) -> String>;

/// Tool stand-in: annotations per name, a body per name, and a record of every call that ran.
#[derive(Default)]
struct FakeTools {
    annotations: BTreeMap<String, ToolAnnotations>,
    bodies: BTreeMap<String, ToolBody>,
    calls: Vec<(String, Value)>,
}

impl FakeTools {
    fn with_search() -> Self {
        let mut tools = Self::default();
        tools.bodies.insert(
            "search_web".to_string(),
            Box::new(|_args, ctx| {
                let id = ctx.new_id();
                ctx.steps.push(step(&id, "searching", "searching", true));
                "TOOL RESULT (search_web): Paris is the capital of France.".to_string()
            }),
        );
        tools
    }
}

impl ToolRuntime for FakeTools {
    fn annotations(&self, name: &str) -> ToolAnnotations {
        self.annotations.get(name).cloned().unwrap_or_default()
    }

    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        self.calls.push((name.to_string(), args.clone()));
        match self.bodies.get_mut(name) {
            Some(body) => body(args, ctx),
            None => format!(
                "TOOL ERROR: There is no tool called \"{name}\". Available tools: search_web."
            ),
        }
    }
}

/// Host stand-in: texts are their keys, approvals come from a queue, and grants and plans are recorded.
#[derive(Default)]
struct FakeHost {
    can_ask: bool,
    answers: VecDeque<Option<ApprovalAnswer>>,
    approvals: Vec<ApprovalRequest>,
    grants: Vec<Grant>,
    plan: Option<Vec<PlanItem>>,
    plans_sent: Vec<Vec<PlanItem>>,
    plan_reads: usize,
    /// The plan the user edits while the turn runs: it replaces the plan at this read of `get_plan`.
    edit_at_read: Option<(usize, Vec<PlanItem>)>,
}

impl TurnHost for FakeHost {
    fn text(&self, key: &str) -> String {
        key.to_string()
    }

    fn can_ask(&self) -> bool {
        self.can_ask
    }

    fn request_approval(&mut self, request: &ApprovalRequest) -> Option<ApprovalAnswer> {
        self.approvals.push(request.clone());
        self.answers.pop_front().flatten()
    }

    fn on_grant(&mut self, grant: &Grant) {
        self.grants.push(grant.clone());
    }

    fn get_plan(&mut self) -> Option<Vec<PlanItem>> {
        self.plan_reads += 1;
        if let Some((at, items)) = &self.edit_at_read
            && *at == self.plan_reads
        {
            self.plan = Some(items.clone());
        }
        self.plan.clone()
    }

    fn on_plan(&mut self, items: &[PlanItem]) {
        self.plan = Some(items.to_vec());
        self.plans_sent.push(items.to_vec());
    }
}

/// Observer stand-in that keeps every delivered batch, in order.
#[derive(Default)]
struct Recorder {
    batches: Vec<Vec<TurnEvent>>,
}

impl Recorder {
    fn events(&self) -> Vec<&TurnEvent> {
        self.batches.iter().flatten().collect()
    }

    fn last_patch(&self) -> Option<&draggy_agent::agent_loop::AgentPatch> {
        self.events()
            .into_iter()
            .rev()
            .find_map(|event| match event {
                TurnEvent::Patch(patch) => Some(patch),
                _ => None,
            })
    }

    /// Every step list the observer was handed, in order, from both snapshots and patches.
    fn step_lists(&self) -> Vec<Vec<SearchStep>> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                TurnEvent::Steps(steps) => Some(steps.clone()),
                TurnEvent::Patch(patch) => Some(patch.steps.clone()),
                _ => None,
            })
            .collect()
    }
}

impl TurnObserver for Recorder {
    fn on_events(&mut self, events: &[TurnEvent]) {
        self.batches.push(events.to_vec());
    }
}

/// Everything a test needs to run turns: the fakes, the cancel signal and the notes the conversation keeps.
struct Harness {
    model: FakeModel,
    engine: FakeEngine,
    tools: FakeTools,
    host: FakeHost,
    observer: Recorder,
    ids: Ids,
    clock: StepClock,
    cancel: CancelSignal,
    tail_notes: TailNotes,
    refs: FakeRefs,
    skills: FakeSkills,
}

impl Harness {
    fn new(model: FakeModel) -> Self {
        Self {
            model,
            engine: FakeEngine::default(),
            tools: FakeTools::with_search(),
            host: FakeHost {
                can_ask: true,
                ..FakeHost::default()
            },
            observer: Recorder::default(),
            ids: Ids::default(),
            clock: StepClock::new(10.0),
            cancel: CancelSignal::new(),
            tail_notes: TailNotes::default(),
            refs: FakeRefs,
            skills: FakeSkills::default(),
        }
    }

    fn run(&mut self, request: &TurnRequest) -> Result<AgentResult, TurnError> {
        let ports = Ports {
            model: &mut self.model,
            engine: &mut self.engine,
            tools: &mut self.tools,
            host: &mut self.host,
            observer: &mut self.observer,
            refs: &mut self.refs,
            skills: &mut self.skills,
            ids: &mut self.ids,
            clock: &self.clock,
            cancel: &self.cancel,
        };
        run_turn(request, &mut self.tail_notes, ports)
    }
}

fn step(id: &str, kind: &str, content: &str, complete: bool) -> SearchStep {
    SearchStep {
        id: Some(id.to_string()),
        kind: kind.to_string(),
        content: Some(content.to_string()),
        is_complete: Some(complete),
        ..SearchStep::default()
    }
}

fn text(piece: &str) -> ModelChunk {
    ModelChunk {
        content: piece.to_string(),
        ..ModelChunk::default()
    }
}

fn thinking(piece: &str) -> ModelChunk {
    ModelChunk {
        thinking: piece.to_string(),
        ..ModelChunk::default()
    }
}

/// The last chunk of a pass: counts as llama-server reports them for a 120-token prompt and 40 generated tokens.
fn finished(reason: &str) -> ModelChunk {
    ModelChunk {
        done: Some(FinalCounts {
            done_reason: Some(reason.to_string()),
            prompt_eval_count: 120.0,
            eval_count: 40.0,
            prompt_eval_duration_ns: 60_000_000.0,
            eval_duration_ns: 400_000_000.0,
            ..FinalCounts::default()
        }),
        ..ModelChunk::default()
    }
}

/// A pass that writes `pieces` and then finishes normally.
fn reply(pieces: &[&str]) -> Vec<ModelChunk> {
    let mut chunks: Vec<ModelChunk> = pieces.iter().map(|piece| text(piece)).collect();
    chunks.push(finished("stop"));
    chunks
}

/// A pass that asks for one native tool call and finishes with the tool-call reason.
fn native_call(name: &str, args: Value) -> Vec<ModelChunk> {
    vec![
        ModelChunk {
            tool_calls: vec![ToolCall {
                id: Some("call_0".to_string()),
                name: name.to_string(),
                arguments: args,
            }],
            ..ModelChunk::default()
        },
        finished("tool_calls"),
    ]
}

fn user(content: &str) -> Message {
    message("u1", "user", content)
}

fn assistant(content: &str) -> Message {
    message("a1", "assistant", content)
}

fn message(id: &str, role: &str, content: &str) -> Message {
    Message {
        id: id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        attachments: None,
        versions: None,
        current_version_index: None,
        steps: None,
        text_content: None,
        thinking_content: None,
        thought_time: None,
        metrics: None,
        provider_state: None,
        fold: None,
        failed: None,
        extra: serde_json::Map::new(),
    }
}

fn settings() -> PromptSettings {
    PromptSettings {
        effort: Effort::Medium,
        allow_max_in_chat: false,
        web_mode: WebMode::Auto,
        custom_instructions: Vec::new(),
    }
}

fn environment() -> PromptEnvironment {
    PromptEnvironment {
        has_folder: false,
        project_root: None,
        code_execution: true,
        library_ready: true,
        has_skills: true,
    }
}

fn search_definition() -> ToolDefinition {
    ToolDefinition {
        kind: "function".to_string(),
        function: FunctionDefinition {
            name: "search_web".to_string(),
            description: "Search the web.".to_string(),
            parameters: json!({"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
        },
    }
}

/// A native-tool model with thinking, the common case in the tests.
fn profile(access: ToolAccess) -> ModelProfile {
    ModelProfile {
        model: MODEL.to_string(),
        tool_access: access,
        probed: true,
        has_thinking: false,
        thinking_allowed: true,
        native_vision: false,
        prompt_profile: PromptProfile::Compact,
        loop_limit: 75,
        max_context: None,
        fixed_context: None,
    }
}

fn request(messages: Vec<Message>) -> TurnRequest {
    TurnRequest {
        profile: profile(ToolAccess::Text),
        workspace_id: "default".to_string(),
        settings: settings(),
        environment: environment(),
        tools: Vec::new(),
        prompt_tools: Vec::new(),
        memory: None,
        skills: Vec::new(),
        date: "Wednesday, October 14, 2026".to_string(),
        now: "12:00".to_string(),
        messages,
        is_continuation: false,
        seed: None,
        compaction: None,
        permission: None,
        context_base: None,
    }
}

/// The same request, with the search tool offered natively.
fn native_request(messages: Vec<Message>) -> TurnRequest {
    let mut turn = request(messages);
    turn.profile = profile(ToolAccess::Native);
    turn.tools = vec![search_definition()];
    turn
}

fn run_ok(harness: &mut Harness, turn: &TurnRequest) -> AgentResult {
    match harness.run(turn) {
        Ok(result) => result,
        Err(error) => panic!("turn failed: {error}"),
    }
}

fn system_text(request: &ChatRequest) -> &str {
    request
        .messages
        .first()
        .map_or("", |message| message.content.as_str())
}

fn last_message(request: &ChatRequest) -> &WireMessage {
    request
        .messages
        .last()
        .unwrap_or_else(|| panic!("the request carried no messages"))
}

fn metrics_events(observer: &Recorder) -> Vec<draggy_agent::agent_loop::GenerationMetrics> {
    observer
        .events()
        .into_iter()
        .filter_map(|event| match event {
            TurnEvent::Metrics(metrics) => Some(metrics.clone()),
            _ => None,
        })
        .collect()
}

// -- a plain answer with no tools --------------------------------------------------------------------------------

#[test]
fn a_plain_answer_streams_the_reply_through_to_the_host() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        "Hello", " there", "!",
    ])]));
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    assert_eq!(result.text_content, "Hello there!");
    assert_eq!(result.loops, 1);
    assert!(h.observer.last_patch().is_some());
}

#[test]
fn a_plain_answer_reports_metrics_for_the_turn() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    h.engine.gpu = Some(0.0);
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    let metrics = result.metrics.clone().unwrap_or_default();
    assert_eq!(metrics.response_tokens, 40.0);
    assert!((metrics.tokens_per_second - 100.0).abs() < 1e-9);
    assert_eq!(
        metrics_events(&h.observer)
            .last()
            .and_then(|m| m.gpu_percent),
        Some(0.0)
    );
}

#[test]
fn a_plain_answer_sends_a_system_prompt_and_the_conversation() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &request(vec![user("what is 2+2")]));

    let sent = &h.model.requests[0];
    assert_eq!(sent.messages[0].role, "system");
    assert!(system_text(sent).contains("Draggy"));
    // The clock is appended to the last user message rather than sent in the system prompt.
    assert!(sent.messages[1].content.contains("what is 2+2"));
}

#[test]
fn the_system_prompt_does_not_carry_a_changing_clock() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &request(vec![user("hello")]));

    assert!(!has_clock_time(system_text(&h.model.requests[0])));
}

/// Whether the text holds a `H:MM:SS` or `HH:MM:SS` time, the shape of a changing clock.
fn has_clock_time(text: &str) -> bool {
    let bytes = text.as_bytes();
    (0..bytes.len()).any(|start| {
        let digits = |range: std::ops::Range<usize>| {
            range
                .clone()
                .all(|i| bytes.get(i).is_some_and(u8::is_ascii_digit))
        };
        let at = |i: usize| bytes.get(i) == Some(&b':');
        let two_colon = |s: usize| {
            digits(s..s + 2)
                && at(s + 2)
                && digits(s + 3..s + 5)
                && at(s + 5)
                && digits(s + 6..s + 8)
        };
        let one = start + 1 < bytes.len()
            && digits(start..start + 1)
            && at(start + 1)
            && digits(start + 2..start + 4)
            && at(start + 4)
            && digits(start + 5..start + 7);
        two_colon(start) || one
    })
}

fn text_request(messages: Vec<Message>) -> TurnRequest {
    let mut turn = request(messages);
    turn.tools = vec![search_definition()];
    turn.prompt_tools = vec![PromptTool {
        name: "search_web".to_string(),
        group: "web".to_string(),
        usage: "{\"query\": \"...\"} → results".to_string(),
        required: vec!["query".to_string()],
    }];
    turn
}

fn call(name: &str, args: Value) -> ModelChunk {
    ModelChunk {
        tool_calls: vec![ToolCall {
            id: Some("call_0".to_string()),
            name: name.to_string(),
            arguments: args,
        }],
        ..ModelChunk::default()
    }
}

// -- native tool calling -----------------------------------------------------------------------------------------

#[test]
fn native_tool_calling_runs_the_tool_and_asks_the_model_again() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "capital of France"})),
        reply(&["Paris."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("capital of France?")]));

    assert_eq!(
        h.tools.calls,
        vec![(
            "search_web".to_string(),
            json!({"query": "capital of France"})
        )]
    );
    assert!(result.text_content.contains("Paris."));
    assert_eq!(result.loops, 2);
    assert_eq!(h.model.requests.len(), 2);
}

#[test]
fn native_tool_calling_feeds_the_tool_result_back_as_a_tool_message() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "x"})),
        reply(&["done"]),
    ]));
    run_ok(&mut h, &native_request(vec![user("q")]));

    let second = &h.model.requests[1];
    let tool = second
        .messages
        .iter()
        .find(|message| message.role == "tool");
    assert_eq!(
        tool.and_then(|m| m.tool_name.as_deref()),
        Some("search_web")
    );
    assert!(tool.is_some_and(|m| m.content.contains("Paris is the capital")));
}

#[test]
fn native_tool_calling_sends_tool_schemas_when_the_model_advertises_the_capability() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &native_request(vec![user("hi")]));

    let names: Vec<&str> = h.model.requests[0]
        .tools
        .iter()
        .flatten()
        .map(|tool| tool.function.name.as_str())
        .collect();
    assert_eq!(names, vec!["search_web"]);
}

#[test]
fn native_tool_calling_records_a_step_for_the_tool_it_ran() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "x"})),
        reply(&["done"]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("q")]));

    assert!(result.steps.iter().any(|step| step.kind == "searching"));
}

#[test]
fn native_tool_calling_counts_each_tool_the_turn_reached_for() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "x"})),
        native_call("search_web", json!({"query": "y"})),
        reply(&["done"]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("q")]));

    assert_eq!(
        result.tool_calls,
        BTreeMap::from([("search_web".to_string(), 2)])
    );
}

#[test]
fn native_tool_calling_adds_up_metrics_across_both_requests() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "x"})),
        reply(&["done"]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("q")]));

    assert_eq!(
        result.metrics.map(|metrics| metrics.response_tokens),
        Some(80.0)
    );
}

#[test]
fn native_tool_calling_tells_the_model_when_it_asks_for_a_tool_that_does_not_exist() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("teleport", json!({})),
        reply(&["sorry"]),
    ]));
    run_ok(&mut h, &native_request(vec![user("q")]));

    let second = &h.model.requests[1];
    let tool = second
        .messages
        .iter()
        .find(|message| message.role == "tool");
    assert!(tool.is_some_and(|m| m.content.contains("no tool called")));
}

// -- text-mode tool calling --------------------------------------------------------------------------------------

#[test]
fn text_mode_recovers_a_tool_call_from_plain_text_and_hides_it_from_the_user() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&[
            "Let me look.\n<tool>{\"name\": \"search_web\", \"args\": {\"query\": \"france\"}}</tool>",
        ]),
        reply(&["Paris."]),
    ]));
    let result = run_ok(&mut h, &text_request(vec![user("capital?")]));

    assert_eq!(h.tools.calls.len(), 1);
    assert!(!result.text_content.contains("\"name\""));
    assert!(result.text_content.contains("Paris."));
}

#[test]
fn text_mode_feeds_the_result_back_as_a_user_message_for_models_without_tool_roles() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&["<tool>{\"name\": \"search_web\", \"args\": {\"query\": \"x\"}}</tool>"]),
        reply(&["done"]),
    ]));
    run_ok(&mut h, &text_request(vec![user("q")]));

    let last = last_message(&h.model.requests[1]);
    assert_eq!(last.role, "user");
    assert!(last.content.contains("TOOL RESULT"));
}

#[test]
fn text_mode_strips_reasoning_tags_from_the_visible_answer() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        "<think>hmm</think>",
        "The answer is 4.",
    ])]));
    let result = run_ok(&mut h, &request(vec![user("2+2")]));

    assert_eq!(result.text_content, "The answer is 4.");
    assert!(!result.text_content.contains("<think>"));
}

#[test]
fn text_mode_keeps_the_reasoning_as_a_thinking_step() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        "<think>working it out</think>",
        "Four.",
    ])]));
    let result = run_ok(&mut h, &request(vec![user("2+2")]));
    let thinking = result.steps.iter().find(|step| step.kind == "thinking");

    assert!(
        thinking
            .and_then(|step| step.content.as_deref())
            .is_some_and(|c| c.contains("working it out"))
    );
    assert_eq!(thinking.and_then(|step| step.is_complete), Some(true));
}

fn native_thinking_request(messages: Vec<Message>, mode: Effort) -> TurnRequest {
    let mut turn = native_request(messages);
    turn.profile.has_thinking = true;
    turn.settings.effort = mode;
    turn
}

fn system_of(request: &ChatRequest) -> String {
    system_text(request).to_string()
}

// -- native thinking models --------------------------------------------------------------------------------------

#[test]
fn native_thinking_asks_for_thinking_and_keeps_it_out_of_the_answer() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        thinking("let me see"),
        text("Four."),
        finished("stop"),
    ]]));
    let turn = native_thinking_request(vec![user("2+2")], Effort::Medium);
    let result = run_ok(&mut h, &turn);

    assert_eq!(h.model.requests[0].think, Some(true));
    assert_eq!(result.text_content, "Four.");
    let thinking_step = result.steps.iter().find(|step| step.kind == "thinking");
    assert!(
        thinking_step
            .and_then(|step| step.content.as_deref())
            .is_some_and(|c| c.contains("let me see"))
    );
}

#[test]
fn native_thinking_drops_an_empty_thinking_step_rather_than_showing_a_blank_panel() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let turn = native_thinking_request(vec![user("2+2")], Effort::Medium);
    let result = run_ok(&mut h, &turn);

    assert_eq!(
        result
            .steps
            .iter()
            .filter(|step| step.kind == "thinking")
            .count(),
        0
    );
}

#[test]
fn a_model_that_cannot_think_is_sent_no_thinking_option_at_all() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    run_ok(&mut h, &native_request(vec![user("2+2")]));

    assert_eq!(h.model.requests[0].think, None);
    assert_eq!(h.model.requests[0].thinking_level, None);
}

#[test]
fn fast_mode_tells_a_native_capable_model_not_to_think_explicitly() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    run_ok(
        &mut h,
        &native_thinking_request(vec![user("2+2")], Effort::Off),
    );

    assert_eq!(h.model.requests[0].think, Some(false));
    assert!(!system_of(&h.model.requests[0]).contains("CRITICAL REASONING INSTRUCTION"));
}

#[test]
fn fast_mode_asks_a_non_native_model_for_the_answer_rather_than_saying_nothing() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut turn = request(vec![user("2+2")]);
    turn.settings.effort = Effort::Off;
    run_ok(&mut h, &turn);

    let system = system_of(&h.model.requests[0]);
    assert_eq!(h.model.requests[0].think, None);
    assert!(!system.contains("CRITICAL REASONING INSTRUCTION"));
    assert!(!system.contains("You MUST use <think>"));
    assert!(system.contains("Answer immediately"));
}

#[test]
fn fast_mode_tells_a_native_capable_model_to_skip_the_scratchpad_as_well() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    run_ok(
        &mut h,
        &native_thinking_request(vec![user("2+2")], Effort::Off),
    );

    assert!(system_of(&h.model.requests[0]).contains("Answer immediately"));
}

#[test]
fn fast_mode_still_asks_a_native_capable_model_to_think_in_the_other_modes() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    run_ok(
        &mut h,
        &native_thinking_request(vec![user("2+2")], Effort::Medium),
    );

    assert_eq!(h.model.requests[0].think, Some(true));
}

// -- keeping the model loaded (the engine owns windows; the loop asks it and sends what it says) ----------------

#[test]
fn the_turn_asks_for_the_window_the_warm_up_already_loaded() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    h.engine.window = 8192;
    run_ok(&mut h, &request(vec![user("hi")]));

    assert_eq!(h.engine.starts, vec![(MODEL.to_string(), 8192, false)]);
    assert_eq!(h.model.requests[0].num_ctx, 8192);
}

#[test]
fn the_window_asked_for_fits_a_long_conversation_and_is_sent_with_the_request() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    h.engine.window = 16384;
    run_ok(&mut h, &request(vec![user(&"x".repeat(60000))]));

    let (chars, _, _) = h.engine.context_asks[0];
    assert!(chars >= 60000);
    assert_eq!(h.model.requests[0].num_ctx, 16384);
}

#[test]
fn a_fixed_numeric_context_size_locks_the_window_and_starts_exactly() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let mut turn = request(vec![user("hi")]);
    turn.profile.fixed_context = Some(FixedContext::Tokens(16384));
    run_ok(&mut h, &turn);

    assert_eq!(h.engine.starts, vec![(MODEL.to_string(), 16384, true)]);
    assert_eq!(h.model.requests[0].num_ctx, 16384);
}

#[test]
fn a_max_context_size_locks_the_window_to_the_model_maximum() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let mut turn = request(vec![user("hi")]);
    turn.profile.fixed_context = Some(FixedContext::Max);
    turn.profile.max_context = Some(32768);
    run_ok(&mut h, &turn);

    assert_eq!(h.engine.starts, vec![(MODEL.to_string(), 32768, false)]);
    assert_eq!(h.model.requests[0].num_ctx, 32768);
}

// -- stopping ----------------------------------------------------------------------------------------------------

#[test]
fn stopping_reports_an_aborted_turn() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["partial"])]));
    h.cancel.abort();
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    assert!(result.aborted);
}

// -- web access turned off ---------------------------------------------------------------------------------------

#[test]
fn web_access_turned_off_offers_no_browsing_tools_to_the_model() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let mut turn = native_request(vec![user("hi")]);
    turn.tools = Vec::new();
    turn.settings.web_mode = WebMode::Off;
    run_ok(&mut h, &turn);

    assert_eq!(h.model.requests[0].tools, Some(Vec::new()));
}

// -- continuing a truncated answer -------------------------------------------------------------------------------

#[test]
fn continuing_a_truncated_answer_keeps_the_earlier_text_and_appends_to_it() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        " and then it ended.",
    ])]));
    let mut turn = request(vec![user("tell me a story")]);
    turn.is_continuation = true;
    turn.seed = Some(Seed {
        content: "Once upon a time".to_string(),
        text_content: "Once upon a time".to_string(),
        steps: Vec::new(),
    });
    let result = run_ok(&mut h, &turn);

    assert!(result.text_content.contains("Once upon a time"));
    assert!(result.text_content.contains("and then it ended."));
}

// -- putting attachments on the wire (pure: the same cases as toWireMessage in the fixtures) --------------------

fn image_message(content: &str, name: &str, kind: &str) -> Message {
    let mut message = user("look at this");
    message.id = "u1".to_string();
    message.attachments = Some(vec![draggy_agent::task_manager::Attachment {
        name: name.to_string(),
        kind: kind.to_string(),
        content: content.to_string(),
    }]);
    message
}

const REAL_JPEG: &str = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD";

#[test]
fn attachments_strip_the_data_url_prefix_and_send_only_base64() {
    let wire = to_wire_message(
        &image_message(REAL_JPEG, "photo.jpg", "image/jpeg"),
        true,
        false,
    );

    assert_eq!(wire.images, vec!["/9j/4AAQSkZJRgABAQEAYABgAAD".to_string()]);
}

#[test]
fn attachments_keep_base64_that_arrives_without_a_prefix() {
    let wire = to_wire_message(
        &image_message("/9j/4AAQSkZJRg", "photo.jpg", "image/jpeg"),
        true,
        false,
    );

    assert_eq!(wire.images, vec!["/9j/4AAQSkZJRg".to_string()]);
}

#[test]
fn attachments_do_not_truncate_base64_containing_padding_or_slashes() {
    let wire = to_wire_message(
        &image_message("data:image/png;base64,a/b+c/d==", "photo.png", "image/png"),
        true,
        false,
    );

    assert_eq!(wire.images, vec!["a/b+c/d==".to_string()]);
}

#[test]
fn attachments_never_send_an_empty_image_and_say_it_could_not_be_read() {
    let wire = to_wire_message(
        &image_message("data:image/jpeg;base64,", "photo.jpg", "image/jpeg"),
        true,
        false,
    );

    assert!(wire.images.is_empty());
    assert!(wire.content.contains("could not be read"));
}

#[test]
fn attachments_never_send_a_whitespace_only_image() {
    let wire = to_wire_message(
        &image_message("data:image/jpeg;base64,   \n  ", "photo.jpg", "image/jpeg"),
        true,
        false,
    );

    assert!(wire.images.is_empty());
    assert!(wire.content.contains("could not be read"));
}

#[test]
fn attachments_never_send_a_completely_empty_attachment() {
    let wire = to_wire_message(&image_message("", "photo.jpg", "image/jpeg"), true, false);

    assert!(wire.images.is_empty());
}

#[test]
fn attachments_still_explain_the_limitation_when_the_model_has_no_vision() {
    let wire = to_wire_message(
        &image_message(REAL_JPEG, "photo.jpg", "image/jpeg"),
        false,
        false,
    );

    assert!(wire.images.is_empty());
    assert!(wire.content.contains("cannot read images"));
}

#[test]
fn attachments_send_several_images_in_order() {
    let mut message = user("two");
    message.attachments = Some(vec![
        attachment("a.jpg", "image/jpeg", "data:image/jpeg;base64,AAA"),
        attachment("b.png", "image/png", "data:image/png;base64,BBB"),
    ]);
    let wire = to_wire_message(&message, true, false);

    assert_eq!(wire.images, vec!["AAA".to_string(), "BBB".to_string()]);
}

#[test]
fn attachments_drop_only_the_broken_image_and_keep_the_good_one() {
    let mut message = user("two");
    message.attachments = Some(vec![
        attachment("broken.jpg", "image/jpeg", "data:image/jpeg;base64,"),
        attachment("good.png", "image/png", "data:image/png;base64,BBB"),
    ]);
    let wire = to_wire_message(&message, true, false);

    assert_eq!(wire.images, vec!["BBB".to_string()]);
    assert!(wire.content.contains("broken.jpg"));
}

#[test]
fn attachments_recognise_an_image_by_extension_when_the_type_is_missing() {
    let mut message = user("x");
    message.attachments = Some(vec![attachment(
        "shot.png",
        "",
        "data:image/png;base64,CCC",
    )]);
    let wire = to_wire_message(&message, true, false);

    assert_eq!(wire.images, vec!["CCC".to_string()]);
}

fn attachment(name: &str, kind: &str, content: &str) -> draggy_agent::task_manager::Attachment {
    draggy_agent::task_manager::Attachment {
        name: name.to_string(),
        kind: kind.to_string(),
        content: content.to_string(),
    }
}

// -- sending earlier reasoning back ------------------------------------------------------------------------------

fn thought(content: &str) -> SearchStep {
    SearchStep {
        id: Some(content.to_string()),
        kind: "thinking".to_string(),
        content: Some(content.to_string()),
        is_complete: Some(true),
        ..SearchStep::default()
    }
}

fn reasoned_reply() -> Message {
    let mut message = assistant("156.");
    message.id = "a1".to_string();
    message.steps = Some(vec![
        thought("12 times 13 is 156."),
        step("s", "searching", "searching", true),
        thought("  "),
        thought("Checked: 13 times 12 is 156 too."),
    ]);
    message
}

#[test]
fn reasoning_is_kept_on_every_pass_when_asked() {
    let wire = to_wire_message(&reasoned_reply(), false, true);

    assert_eq!(
        wire.thinking.as_deref(),
        Some("12 times 13 is 156.\n\nChecked: 13 times 12 is 156 too.")
    );
}

#[test]
fn reasoning_is_left_out_otherwise_and_never_put_on_a_user_message() {
    assert_eq!(
        to_wire_message(&reasoned_reply(), false, false).thinking,
        None
    );
    assert_eq!(to_wire_message(&user("hi"), false, true).thinking, None);
}

#[test]
fn reasoning_goes_back_with_the_history_to_a_model_that_reasons_natively() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let mut turn = native_thinking_request(
        vec![
            user("what is 12 * 13"),
            reasoned_reply(),
            user("and 14 * 13"),
        ],
        Effort::Medium,
    );
    turn.profile.has_thinking = true;
    run_ok(&mut h, &turn);

    let sent = h.model.requests[0]
        .messages
        .iter()
        .find(|m| m.role == "assistant");
    assert!(
        sent.and_then(|m| m.thinking.as_deref())
            .is_some_and(|t| t.contains("12 times 13 is 156."))
    );
}

#[test]
fn reasoning_is_not_sent_for_a_model_that_has_no_thinking_of_its_own() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(
        &mut h,
        &native_request(vec![
            user("what is 12 * 13"),
            reasoned_reply(),
            user("and 14 * 13"),
        ]),
    );

    assert!(
        h.model.requests[0]
            .messages
            .iter()
            .all(|m| m.thinking.is_none())
    );
}

#[test]
fn reasoning_behind_a_tool_call_is_kept_for_the_pass_after_it() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        vec![
            thinking("I should look this up."),
            call("search_web", json!({"query": "paris"})),
            finished("tool_calls"),
        ],
        reply(&["Paris."]),
    ]));
    let mut turn = native_request(vec![user("capital of France?")]);
    turn.profile.has_thinking = true;
    turn.settings.effort = Effort::Medium;
    run_ok(&mut h, &turn);

    let call_message = h.model.requests[1]
        .messages
        .iter()
        .find(|m| !m.tool_calls.is_empty());
    assert_eq!(
        call_message.and_then(|m| m.thinking.as_deref()),
        Some("I should look this up.")
    );
}

// -- keeping prose where the model wrote it ----------------------------------------------------------------------

fn text_steps(result: &AgentResult) -> Vec<Option<String>> {
    result
        .steps
        .iter()
        .filter(|s| s.kind == "text")
        .map(|s| s.content.clone())
        .collect()
}

fn tool_pass(pieces: &[&str]) -> Vec<ModelChunk> {
    let mut chunks: Vec<ModelChunk> = pieces.iter().map(|piece| text(piece)).collect();
    chunks.push(call("search_web", json!({"query": "paris"})));
    chunks.push(finished("tool_calls"));
    chunks
}

#[test]
fn text_written_before_a_tool_call_stays_in_the_timeline_not_at_the_end() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&["Let me look ", "that up."]),
        reply(&["Paris is the capital of France."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("capital of france?")]));

    assert_eq!(
        text_steps(&result),
        vec![Some("Let me look that up.".to_string())]
    );
    // The preamble must not be glued onto the front of the answer.
    assert_eq!(result.text_content, "Paris is the capital of France.");
}

#[test]
fn the_preamble_is_ordered_before_the_tool_it_introduces() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&["Searching now."]),
        reply(&["Done."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("hi")]));

    let order: Vec<&str> = result
        .steps
        .iter()
        .filter(|s| s.kind == "text" || s.kind == "searching")
        .map(|s| s.kind.as_str())
        .collect();
    assert_eq!(order, vec!["text", "searching"]);
}

#[test]
fn each_round_of_prose_stays_separate_across_several_tool_calls() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&["First I will check."]),
        tool_pass(&["Now the other one."]),
        reply(&["Here is the answer."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("hi")]));

    assert_eq!(
        text_steps(&result),
        vec![
            Some("First I will check.".to_string()),
            Some("Now the other one.".to_string())
        ]
    );
    assert_eq!(result.text_content, "Here is the answer.");
}

#[test]
fn no_text_step_is_added_when_the_model_goes_straight_to_the_tool() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&[]),
        reply(&["Answer."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("hi")]));

    assert!(text_steps(&result).is_empty());
    assert_eq!(result.text_content, "Answer.");
}

#[test]
fn the_final_answer_is_not_duplicated_in_the_timeline() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&["One moment."]),
        reply(&["The answer is four."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("hi")]));

    assert!(!result.steps.iter().any(|s| {
        s.content
            .as_deref()
            .is_some_and(|c| c.contains("The answer is four."))
    }));
}

#[test]
fn prose_streams_into_the_timeline_rather_than_into_the_reply_body() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        tool_pass(&["Thinking out loud."]),
        reply(&["Final."]),
    ]));
    run_ok(&mut h, &native_request(vec![user("hi")]));

    // Before the last pass, the body stays empty: everything visible is a step.
    assert!(!h.observer.events().iter().any(|event| matches!(event,
        TurnEvent::Patch(patch) if patch.text_content == "Thinking out loud.")));
}

#[test]
fn a_model_that_writes_its_tool_calls_as_text_gets_the_same_placement() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&[
            "Let me search for that.\n",
            "<tool>{\"name\": \"search_web\", \"args\": {\"query\": \"paris\"}}</tool>",
        ]),
        reply(&["Paris."]),
    ]));
    let result = run_ok(&mut h, &text_request(vec![user("hi")]));

    assert_eq!(
        text_steps(&result),
        vec![Some("Let me search for that.".to_string())]
    );
    assert_eq!(result.text_content, "Paris.");
}

#[test]
fn what_was_written_is_kept_when_the_user_stops_the_reply() {
    let mut h = Harness::new(FakeModel::default());
    h.model.passes.push_back(Pass {
        chunks: vec![
            Ok(text("Half a thought")),
            Ok(text(" and more")),
            Ok(finished("stop")),
        ],
        stop: Some((1, h.cancel.clone())),
    });
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    assert!(result.text_content.contains("Half a thought"));
    assert!(result.aborted);
}

#[test]
fn a_reply_stopped_mid_stream_is_saved_as_the_reply_for_the_next_turns_history() {
    // The saved text is the last snapshot taken at the 50 ms throttle, so the stream runs past a few ticks first.
    let counting: Vec<ModelChunk> = (1..=40).map(|n| text(&format!("{n}, "))).collect();
    let mut h = Harness::new(FakeModel::default());
    h.model.passes.push_back(Pass {
        chunks: counting.into_iter().map(Ok).collect(),
        stop: Some((12, h.cancel.clone())),
    });
    let result = run_ok(&mut h, &request(vec![user("Count to five hundred")]));

    assert!(result.text_content.starts_with("1, 2, "));
    assert!(result.content.starts_with("1, 2, "));
    let saved = h
        .observer
        .last_patch()
        .map(|patch| (patch.content.clone(), patch.text_content.clone()));
    assert_eq!(
        saved,
        Some((result.content.clone(), result.text_content.clone()))
    );
    assert!(text_steps(&result).is_empty());
    let next_turn = to_wire_message(&assistant(&result.content), false, false);
    assert!(next_turn.content.starts_with("1, 2, "));
}

// -- carrying on a reply that was cut short ----------------------------------------------------------------------

fn partial_reply() -> Message {
    let mut message = assistant("I have started the report");
    message.text_content = Some("I have started the report".to_string());
    message
}

fn continuation(steps: Vec<SearchStep>) -> TurnRequest {
    let mut turn = native_request(vec![user("write me a report"), partial_reply()]);
    turn.is_continuation = true;
    turn.seed = Some(Seed {
        content: "I have started the report".to_string(),
        text_content: "I have started the report".to_string(),
        steps,
    });
    turn
}

fn wire_text(request: &ChatRequest) -> String {
    request
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn created_file_step() -> SearchStep {
    SearchStep {
        id: Some("s1".to_string()),
        kind: "create_file".to_string(),
        content: Some("Created **report.docx**".to_string()),
        filename: Some("report.docx".to_string()),
        filepath: Some("C:/out/report.docx".to_string()),
        is_complete: Some(true),
        ..SearchStep::default()
    }
}

#[test]
fn continuation_tells_the_model_about_a_file_it_already_wrote() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    run_ok(&mut h, &continuation(vec![created_file_step()]));

    let sent = wire_text(&h.model.requests[0]);
    assert!(sent.contains("report.docx"));
    assert!(sent.contains("C:/out/report.docx"));
    assert!(sent.contains("do not create it again"));
}

#[test]
fn continuation_tells_the_model_about_code_it_already_ran_and_its_output() {
    let code = SearchStep {
        id: Some("s1".to_string()),
        kind: "run_code".to_string(),
        content: Some("Code ran".to_string()),
        language: Some("python".to_string()),
        stdout: Some("788454".to_string()),
        is_complete: Some(true),
        ..SearchStep::default()
    };
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    run_ok(&mut h, &continuation(vec![code]));

    let sent = wire_text(&h.model.requests[0]);
    assert!(sent.contains("788454"));
    assert!(sent.contains("Do not run it again"));
}

#[test]
fn continuation_carries_the_reasoning_across() {
    let planned = SearchStep {
        id: Some("s1".to_string()),
        kind: "thinking".to_string(),
        content: Some("I planned three sections before writing.".to_string()),
        is_complete: Some(true),
        ..SearchStep::default()
    };
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    run_ok(&mut h, &continuation(vec![planned]));

    assert!(wire_text(&h.model.requests[0]).contains("three sections"));
}

#[test]
fn continuation_still_asks_the_model_to_carry_on_rather_than_restart() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    run_ok(&mut h, &continuation(Vec::new()));

    let sent = wire_text(&h.model.requests[0]);
    assert!(sent.contains("Carry straight on from the exact character it stopped at"));
    assert!(sent.contains("no repeating work you already finished"));
}

#[test]
fn continuation_adds_nothing_about_past_work_when_there_was_none() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    run_ok(&mut h, &continuation(Vec::new()));

    assert!(!wire_text(&h.model.requests[0]).contains("already done"));
}

#[test]
fn continuation_keeps_what_was_already_written_in_the_finished_reply() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[" and finished it."])]));
    let result = run_ok(&mut h, &continuation(Vec::new()));

    assert!(result.text_content.contains("I have started the report"));
    assert!(result.text_content.contains("and finished it."));
}

#[test]
fn an_ordinary_turn_says_nothing_about_a_cut_short_reply() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hello."])]));
    run_ok(&mut h, &native_request(vec![user("hi there, how are you")]));

    assert!(!wire_text(&h.model.requests[0]).contains("cut short"));
}

// -- picking up at the exact word it stopped ---------------------------------------------------------------------

const CUT_OFF: &str = "The sea is a vast expanse of salt";

fn seam_turn() -> TurnRequest {
    let mut cut = assistant(CUT_OFF);
    cut.text_content = Some(CUT_OFF.to_string());
    let mut turn = native_request(vec![user("tell me about the sea"), cut]);
    turn.is_continuation = true;
    turn.seed = Some(Seed {
        content: CUT_OFF.to_string(),
        text_content: CUT_OFF.to_string(),
        steps: Vec::new(),
    });
    turn
}

fn seam_harness(pieces: &[&str]) -> Harness {
    Harness::new(FakeModel::with_passes(vec![reply(pieces)]))
}

#[test]
fn the_conversation_ends_with_the_half_written_reply() {
    let mut h = seam_harness(&["water."]);
    run_ok(&mut h, &seam_turn());

    let sent = &h.model.requests[0].messages;
    let last = sent.last();
    // A model completes a trailing assistant message but starts afresh after a user one.
    assert_eq!(last.map(|m| m.role.as_str()), Some("assistant"));
    assert_eq!(last.map(|m| m.content.as_str()), Some(CUT_OFF));
}

#[test]
fn the_half_written_reply_is_not_left_in_the_middle_as_well() {
    let mut h = seam_harness(&["water."]);
    run_ok(&mut h, &seam_turn());

    let copies = h.model.requests[0]
        .messages
        .iter()
        .filter(|m| m.content == CUT_OFF)
        .count();
    assert_eq!(copies, 1);
}

#[test]
fn a_word_split_in_half_is_completed() {
    let mut h = seam_harness(&["water", " covers most of the Earth."]);
    let result = run_ok(&mut h, &seam_turn());

    assert_eq!(
        result.text_content,
        "The sea is a vast expanse of saltwater covers most of the Earth."
    );
    assert!(!result.text_content.contains('\n'));
}

#[test]
fn no_line_break_is_put_at_the_seam() {
    let mut h = seam_harness(&[" and it is deep."]);
    let result = run_ok(&mut h, &seam_turn());

    assert_eq!(
        result.text_content,
        "The sea is a vast expanse of salt and it is deep."
    );
}

#[test]
fn a_repeated_tail_is_dropped_rather_than_said_twice() {
    let mut h = seam_harness(&["a vast expanse of saltwater."]);
    let result = run_ok(&mut h, &seam_turn());

    assert_eq!(
        result.text_content,
        "The sea is a vast expanse of saltwater."
    );
}

#[test]
fn an_ordinary_turn_still_starts_a_fresh_reply() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hello there."])]));
    run_ok(&mut h, &native_request(vec![user("hello, how are you")]));

    assert_eq!(
        h.model.requests[0].messages.last().map(|m| m.role.as_str()),
        Some("user")
    );
}

// -- carrying a folded conversation -------------------------------------------------------------------------------

fn folded() -> CompactionState {
    CompactionState {
        through_index: 4,
        summary: "Budget is 4200 GBP. Deadline 14 March.".to_string(),
        updated_at: 0.0,
    }
}

fn long_chat() -> Vec<Message> {
    vec![
        user("one"),
        assistant("first answer"),
        user("two"),
        assistant("second answer"),
        user("three"),
        assistant("third answer"),
        user("four"),
    ]
}

fn joined(request: &ChatRequest) -> String {
    request
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join(" | ")
}

fn folded_request(messages: Vec<Message>, compaction: Option<CompactionState>) -> TurnRequest {
    let mut turn = request(messages);
    turn.compaction = compaction;
    turn
}

#[test]
fn a_folded_conversation_sends_the_summary_instead_of_the_messages_it_covers() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &folded_request(long_chat(), Some(folded())));

    let wire = joined(&h.model.requests[0]);
    assert!(wire.contains("Budget is 4200 GBP"));
    assert!(!wire.contains("first answer"));
    assert!(!wire.contains("second answer"));
}

#[test]
fn a_folded_conversation_still_sends_everything_after_the_fold() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &folded_request(long_chat(), Some(folded())));

    let wire = joined(&h.model.requests[0]);
    assert!(wire.contains("third answer"));
    assert!(wire.contains("four"));
}

#[test]
fn the_summary_sits_directly_after_the_system_prompt() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &folded_request(long_chat(), Some(folded())));

    let sent = &h.model.requests[0].messages;
    assert_eq!(sent[0].role, "system");
    assert!(sent[1].content.contains("Budget is 4200 GBP"));
}

#[test]
fn a_summary_that_claims_more_messages_than_exist_is_ignored() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let stale = CompactionState {
        through_index: 99,
        ..folded()
    };
    run_ok(&mut h, &folded_request(vec![user("only one")], Some(stale)));

    let wire = joined(&h.model.requests[0]);
    assert!(!wire.contains("Budget is 4200 GBP"));
    assert!(wire.contains("only one"));
}

#[test]
fn a_conversation_with_nothing_folded_is_sent_whole() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &folded_request(long_chat(), None));

    assert!(joined(&h.model.requests[0]).contains("first answer"));
}

// -- asking the user before a tool runs --------------------------------------------------------------------------

fn guarded_request(mode: PermissionMode, grants: Vec<Grant>) -> TurnRequest {
    let mut turn = native_request(vec![user("where is Paris")]);
    turn.permission = Some(Permission { mode, grants });
    turn
}

/// `turns` passes that each call the search tool, then a plain answer.
fn search_passes(turns: usize) -> Vec<Vec<ModelChunk>> {
    let mut passes = vec![native_call("search_web", json!({"query": "paris"})); turns];
    passes.push(reply(&["Done."]));
    passes
}

fn approval_steps(result: &AgentResult) -> Vec<&SearchStep> {
    result
        .steps
        .iter()
        .filter(|s| s.kind == "approval")
        .collect()
}

fn last_tool_text(request: &ChatRequest) -> String {
    request
        .messages
        .last()
        .map_or_else(String::new, |m| m.content.clone())
}

#[test]
fn a_tool_with_no_reason_to_be_trusted_is_asked_about_first() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::Once));
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert_eq!(h.host.approvals.len(), 1);
    assert_eq!(h.host.approvals[0].tool, "search_web");
    assert_eq!(h.tools.calls.len(), 1);
}

#[test]
fn a_tool_is_not_run_when_the_user_says_no() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::No));
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert!(h.tools.calls.is_empty());
    // The turn carries on: the model is told, in the shape a tool answers in.
    assert!(
        last_tool_text(&h.model.requests[1])
            .to_lowercase()
            .contains("declined")
    );
}

#[test]
fn the_answer_is_shown_in_the_timeline_either_way() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::No));
    let result = run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    let approvals = approval_steps(&result);
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].extra.get("answer"), Some(&json!("no")));
    assert_eq!(
        approvals[0]
            .extra
            .get("approval")
            .and_then(|a| a.get("tool")),
        Some(&json!("search_web"))
    );
}

#[test]
fn an_allowance_for_the_task_stops_asking_for_the_rest_of_it() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(2)));
    h.host.answers.push_back(Some(ApprovalAnswer::Task));
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert_eq!(h.host.approvals.len(), 1);
    assert_eq!(h.tools.calls.len(), 2);
}

#[test]
fn an_allowance_for_one_call_asks_again_for_the_next() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(2)));
    h.host.answers.push_back(Some(ApprovalAnswer::Once));
    h.host.answers.push_back(Some(ApprovalAnswer::Once));
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert_eq!(h.host.approvals.len(), 2);
    assert_eq!(h.tools.calls.len(), 2);
}

#[test]
fn a_lasting_permission_is_handed_back_to_be_kept() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::Workspace));
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert_eq!(
        h.host.grants,
        vec![Grant {
            tool: "search_web".to_string(),
            target: None
        }]
    );
}

#[test]
fn a_tool_the_user_already_allowed_is_not_asked_about_again() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    let grants = vec![Grant {
        tool: "search_web".to_string(),
        target: None,
    }];
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, grants));

    assert!(h.host.approvals.is_empty());
    assert_eq!(h.tools.calls.len(), 1);
}

#[test]
fn a_workspace_that_runs_without_asking_does_not_ask() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::No));
    run_ok(&mut h, &guarded_request(PermissionMode::Auto, Vec::new()));

    assert!(h.host.approvals.is_empty());
    assert_eq!(h.tools.calls.len(), 1);
}

#[test]
fn plan_mode_refuses_in_plan_mode_without_asking_anyone() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.answers.push_back(Some(ApprovalAnswer::Once));
    let result = run_ok(&mut h, &guarded_request(PermissionMode::Plan, Vec::new()));

    assert!(h.host.approvals.is_empty());
    assert!(h.tools.calls.is_empty());
    assert_eq!(
        approval_steps(&result)
            .first()
            .and_then(|s| s.extra.get("answer")),
        Some(&json!("no"))
    );
    assert!(
        last_tool_text(&h.model.requests[1])
            .to_lowercase()
            .contains("plan mode")
    );
}

#[test]
fn a_call_is_refused_rather_than_run_unasked_when_there_is_nobody_to_ask() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(1)));
    h.host.can_ask = false;
    run_ok(&mut h, &guarded_request(PermissionMode::Ask, Vec::new()));

    assert!(h.tools.calls.is_empty());
}

// -- working to a plan -------------------------------------------------------------------------------------------

fn plan_request() -> TurnRequest {
    let mut turn = native_request(vec![user("carry on")]);
    turn.environment.has_folder = true;
    turn
}

/// The user messages a request carried, joined, as the model would read them at the start of the turn.
fn user_said(request: &ChatRequest) -> String {
    request
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn plan_items(text: &str) -> Vec<PlanItem> {
    parse_plan(text)
}

#[test]
fn a_conversation_with_no_plan_says_nothing_about_one() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(0)));
    run_ok(&mut h, &plan_request());

    assert!(
        !user_said(&h.model.requests[0])
            .to_lowercase()
            .contains("plan")
    );
}

#[test]
fn the_model_is_caught_up_on_a_plan_it_left_unfinished() {
    // The same path a task resumed after a restart takes: the plan comes back and the model is told where it got to.
    let mut h = Harness::new(FakeModel::with_passes(search_passes(0)));
    h.host.plan = Some(plan_items("[x] Read it\n[ ] Fix it"));
    run_ok(&mut h, &plan_request());

    let opening = user_said(&h.model.requests[0]);
    assert!(opening.contains("[x] Read it"));
    assert!(opening.contains("[ ] Fix it"));
    assert!(opening.to_lowercase().contains("carry on"));
}

#[test]
fn the_model_is_told_when_the_user_changes_the_plan_mid_run() {
    let mut h = Harness::new(FakeModel::with_passes(search_passes(2)));
    h.host.plan = Some(plan_items("[ ] First"));
    // The panel writes to the conversation while the turn is running, before the second pass.
    h.host.edit_at_read = Some((2, plan_items("[ ] First\n[ ] Second")));
    run_ok(&mut h, &plan_request());

    let second = user_said(&h.model.requests[1]);
    assert!(second.to_lowercase().contains("user edited"));
    assert!(second.contains("[ ] Second"));
}

#[test]
fn the_model_own_plan_update_is_not_reported_as_the_users_doing() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("update_plan", json!({"steps": "[x] First\n[>] Second"})),
        reply(&["Done."]),
    ]));
    h.tools.bodies.insert(
        "update_plan".to_string(),
        Box::new(|args: &Value, ctx: &mut ToolContext<'_>| {
            let text = args
                .get("steps")
                .and_then(Value::as_str)
                .unwrap_or_default();
            ctx.plan = Some(parse_plan(text));
            "Plan updated.".to_string()
        }),
    );
    h.host.plan = Some(plan_items("[ ] First\n[ ] Second"));
    run_ok(&mut h, &plan_request());

    let items = h.host.plan.clone().unwrap_or_default();
    assert_eq!(
        items.first().map(|item| item.status),
        Some(PlanStatus::Done)
    );
    assert!(
        !user_said(&h.model.requests[1])
            .to_lowercase()
            .contains("user edited")
    );
}

// -- a tool call the model got wrong -----------------------------------------------------------------------------

const GOOD_CALL: &str = "{\"name\": \"search_web\", \"args\": {\"query\": \"paris\"}}";

#[test]
fn a_broken_text_call_is_asked_for_again_against_a_schema_and_then_runs() {
    // A small model that opened the tag and never closed it.
    let mut model = FakeModel::with_passes(vec![
        reply(&["<tool>{\"name\": \"search_web\", \"args\": {\"query\": \"paris\""]),
        reply(&["Paris is the capital."]),
    ]);
    model.repairs.push_back(Some(GOOD_CALL.to_string()));
    let mut h = Harness::new(model);
    run_ok(&mut h, &text_request(vec![user("where is Paris")]));

    assert_eq!(h.model.repair_requests.len(), 1);
    assert_eq!(
        h.tools.calls,
        vec![("search_web".to_string(), json!({"query": "paris"}))]
    );
}

#[test]
fn a_provider_model_is_never_repaired_because_a_repair_would_send_the_whole_turn_again() {
    let mut model = FakeModel::with_passes(vec![reply(&[
        "<tool>{\"name\": \"search_web\", \"args\": {\"query\": \"paris\"",
    ])]);
    model.repairs.push_back(Some(GOOD_CALL.to_string()));
    let mut h = Harness::new(model);
    let mut turn = text_request(vec![user("where is Paris")]);
    turn.profile.model = "@openai/unlisted".to_string();
    run_ok(&mut h, &turn);

    assert!(h.model.repair_requests.is_empty());
}

#[test]
fn the_repair_is_constrained_to_the_tools_that_exist() {
    let mut model = FakeModel::with_passes(vec![
        reply(&["<tool>{\"name\": \"search_web\""]),
        reply(&["Done."]),
    ]);
    model.repairs.push_back(Some(GOOD_CALL.to_string()));
    let mut h = Harness::new(model);
    run_ok(&mut h, &text_request(vec![user("go")]));

    let schema = &h.model.repair_requests[0].schema;
    assert_eq!(schema["properties"]["name"]["enum"], json!(["search_web"]));
}

#[test]
fn the_repair_is_only_tried_once_in_a_turn() {
    let mut model = FakeModel::with_passes(vec![
        reply(&["<tool>{\"name\": \"search_web\""]),
        reply(&["<tool>{\"name\": \"search_web\""]),
        reply(&["Giving up."]),
    ]);
    model
        .repairs
        .push_back(Some("not a call at all".to_string()));
    let mut h = Harness::new(model);
    run_ok(&mut h, &text_request(vec![user("go")]));

    assert_eq!(h.model.repair_requests.len(), 1);
}

#[test]
fn an_ordinary_answer_is_left_alone_by_the_repair() {
    let mut model = FakeModel::with_passes(vec![reply(&["Paris is the capital of France."])]);
    model.repairs.push_back(Some(GOOD_CALL.to_string()));
    let mut h = Harness::new(model);
    let result = run_ok(&mut h, &text_request(vec![user("where is Paris")]));

    assert!(h.model.repair_requests.is_empty());
    assert!(result.text_content.contains("Paris is the capital"));
}

#[test]
fn a_reply_is_handed_back_as_written_when_the_repair_fails_too() {
    let mut model = FakeModel::with_passes(vec![reply(&[
        "<tool>{\"name\": \"search_web\", \"args\": {",
    ])]);
    model
        .repairs
        .push_back(Some("still not a call".to_string()));
    let mut h = Harness::new(model);
    let result = run_ok(&mut h, &text_request(vec![user("go")]));

    assert_eq!(h.model.repair_requests.len(), 1);
    assert!(h.tools.calls.is_empty());
    // The half-written call is not put in front of the user as though it were an answer.
    assert!(!result.text_content.contains("search_web"));
}

#[test]
fn a_model_with_a_real_tool_interface_is_not_repaired() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        "<tool>{\"name\": \"search_web\"",
    ])]));
    run_ok(&mut h, &native_request(vec![user("go")]));

    assert!(h.model.repair_requests.is_empty());
}

#[test]
fn a_runaway_repetition_of_markers_is_cut_and_the_stream_aborted() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        text("Here is the answer.\n\n"),
        text("== [REDACTED] ==\n\n"),
        text("== [REDACTED] ==\n\n"),
        text("== [REDACTED] ==\n\n"),
        text("== [REDACTED] ==\n\n"),
        finished("stop"),
    ]]));
    let result = run_ok(&mut h, &text_request(vec![user("write essay")]));

    assert_eq!(result.text_content, "Here is the answer.");
}

// -- a model that cannot use tools -------------------------------------------------------------------------------

fn unavailable_request(messages: Vec<Message>) -> TurnRequest {
    let mut turn = request(messages);
    turn.profile = profile(ToolAccess::Unavailable);
    turn
}

#[test]
fn a_model_that_cannot_use_tools_is_offered_none_and_told_there_is_no_browsing() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut turn = unavailable_request(vec![user("2+2")]);
    turn.tools = vec![search_definition()];
    run_ok(&mut h, &turn);

    assert_eq!(h.model.requests[0].tools, None);
    assert!(!system_of(&h.model.requests[0]).contains("AVAILABLE TOOLS"));
    assert!(h.tools.calls.is_empty());
}

#[test]
fn a_model_that_cannot_use_tools_is_not_given_the_web_even_when_the_setting_asks_for_it() {
    let mut first = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut on = unavailable_request(vec![user("2+2")]);
    on.settings.web_mode = WebMode::On;
    run_ok(&mut first, &on);

    let mut second = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut off = unavailable_request(vec![user("2+2")]);
    off.settings.web_mode = WebMode::Off;
    run_ok(&mut second, &off);

    assert_eq!(
        system_of(&first.model.requests[0]),
        system_of(&second.model.requests[0])
    );
}

// -- a model that cannot think -----------------------------------------------------------------------------------

#[test]
fn a_model_that_cannot_think_is_run_as_if_thinking_were_off_whatever_the_setting_says() {
    let mut medium = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    run_ok(&mut medium, &native_request(vec![user("2+2")]));

    let mut fast = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut low = native_request(vec![user("2+2")]);
    low.settings.effort = Effort::Off;
    run_ok(&mut fast, &low);

    assert_eq!(
        system_of(&medium.model.requests[0]),
        system_of(&fast.model.requests[0])
    );
    assert_eq!(medium.model.requests[0].think, None);
}

// -- a reasoning model that stops without text after tools -------------------------------------------------------

fn reasoning_turn(messages: Vec<Message>) -> TurnRequest {
    native_thinking_request(messages, Effort::Medium)
}

#[test]
fn a_reasoning_model_is_prompted_for_its_final_answer_instead_of_ending_on_an_empty_reply() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        vec![
            thinking("Looking up documentation."),
            call("search_web", json!({"query": "react"})),
            finished("tool_calls"),
        ],
        vec![thinking("Let me summarize the findings."), finished("stop")],
        reply(&["Here is the summary of React."]),
    ]));
    let result = run_ok(&mut h, &reasoning_turn(vec![user("look up react")]));

    assert_eq!(h.model.requests.len(), 3);
    assert_eq!(result.text_content, "Here is the summary of React.");
}

#[test]
fn a_reasoning_model_is_asked_once_then_shows_its_last_thought_in_the_message() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        vec![
            thinking("Looking up documentation."),
            call("search_web", json!({"query": "react"})),
            finished("tool_calls"),
        ],
        vec![
            thinking("Several React libraries found; I should ask which topic."),
            finished("stop"),
        ],
        vec![finished("stop")],
    ]));
    let result = run_ok(&mut h, &reasoning_turn(vec![user("look up react")]));

    assert_eq!(h.model.requests.len(), 3);
    assert_eq!(
        result.text_content,
        "Several React libraries found; I should ask which topic."
    );
    assert_eq!(
        h.observer
            .last_patch()
            .map(|patch| patch.text_content.clone()),
        Some(result.text_content.clone())
    );
}

#[test]
fn a_reasoning_model_that_never_speaks_falls_back_to_the_tool_output() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        native_call("search_web", json!({"query": "react"})),
        vec![finished("stop")],
        vec![finished("stop")],
    ]));
    let result = run_ok(&mut h, &reasoning_turn(vec![user("look up react")]));

    assert!(!result.text_content.trim().is_empty());
    assert_eq!(
        h.observer
            .last_patch()
            .map(|patch| patch.text_content.clone()),
        Some(result.text_content.clone())
    );
}

// -- a model that announces a tool call and stops ----------------------------------------------------------------

fn last_user_text(request: &ChatRequest) -> String {
    request
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map_or_else(String::new, |m| m.content.clone())
}

#[test]
fn an_announced_tool_call_is_acted_on_when_the_model_is_asked_to() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&["Let me search the web for that."]),
        native_call("search_web", json!({"query": "capital of France"})),
        reply(&["Paris."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("capital of France?")]));

    assert_eq!(h.model.requests.len(), 3);
    assert!(last_user_text(&h.model.requests[1]).contains("did not do it"));
    assert_eq!(
        h.tools.calls,
        vec![(
            "search_web".to_string(),
            json!({"query": "capital of France"})
        )]
    );
    assert_eq!(result.text_content, "Paris.");
    assert!(result.steps.iter().any(|s| {
        s.kind == "text"
            && s.content
                .as_deref()
                .is_some_and(|c| c.contains("Let me search"))
    }));
}

#[test]
fn an_announcement_is_asked_about_only_once_and_the_second_is_shown_as_the_reply() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&["Let me search the web for that."]),
        reply(&["I'll search for it now."]),
    ]));
    let result = run_ok(&mut h, &native_request(vec![user("capital of France?")]));

    assert_eq!(h.model.requests.len(), 2);
    assert!(h.tools.calls.is_empty());
    assert_eq!(result.text_content, "I'll search for it now.");
}

#[test]
fn a_plain_answer_is_not_followed_by_any_question() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[
        "Paris is the capital of France.",
    ])]));
    let result = run_ok(&mut h, &native_request(vec![user("capital of France?")]));

    assert_eq!(h.model.requests.len(), 1);
    assert_eq!(result.text_content, "Paris is the capital of France.");
}

// -- aborting during tool calls ----------------------------------------------------------------------------------

fn aborting_tool(h: &mut Harness, name: &str, pushes_open_step: bool) {
    let owned = name.to_string();
    h.tools.bodies.insert(
        owned.clone(),
        Box::new(move |_args: &Value, ctx: &mut ToolContext<'_>| {
            if pushes_open_step {
                let id = ctx.new_id();
                ctx.steps.push(step(&id, "searching", "active...", false));
            }
            ctx.cancel.abort();
            format!("{owned} finished")
        }),
    );
}

#[test]
fn aborting_during_a_tool_halts_at_once_and_leaves_later_tools_uncalled() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        vec![
            call("slow_tool", json!({})),
            call("search_web", json!({"query": "second"})),
            finished("tool_calls"),
        ],
        reply(&["should not be reached"]),
    ]));
    aborting_tool(&mut h, "slow_tool", false);
    let result = run_ok(&mut h, &native_request(vec![user("test abort")]));

    assert!(result.aborted);
    assert_eq!(h.model.requests.len(), 1);
    assert_eq!(h.tools.calls.len(), 1);
}

#[test]
fn an_abort_before_any_tool_runs_calls_no_tools() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        call("search_web", json!({"query": "abort test"})),
        finished("tool_calls"),
    ]]));
    h.cancel.abort();
    let result = run_ok(&mut h, &native_request(vec![user("test pre-abort")]));

    assert!(result.aborted);
    assert!(h.model.requests.is_empty());
    assert!(h.tools.calls.is_empty());
}

#[test]
fn an_abort_marks_the_incomplete_tool_steps_as_complete() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        call("active_tool", json!({})),
        finished("tool_calls"),
    ]]));
    aborting_tool(&mut h, "active_tool", true);
    let result = run_ok(&mut h, &native_request(vec![user("test step complete")]));

    assert!(result.aborted);
    let open = result
        .steps
        .iter()
        .find(|s| s.content.as_deref() == Some("active..."));
    assert_eq!(open.and_then(|s| s.is_complete), Some(true));
}

// -- a model the engine has to load first ------------------------------------------------------------------------

fn loading_steps(h: &Harness) -> Vec<SearchStep> {
    h.observer
        .step_lists()
        .into_iter()
        .flatten()
        .filter(|s| s.kind == "loading")
        .collect()
}

#[test]
fn a_model_being_loaded_is_said_so_while_it_loads_and_not_once_the_reply_is_in() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    h.engine.loaded = Some(false);
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    let loading = loading_steps(&h);
    assert_eq!(
        loading.first().and_then(|s| s.content.clone()),
        Some("loadingModel".to_string())
    );
    assert_eq!(
        loading.first().and_then(|s| s.extra.get("model")),
        Some(&json!(MODEL))
    );
    assert!(
        loading
            .first()
            .is_some_and(|s| s.extra.get("startedAt").is_some_and(Value::is_number))
    );
    assert!(!result.steps.iter().any(|s| s.kind == "loading"));
}

#[test]
fn a_model_already_in_memory_at_that_window_says_nothing() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    h.engine.loaded = Some(true);
    run_ok(&mut h, &request(vec![user("hi")]));

    assert!(loading_steps(&h).is_empty());
}

#[test]
fn a_model_in_memory_at_another_window_says_so_because_the_engine_reloads_for_it() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    h.engine.loaded = Some(false);
    run_ok(&mut h, &request(vec![user("hi")]));

    assert!(!loading_steps(&h).is_empty());
}

// -- a plain answer, sized and marked by the engine --------------------------------------------------------------

#[test]
fn a_remote_model_never_starts_the_engine_and_is_named_whole_in_the_request() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    let mut turn = request(vec![user("hi")]);
    turn.profile.model = "@openai/gpt-x".to_string();
    let result = run_ok(&mut h, &turn);

    assert_eq!(result.text_content, "Hi");
    assert!(h.engine.starts.is_empty());
    assert_eq!(h.model.requests[0].model, "@openai/gpt-x");
}

// -- provider models ---------------------------------------------------------------------------------------------

const PROVIDER_TOOLS: &str = "@anthropic/claude-tools";

fn remote_request(model: &str, messages: Vec<Message>) -> TurnRequest {
    let mut turn = native_request(messages);
    turn.profile.model = model.to_string();
    turn
}

#[test]
fn the_thinking_level_reaches_a_provider_which_maps_it_to_its_own_parameter() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    let mut turn = remote_request("@openai/thinker", vec![user("hi")]);
    turn.profile.has_thinking = true;
    turn.settings.effort = Effort::High;
    run_ok(&mut h, &turn);

    assert_eq!(h.model.requests[0].think, Some(true));
    assert_eq!(h.model.requests[0].thinking_level.as_deref(), Some("high"));
}

#[test]
fn the_thinking_level_never_reaches_the_engine_whose_body_stays_as_it_was() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Hi"])]));
    let mut turn = native_thinking_request(vec![user("hi")], Effort::High);
    turn.profile.has_thinking = true;
    run_ok(&mut h, &turn);

    assert_eq!(h.model.requests[0].think, Some(true));
    assert_eq!(h.model.requests[0].thinking_level, None);
}

#[test]
fn a_provider_state_rides_on_the_assistants_tool_call_into_the_next_request_of_the_same_turn() {
    let signed = ProviderState {
        instance_id: "anthropic".to_string(),
        state: json!({"signature": "sig-1"}),
    };
    let later = ProviderState {
        instance_id: "anthropic".to_string(),
        state: json!({"signature": "sig-2"}),
    };
    let mut first = native_call("search_web", json!({"query": "x"}));
    first.push(ModelChunk {
        provider_state: Some(signed.clone()),
        ..ModelChunk::default()
    });
    let mut second = reply(&["Done."]);
    second.push(ModelChunk {
        provider_state: Some(later.clone()),
        ..ModelChunk::default()
    });
    let mut h = Harness::new(FakeModel::with_passes(vec![first, second]));
    let result = run_ok(&mut h, &remote_request(PROVIDER_TOOLS, vec![user("go")]));

    let call_message = h.model.requests[1]
        .messages
        .iter()
        .find(|m| !m.tool_calls.is_empty());
    assert_eq!(
        call_message.and_then(|m| m.provider_state.clone()),
        Some(json!(signed))
    );
    assert_eq!(result.provider_state, Some(later));
}

#[test]
fn a_provider_state_tagged_for_another_instance_is_dropped() {
    let mut pass = reply(&["Hi"]);
    pass.push(ModelChunk {
        provider_state: Some(ProviderState {
            instance_id: "openai".to_string(),
            state: json!({}),
        }),
        ..ModelChunk::default()
    });
    let mut h = Harness::new(FakeModel::with_passes(vec![pass]));
    let result = run_ok(
        &mut h,
        &remote_request("@anthropic/claude-x", vec![user("hi")]),
    );

    assert_eq!(result.provider_state, None);
}

fn signed_reply() -> Message {
    let mut message = assistant("hello");
    message.provider_state =
        Some(json!({"instanceId": "anthropic", "state": {"signature": "sig-1"}}));
    message
}

#[test]
fn a_provider_state_goes_back_to_its_own_instance_next_turn_and_never_to_the_built_in_engine() {
    let history = vec![user("hi"), signed_reply(), {
        let mut again = user("again");
        again.id = "u2".to_string();
        again
    }];
    let signed = ProviderState {
        instance_id: "anthropic".to_string(),
        state: json!({"signature": "sig-1"}),
    };
    assert_eq!(
        to_wire_message(&signed_reply(), false, false).provider_state,
        Some(json!(signed))
    );

    let mut remote = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(
        &mut remote,
        &remote_request("@anthropic/claude-x", history.clone()),
    );
    let sent: Vec<&WireMessage> = remote.model.requests[0]
        .messages
        .iter()
        .filter(|m| m.provider_state.is_some())
        .collect();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0].role.as_str(), sent[0].content.as_str()),
        ("assistant", "hello")
    );
    assert_eq!(sent[0].provider_state.clone(), Some(json!(signed)));

    let mut local = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut local, &native_request(history));
    assert!(
        local.model.requests[0]
            .messages
            .iter()
            .all(|m| m.provider_state.is_none())
    );
}

// -- each stored message's reference on the wire -----------------------------------------------------------------

/// A stand-in for the provider's hash: the same message always gives the same reference.
struct FakeRefs;

impl MessageRefs for FakeRefs {
    fn reference(&mut self, message: &Message) -> DraggyRef {
        DraggyRef {
            id: message.id.clone(),
            hash: format!("hash:{}", message.content),
        }
    }
}

fn refs_on(request: &ChatRequest) -> Vec<&WireMessage> {
    request
        .messages
        .iter()
        .filter(|m| m.draggy_ref.is_some())
        .collect()
}

#[test]
fn a_message_reference_stays_the_same_when_the_message_has_lost_its_time_note_by_the_next_turn() {
    let first = user("what time is it");
    let mut one = Harness::new(FakeModel::with_passes(vec![reply(&["Noon."])]));
    run_ok(
        &mut one,
        &remote_request("@codex/gpt-x", vec![first.clone()]),
    );
    let before = one.model.requests[0]
        .messages
        .iter()
        .find(|m| m.draggy_ref.as_ref().is_some_and(|r| r.id == "u1"))
        .cloned();

    let mut two = Harness::new(FakeModel::with_passes(vec![reply(&["Still noon."])]));
    let mut again = user("and now");
    again.id = "u2".to_string();
    let mut answer = assistant("Noon.");
    answer.id = "a1".to_string();
    run_ok(
        &mut two,
        &remote_request("@codex/gpt-x", vec![first.clone(), answer, again]),
    );
    let sent = &two.model.requests[0].messages;
    let after = sent
        .iter()
        .find(|m| m.draggy_ref.as_ref().is_some_and(|r| r.id == "u1"))
        .cloned();

    // The note was on the wire the first time and is gone the second; the reference did not move.
    assert_ne!(
        before.as_ref().map(|m| m.content.clone()),
        after.as_ref().map(|m| m.content.clone())
    );
    assert_eq!(
        after.as_ref().and_then(|m| m.draggy_ref.clone()),
        before.as_ref().and_then(|m| m.draggy_ref.clone())
    );
    assert_eq!(
        before.and_then(|m| m.draggy_ref),
        Some(FakeRefs.reference(&first))
    );
    let ids: Vec<&str> = sent
        .iter()
        .filter_map(|m| m.draggy_ref.as_ref().map(|r| r.id.as_str()))
        .collect();
    assert_eq!(ids, vec!["u1", "a1", "u2"]);
    assert!(
        sent.iter()
            .find(|m| m.role == "system")
            .is_some_and(|m| m.draggy_ref.is_none())
    );
}

#[test]
fn a_message_reference_is_never_sent_to_the_built_in_engine() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &native_request(vec![user("hi")]));

    assert!(refs_on(&h.model.requests[0]).is_empty());
}

// -- the system prompt's profile ---------------------------------------------------------------------------------

#[test]
fn the_system_prompt_is_full_when_the_model_info_says_so_and_compact_for_the_engine() {
    let mut remote = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    let mut full = remote_request(PROVIDER_TOOLS, vec![user("hi")]);
    full.profile.prompt_profile = PromptProfile::Full;
    run_ok(&mut remote, &full);
    assert!(system_of(&remote.model.requests[0]).contains("Using tools well:"));

    let mut local = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut local, &native_request(vec![user("hi")]));
    assert!(!system_of(&local.model.requests[0]).contains("Using tools well:"));
}

// -- provider failures -------------------------------------------------------------------------------------------

#[test]
fn a_provider_retried_shows_each_wait_as_a_loading_step_gone_once_the_answer_starts() {
    // A slow clock makes every event leave the batcher at once, so each wait reaches the observer.
    let slow = StepClock::new(100.0);
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        ModelChunk {
            retry: Some(Retry {
                attempt: 1,
                of: 2,
                retry_after_ms: 4000.0,
            }),
            ..ModelChunk::default()
        },
        ModelChunk {
            retry: Some(Retry {
                attempt: 2,
                of: 2,
                retry_after_ms: 8000.0,
            }),
            ..ModelChunk::default()
        },
        text("Hi"),
        finished("stop"),
    ]]));
    h.clock = slow;
    let result = run_ok(&mut h, &remote_request("@openai/gpt-x", vec![user("hi")]));

    let retries: Vec<SearchStep> = h
        .observer
        .step_lists()
        .into_iter()
        .flatten()
        .filter(|s| s.extra.contains_key("retry"))
        .collect();
    let waits: Vec<(i64, i64)> = retries
        .iter()
        .filter_map(|s| s.extra.get("retry"))
        .map(|r| {
            (
                r["attempt"].as_i64().unwrap_or_default(),
                r["of"].as_i64().unwrap_or_default(),
            )
        })
        .collect();
    assert!(waits.contains(&(1, 2)) && waits.contains(&(2, 2)));
    assert!(retries.iter().all(|s| s.kind == "loading"));
    let ids: std::collections::BTreeSet<&str> =
        retries.iter().filter_map(|s| s.id.as_deref()).collect();
    assert_eq!(ids.len(), 1);
    let last_until = retries
        .last()
        .and_then(|s| s.extra.get("retry"))
        .and_then(|r| r["until"].as_f64())
        .unwrap_or_default();
    assert!(last_until >= 8000.0);
    assert!(!result.steps.iter().any(|s| s.extra.contains_key("retry")));
    assert_eq!(result.text_content, "Hi");
}

#[test]
fn a_provider_that_fails_once_its_stream_is_open_ends_the_turn_with_its_error() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        text("Hel"),
        ModelChunk {
            error: Some("upstream fell over".to_string()),
            ..ModelChunk::default()
        },
    ]]));
    let outcome = h.run(&remote_request("@openai/gpt-x", vec![user("hi")]));

    assert_eq!(
        outcome,
        Err(TurnError::Model("upstream fell over".to_string()))
    );
}

// -- live streaming file creation --------------------------------------------------------------------------------

/// Stands in for the built-in `create_file`: it completes the step the loop opened while the file streamed.
fn with_create_file(h: &mut Harness) {
    h.tools.bodies.insert(
        "create_file".to_string(),
        Box::new(|args: &Value, ctx: &mut ToolContext<'_>| {
            let filename = args
                .get("filename")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if let Some(open) = ctx.steps.iter_mut().rev().find(|s| s.kind == "create_file") {
                open.is_complete = Some(true);
                open.filename = Some(filename.clone());
                open.filepath = Some(format!("C:/out/{filename}"));
                open.extra.insert("fileContent".to_string(), json!(content));
            }
            "File created.".to_string()
        }),
    );
}

fn streamed_call(args_so_far: &str) -> ModelChunk {
    ModelChunk {
        streaming_calls: Some(vec![StreamingCall {
            id: Some("call_file_1".to_string()),
            name: "create_file".to_string(),
            args_string: args_so_far.to_string(),
        }]),
        ..ModelChunk::default()
    }
}

#[test]
fn a_file_being_written_emits_an_in_progress_step_and_finalises_it_on_completion() {
    let part1 = "{\"filename\": \"report.docx\", \"content\": \"# Part 1";
    let part2 = "\\n\\nBody content\"}";
    let mut h = Harness::new(FakeModel::with_passes(vec![
        vec![
            streamed_call(part1),
            streamed_call(&format!("{part1}{part2}")),
            ModelChunk {
                tool_calls: vec![ToolCall {
                    id: Some("call_file_1".to_string()),
                    name: "create_file".to_string(),
                    arguments: json!({"filename": "report.docx", "content": "# Part 1\n\nBody content"}),
                }],
                ..ModelChunk::default()
            },
            finished("tool_calls"),
        ],
        reply(&["File created successfully."]),
    ]));
    with_create_file(&mut h);
    let result = run_ok(&mut h, &native_request(vec![user("create report.docx")]));

    let open = h
        .observer
        .step_lists()
        .into_iter()
        .flatten()
        .find(|s| s.kind == "create_file" && s.is_complete != Some(true));
    assert_eq!(
        open.as_ref().and_then(|s| s.filename.clone()),
        Some("report.docx".to_string())
    );
    assert_eq!(
        open.as_ref()
            .and_then(|s| s.extra.get("fileContent").cloned()),
        Some(json!("# Part 1"))
    );

    let files: Vec<&SearchStep> = result
        .steps
        .iter()
        .filter(|s| s.kind == "create_file")
        .collect();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].is_complete, Some(true));
    assert_eq!(files[0].filepath.as_deref(), Some("C:/out/report.docx"));
    assert_eq!(
        files[0].extra.get("fileContent"),
        Some(&json!("# Part 1\n\nBody content"))
    );
}

#[test]
fn a_file_streamed_in_text_mode_reuses_the_in_progress_step() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&[
            "<tool>{\"name\": \"create_file\", \"args\": {\"filename\": \"streamed.txt\", \"content\": \"Hello ",
            "world!\"}}</tool>",
        ]),
        reply(&["Here is your file."]),
    ]));
    with_create_file(&mut h);
    let result = run_ok(&mut h, &text_request(vec![user("write streamed.txt")]));

    let open = h
        .observer
        .step_lists()
        .into_iter()
        .flatten()
        .find(|s| s.kind == "create_file" && s.is_complete != Some(true));
    assert_eq!(
        open.and_then(|s| s.filename),
        Some("streamed.txt".to_string())
    );

    let files: Vec<&SearchStep> = result
        .steps
        .iter()
        .filter(|s| s.kind == "create_file")
        .collect();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].is_complete, Some(true));
    assert_eq!(files[0].filename.as_deref(), Some("streamed.txt"));
}

// -- what the turn writes to the log -----------------------------------------------------------------------------
// The loop logs ids and roles only. The subscriber is not in the test tree, so these check the notes it logs from.

#[test]
fn a_history_message_with_an_unknown_role_is_noted_by_role_without_its_text() {
    let secret = "SENTINEL-PROMPT-3f9a1c";
    let wire = vec![
        WireMessage::text("system", "sys"),
        WireMessage::text("bogus", secret),
    ];
    let notes = unsendable_notes(&wire);

    assert_eq!(
        notes,
        vec![Unsendable::UnknownRole {
            role: "bogus".to_string()
        }]
    );
    assert!(!format!("{notes:?}").contains(secret));
}

#[test]
fn a_tool_result_with_no_call_is_noted_without_its_text() {
    let secret = "SENTINEL-PROMPT-3f9a1c";
    let mut orphan = WireMessage::text("tool", secret);
    orphan.tool_call_id = Some("missing".to_string());
    let notes = unsendable_notes(&[WireMessage::text("system", "sys"), orphan]);

    assert_eq!(
        notes,
        vec![Unsendable::OrphanToolResult { has_call_id: true }]
    );
    assert!(!format!("{notes:?}").contains(secret));
}

#[test]
fn a_tool_result_answering_a_call_in_the_wire_is_not_noted() {
    let mut calling = WireMessage::text("assistant", "");
    calling.tool_calls = vec![ToolCall {
        id: Some("call_0".to_string()),
        name: "search_web".to_string(),
        arguments: json!({}),
    }];
    let mut answer = WireMessage::text("tool", "TOOL RESULT");
    answer.tool_call_id = Some("call_0".to_string());

    assert!(unsendable_notes(&[calling, answer]).is_empty());
}

// -- the rest of a plain answer ----------------------------------------------------------------------------------

#[test]
fn the_clock_goes_on_the_last_user_message_instead_of_the_system_prompt() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &request(vec![user("hello")]));

    let last = last_message(&h.model.requests[0]);
    assert!(last.content.contains("Current time"));
}

#[test]
fn the_system_prompt_is_identical_across_two_turns() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&["one"]),
        reply(&["two"]),
    ]));
    run_ok(&mut h, &request(vec![user("first")]));
    run_ok(&mut h, &request(vec![user("second")]));

    assert_eq!(
        system_of(&h.model.requests[1]),
        system_of(&h.model.requests[0])
    );
}

#[test]
fn earlier_user_turns_stay_byte_identical_for_local_cache_reuse() {
    let mut h = Harness::new(FakeModel::with_passes(vec![
        reply(&["one"]),
        reply(&["two"]),
    ]));
    let mut first = user("first");
    first.id = "u-1".to_string();
    run_ok(&mut h, &request(vec![first.clone()]));

    let mut answer = assistant("one");
    answer.id = "a-1".to_string();
    let mut second = user("second");
    second.id = "u-2".to_string();
    run_ok(&mut h, &request(vec![first, answer, second]));

    let before = h.model.requests[0].messages[1].content.clone();
    let after = h.model.requests[1].messages[1].content.clone();
    assert_eq!(after, before);
    assert!(after.contains("Current time"));
}

#[test]
fn an_answer_cut_short_by_the_context_limit_is_flagged() {
    let mut h = Harness::new(FakeModel::with_passes(vec![vec![
        text("truncated"),
        finished("length"),
    ]]));
    let result = run_ok(&mut h, &request(vec![user("hi")]));

    assert!(result.out_of_context);
    assert!(
        h.observer
            .events()
            .iter()
            .any(|event| matches!(event, TurnEvent::OutOfContext(true)))
    );
}

#[test]
fn a_model_without_the_tool_capability_is_sent_no_tool_schemas() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"])]));
    run_ok(&mut h, &request(vec![user("hi")]));

    assert_eq!(h.model.requests[0].tools, None);
}

// -- skills ------------------------------------------------------------------------------------------------------

/// Skill bodies by id, and the reads the turn made, so a test can see which skills were loaded.
#[derive(Default)]
struct FakeSkills {
    bodies: BTreeMap<String, LoadedSkill>,
    reads: Vec<(String, String)>,
}

impl SkillReader for FakeSkills {
    fn read(&mut self, workspace_id: &str, id: &str) -> Option<LoadedSkill> {
        self.reads.push((workspace_id.to_string(), id.to_string()));
        self.bodies.get(id).cloned()
    }
}

fn prompt_skill(id: &str, name: &str, description: &str) -> InstalledSkill {
    InstalledSkill {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        ..InstalledSkill::default()
    }
}

fn loaded(id: &str, body: &str) -> LoadedSkill {
    LoadedSkill {
        id: id.to_string(),
        name: id.to_string(),
        body: body.to_string(),
        files: Vec::new(),
    }
}

/// The shelf the skill tests offer: a docx skill and a dockerfile skill.
fn shelf() -> Vec<InstalledSkill> {
    vec![
        prompt_skill("docx", "docx", "Creates Word documents."),
        prompt_skill("dockerfile", "dockerfile", "Containerises applications."),
    ]
}

fn skill_reader() -> FakeSkills {
    let mut skills = FakeSkills::default();
    skills.bodies.insert(
        "docx".to_string(),
        loaded("docx", "How to do the docx job."),
    );
    skills
}

fn turn_with_skills(messages: Vec<Message>) -> TurnRequest {
    let mut turn = request(messages);
    turn.skills = shelf();
    turn
}

fn prepared(turn: &TurnRequest, skills: &mut FakeSkills) -> PreparedTurn {
    prepare_turn(turn, &mut TailNotes::default(), &mut FakeRefs, skills)
}

fn prepared_user_text(prepared: &PreparedTurn) -> String {
    prepared
        .wire
        .iter()
        .rev()
        .find(|entry| entry.role == "user")
        .map(|entry| entry.content.clone())
        .unwrap_or_default()
}

fn utf16(text: &str) -> i64 {
    text.encode_utf16().count() as i64
}

#[test]
fn a_slash_command_loads_the_skill_with_the_message_it_starts() {
    let mut skills = skill_reader();
    let turn = turn_with_skills(vec![user("/docx a packing list for a hike")]);
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(
        skills.reads,
        vec![("default".to_string(), "docx".to_string())]
    );
    assert!(prepared.wire[0].content.contains("LOADED SKILLS"));
    assert!(prepared.wire[0].content.contains("How to do the docx job."));
    assert!(prepared_user_text(&prepared).contains("/docx a packing list for a hike"));
    assert!(
        prepared_user_text(&prepared)
            .contains("The request that came with it: a packing list for a hike")
    );
    assert_eq!(
        prepared.invoked_skill,
        Some(InvokedSkill {
            id: "docx".to_string(),
            name: "docx".to_string()
        })
    );
}

#[test]
fn a_message_that_only_mentions_a_skill_loads_nothing() {
    let mut skills = skill_reader();
    let turn = turn_with_skills(vec![user("make a docx for me")]);
    let prepared = prepared(&turn, &mut skills);

    assert!(skills.reads.is_empty());
    assert!(!prepared_user_text(&prepared).contains("How to do"));
}

#[test]
fn a_skill_from_the_other_side_is_not_offered_so_it_is_not_loaded() {
    let mut skills = FakeSkills::default();
    let turn = turn_with_skills(vec![user("/code-review src/app.ts")]);
    let prepared = prepared(&turn, &mut skills);

    assert!(skills.reads.is_empty());
    assert!(!prepared_user_text(&prepared).contains("code-review job"));
    assert_eq!(prepared.invoked_skill, None);
}

#[test]
fn a_continued_reply_keeps_the_skill_loaded_without_starting_it_again() {
    let mut skills = skill_reader();
    let mut turn = turn_with_skills(vec![
        user("/docx a packing list"),
        assistant("Here is the start of"),
    ]);
    turn.is_continuation = true;
    let prepared = prepared(&turn, &mut skills);

    assert!(prepared.wire[0].content.contains("How to do the docx job."));
    assert_eq!(prepared.invoked_skill, None);
}

#[test]
fn a_skill_that_cannot_be_read_leaves_the_message_as_written() {
    let mut skills = FakeSkills::default();
    let turn = turn_with_skills(vec![user("/docx a packing list")]);
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(
        prepared_user_text(&prepared)
            .matches("/docx a packing list")
            .count(),
        1
    );
    assert!(!prepared_user_text(&prepared).contains("LOADED SKILLS"));
    assert!(!prepared.wire[0].content.contains("LOADED SKILLS"));
    assert_eq!(prepared.invoked_skill, None);
}

#[test]
fn a_loaded_skill_stays_in_the_instructions_for_the_turns_after_it() {
    let mut skills = skill_reader();
    let turn = turn_with_skills(vec![
        user("/docx a packing list"),
        assistant("Saved packing-list.docx."),
        user("Add a section for food."),
    ]);
    let prepared = prepared(&turn, &mut skills);

    assert!(prepared.wire[0].content.contains("How to do the docx job."));
    assert!(!prepared_user_text(&prepared).contains("/docx"));
    assert_eq!(prepared.invoked_skill, None);
}

#[test]
fn a_skill_the_model_loaded_stays_loaded_too() {
    let mut skills = skill_reader();
    let mut done = assistant("Done.");
    let mut used = step("s1", "skill", "Used **docx**", true);
    used.extra.insert("skill".to_string(), json!("docx"));
    done.steps = Some(vec![used]);
    let turn = turn_with_skills(vec![
        user("Make me a Word document."),
        done,
        user("Shorter, please."),
    ]);
    let prepared = prepared(&turn, &mut skills);

    assert!(prepared.wire[0].content.contains("How to do the docx job."));
}

#[test]
fn a_loaded_skill_is_counted_apart_from_the_skill_list_and_the_tools() {
    let mut skills = skill_reader();
    let turn = turn_with_skills(vec![user("/docx a packing list")]);
    let prepared = prepared(&turn, &mut skills);
    let parts = &prepared.prompt_parts;
    let loaded = parts.loaded_skills.clone().unwrap_or_default();

    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "docx");
    assert_eq!(loaded[0].name, "docx");
    assert!(parts.loaded_skill_chars.unwrap_or(0) > loaded[0].chars);
    assert_eq!(parts.skill_count, Some(2));
    assert!(parts.tool_count.unwrap_or(-1) >= 0);
    assert!(
        parts.system_chars
            < utf16(&prepared.wire[0].content) - parts.loaded_skill_chars.unwrap_or(0)
    );
}

#[test]
fn the_list_the_model_is_offered_names_only_the_skills_it_was_given() {
    let mut skills = FakeSkills::default();
    let turn = turn_with_skills(vec![user("hello")]);
    let prepared = prepared(&turn, &mut skills);

    assert!(
        prepared.wire[0]
            .content
            .contains("- docx: Creates Word documents.")
    );
    assert!(
        prepared.wire[0]
            .content
            .contains("- dockerfile: Containerises applications.")
    );
    assert!(!prepared.wire[0].content.contains("code-review"));
}

#[test]
fn a_skill_marked_not_for_the_model_is_left_out_of_the_listed_count() {
    let mut skills = FakeSkills::default();
    let mut turn = request(vec![user("hello")]);
    turn.skills = vec![
        prompt_skill("docx", "docx", "Creates Word documents."),
        InstalledSkill {
            model_invocable: Some(false),
            ..prompt_skill("hidden", "hidden", "Only by slash command.")
        },
    ];
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(prepared.prompt_parts.skill_count, Some(1));
    assert!(!prepared.wire[0].content.contains("hidden:"));
}

#[test]
fn the_skill_list_is_counted_as_skill_text_not_as_system_text() {
    let mut skills = FakeSkills::default();
    let turn = turn_with_skills(vec![user("hello")]);
    let prepared = prepared(&turn, &mut skills);
    let parts = &prepared.prompt_parts;

    assert!(parts.skill_chars > 0);
    assert_eq!(parts.loaded_skill_chars, Some(0));
    assert_eq!(parts.loaded_skills, Some(Vec::new()));
    assert_eq!(
        parts.system_chars,
        utf16(&prepared.wire[0].content) - parts.skill_chars
    );
}

#[test]
fn the_memory_count_includes_the_project_instructions_header() {
    let mut skills = FakeSkills::default();
    let mut turn = request(vec![user("hello")]);
    turn.memory = Some(ProjectMemory {
        path: "AGENTS.md".to_string(),
        text: "Use tabs.".to_string(),
    });
    let prepared = prepared(&turn, &mut skills);
    let rendered = render_memory(turn.memory.as_ref().expect("memory was set"));

    assert!(rendered.starts_with("PROJECT INSTRUCTIONS (AGENTS.md)"));
    assert_eq!(prepared.prompt_parts.memory_chars, utf16(&rendered));
}

#[test]
fn the_skill_count_is_capped_at_the_listing_limit() {
    let mut skills = FakeSkills::default();
    let mut turn = request(vec![user("hello")]);
    turn.skills = (0..45)
        .map(|index| {
            prompt_skill(
                &format!("skill-{index}"),
                &format!("skill-{index}"),
                "Does a thing.",
            )
        })
        .collect();
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(prepared.prompt_parts.skill_count, Some(40));
}

#[test]
fn a_model_without_tools_is_not_told_about_library_code_execution_or_skills() {
    let mut skills = skill_reader();
    let mut turn = turn_with_skills(vec![user("/docx a packing list")]);
    turn.profile = profile(ToolAccess::Unavailable);
    turn.environment = PromptEnvironment {
        has_folder: false,
        project_root: None,
        code_execution: true,
        library_ready: true,
        has_skills: true,
    };
    let prepared = prepared(&turn, &mut skills);
    let system = &prepared.wire[0].content;

    assert!(!system.contains("search_library"));
    assert!(!system.contains("run_code"));
    assert!(!system.contains("SKILLS\n\nSkills are"));
    assert!(skills.reads.is_empty());
    assert_eq!(prepared.invoked_skill, None);
    assert_eq!(prepared.prompt_parts.skill_count, Some(0));
    assert_eq!(prepared.prompt_parts.skill_chars, 0);
}

#[test]
fn a_model_whose_probe_answered_and_cannot_think_is_run_without_thinking() {
    let mut skills = FakeSkills::default();
    let mut turn = request(vec![user("hello")]);
    turn.settings.effort = Effort::High;
    turn.profile.has_thinking = false;
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(prepared.effective_effort, Effort::Off);
    assert!(prepared.wire[0].content.contains("Answer immediately."));
}

#[test]
fn a_model_whose_probe_failed_keeps_the_thinking_it_was_asked_for() {
    let mut skills = FakeSkills::default();
    let mut turn = request(vec![user("hello")]);
    turn.settings.effort = Effort::High;
    turn.profile.has_thinking = false;
    turn.profile.probed = false;
    let prepared = prepared(&turn, &mut skills);

    assert_eq!(prepared.effective_effort, Effort::High);
    assert!(!prepared.native_thinking);
    assert!(!prepared.wire[0].content.contains("Answer immediately."));
}

// -- the window, the probe and the log ---------------------------------------------------------------------------

/// An engine that keeps the largest window it has given a model, as the app's engine host does for a conversation.
struct HeldWindowEngine {
    held: i64,
}

impl Engine for HeldWindowEngine {
    fn context_size(
        &mut self,
        _model: &str,
        chars: i64,
        _max_context: Option<i64>,
        _fixed: Option<FixedContext>,
    ) -> i64 {
        let wanted = if chars > 4096 * 4 { 16384 } else { 4096 };
        self.held = self.held.max(wanted);
        self.held
    }

    fn is_loaded_at(&mut self, _model: &str, _num_ctx: i64) -> Option<bool> {
        Some(true)
    }

    fn start(&mut self, _model: &str, _num_ctx: i64, _exact: bool) -> Result<(), String> {
        Ok(())
    }

    fn gpu_percent(&mut self, _model: &str) -> Option<f64> {
        None
    }
}

#[test]
fn a_window_that_has_grown_is_sent_again_on_the_next_turn_without_giving_it_back() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["ok"]), reply(&["ok"])]));
    let mut engine = HeldWindowEngine { held: 0 };

    for messages in [vec![user(&"x".repeat(60000))], vec![user("hi")]] {
        let turn = request(messages);
        let ports = Ports {
            model: &mut h.model,
            engine: &mut engine,
            tools: &mut h.tools,
            host: &mut h.host,
            observer: &mut h.observer,
            refs: &mut h.refs,
            skills: &mut h.skills,
            ids: &mut h.ids,
            clock: &h.clock,
            cancel: &h.cancel,
        };
        run_turn(&turn, &mut h.tail_notes, ports).expect("the turn runs");
    }

    assert!(h.model.requests[0].num_ctx > 4096);
    assert_eq!(h.model.requests[1].num_ctx, h.model.requests[0].num_ctx);
}

#[test]
fn a_model_whose_probe_failed_still_gets_its_tools_in_the_prompt() {
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&["Four."])]));
    let mut turn = text_request(vec![user("2+2")]);
    turn.profile.probed = false;
    run_ok(&mut h, &turn);

    assert!(system_of(&h.model.requests[0]).contains("AVAILABLE TOOLS"));
}

#[test]
fn the_turn_log_never_carries_the_prompt_or_the_reply() {
    const SECRET_PROMPT: &str = "SENTINEL-PROMPT-3f9a1c";
    const SECRET_REPLY: &str = "SENTINEL-REPLY-77be02";

    let captured = LogCapture::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(captured.clone())
        .finish();

    // This is the only test that installs a subscriber, and a process-wide one, since scoped ones race on callsite caches.
    tracing::subscriber::set_global_default(subscriber).expect("no other test sets a subscriber");
    let mut h = Harness::new(FakeModel::with_passes(vec![reply(&[SECRET_REPLY])]));
    run_ok(&mut h, &request(vec![user(SECRET_PROMPT)]));

    let text = captured.text();
    assert!(
        text.contains("turn start"),
        "the turn should log its steps: {text}"
    );
    assert!(!text.contains(SECRET_PROMPT));
    assert!(!text.contains(SECRET_REPLY));
}

/// Keeps every log line in memory, so a test can read what the turn wrote.
#[derive(Clone, Default)]
struct LogCapture(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl LogCapture {
    fn text(&self) -> String {
        let held = self.0.lock().map(|bytes| bytes.clone()).unwrap_or_default();
        String::from_utf8_lossy(&held).into_owned()
    }
}

impl std::io::Write for LogCapture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut held) = self.0.lock() {
            held.extend_from_slice(buf);
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'writer> tracing_subscriber::fmt::MakeWriter<'writer> for LogCapture {
    type Writer = LogCapture;

    fn make_writer(&'writer self) -> Self::Writer {
        self.clone()
    }
}

#[test]
fn messages_without_ids_keep_their_own_time_note_by_position() {
    let mut tail_notes = TailNotes::default();
    let first_turn = request(vec![
        message("", "user", "first"),
        message("", "assistant", "ok"),
        message("", "user", "second"),
    ]);
    prepare_turn(
        &first_turn,
        &mut tail_notes,
        &mut FakeRefs,
        &mut FakeSkills::default(),
    );

    let second_turn = request(vec![
        message("", "user", "first"),
        message("", "assistant", "ok"),
        message("", "user", "second"),
        message("", "assistant", "ok"),
        message("", "user", "third"),
    ]);
    let prepared = prepare_turn(
        &second_turn,
        &mut tail_notes,
        &mut FakeRefs,
        &mut FakeSkills::default(),
    );
    let users: Vec<&WireMessage> = prepared
        .wire
        .iter()
        .filter(|entry| entry.role == "user")
        .collect();

    assert_eq!(users[0].content, "first");
    assert_eq!(users[1].content, "second\n\n[Current time: 12:00]");
    assert_eq!(users[2].content, "third\n\n[Current time: 12:00]");
}

#[test]
fn an_empty_workspace_reads_its_skills_from_the_default_one() {
    let mut skills = skill_reader();
    let mut turn = turn_with_skills(vec![user("/docx a packing list")]);
    turn.workspace_id = String::new();
    prepared(&turn, &mut skills);

    assert_eq!(
        skills.reads,
        vec![("default".to_string(), "docx".to_string())]
    );
}
