//! The agent turn loop: a port of `src/agent/agentLoop.ts`. The model, engine, tools, host and observer are traits, so a
//! turn runs the same way against a scripted fake in a test as against a real engine. Clock and ids come in as values.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::{debug, warn};

use crate::announcement::announces_action;
use crate::compaction::{CHARS_PER_TOKEN, CompactionState, render_compaction_block};
use crate::context_breakdown::{ContextBreakdown, LoadedSkillPart, PromptParts, measure_breakdown};
use crate::js::{is_js_space, trim_js, trim_start_js, utf16_len};
use crate::live_turn::LiveTurn;
use crate::parsing::{
    ParsedToolCall, ToolParser, extract_file_streaming_args, extract_thought,
    has_tool_marker_across, parse_tool_call,
};
use crate::effort::{Effort, EffortInput, Surface, effective_effort};
use crate::permissions::{
    Decision, Grant, PermissionMode, PermissionQuery, ToolAnnotations, Verdict, add_grant, decide,
    denied_by_user, grants_for, refusal_for, target_from_args,
};
use crate::prompts::{
    ProjectMemory, PromptEnvironment, PromptMode, PromptProfile, PromptSettings, PromptSkill,
    PromptTool, SystemPromptInput, WebMode, build_system_prompt, current_time_note,
    describe_skills, describe_tools_for_prompt, render_memory,
};
use crate::repetition::detect_repetition;
use crate::resume::{SearchStep, build_resume_message, join_continuation};
use crate::skills::{
    InstalledSkill, LoadedSkill, MAX_LISTED_SKILLS, Side, SkillReader, loaded_skill_ids,
    render_invoked_skill, render_loaded_skills, render_skill, skill_invocation, skills_for,
};
use crate::task_manager::{CancelSignal, Message, Seed};
use crate::tool_channel::{
    RepairedCall, ToolDefinition, looks_like_call, read_repair, repair_prompt, repair_schema,
};

/// A turn stops after this many passes unless the model's profile lowers it.
pub const MAX_TOOL_LOOPS: usize = 75;
/// How often a streamed pass may repaint the timeline, in milliseconds.
pub const STREAM_UI_INTERVAL_MS: f64 = 50.0;
/// How often the speed line and the context meter hear from a running pass, in milliseconds.
pub const LIVE_INTERVAL_MS: f64 = 250.0;
/// The reply shown when the loop limit is reached with no answer written.
pub const EXHAUSTED_MESSAGE: &str = "I apologize, but I reached the maximum number of search steps without finding a definitive final answer.";
/// How much of a tool result becomes the reply when the model said nothing at all.
pub const FALLBACK_RESULT_UNITS: usize = 2000;
/// Sent when the model announced an action and stopped; asked once.
pub const ACT_ON_ANNOUNCEMENT: &str = "You said what you would do next but did not do it. Make that tool call now, or if you have finished, give your final answer.";
/// Sent when a reply was cut off, so the model carries on rather than restarting.
pub const CONTINUE_PROMPT: &str = "Your previous reply was cut off. Carry straight on from the exact character it stopped at, even if that is in the middle of a word or a sentence. Write only what comes next: no greeting, no preamble, no repetition of what you already wrote, and no repeating work you already finished.";
/// Sent once when a reasoning model stopped after its tools without writing an answer.
pub const FINAL_ANSWER_PROMPT: &str = "Please provide your final answer to the user based on your reasoning and the gathered information.";

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const FILE_TOOLS: [&str; 2] = ["create_file", "write_file"];
const MAX_IMAGE_CHARS: i64 = 4000;
/// The workspace a conversation without one reads its skills from.
const DEFAULT_WORKSPACE: &str = "default";

/// Cancellation shared by the loop, its tools and whoever stops the turn.
pub type CancelToken = CancelSignal;

// ---------------------------------------------------------------------------------------------------------------
// Values that cross the boundary
// ---------------------------------------------------------------------------------------------------------------

/// The answer to a permission question, as the approval card gives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalAnswer {
    Once,
    Task,
    Workspace,
    No,
}

impl ApprovalAnswer {
    fn as_str(self) -> &'static str {
        match self {
            Self::Once => "once",
            Self::Task => "task",
            Self::Workspace => "workspace",
            Self::No => "no",
        }
    }
}

/// State a provider hands back with a reply, to be returned with the next request of the same turn or conversation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderState {
    pub instance_id: String,
    pub state: Value,
}

/// A tool call the model made, with its arguments already read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub arguments: Value,
}

/// A message as it goes to the model. Only the fields a request carries.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct WireMessage {
    pub role: String,
    pub content: String,
    /// An earlier reply's reasoning, sent back so the model keeps reasoning.
    pub thinking: Option<String>,
    pub images: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    /// Whatever the provider handed back with the reply, passed on as it was stored.
    pub provider_state: Option<Value>,
    /// The stored message's reference, sent to a provider so it can match turns. Never sent to the built-in engine.
    pub draggy_ref: Option<DraggyRef>,
}

/// Identifies a stored message to a provider, by its id and a hash of what it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraggyRef {
    pub id: String,
    pub hash: String,
}

/// Computes the reference of each message a provider turn carries. Hashing lives with the provider code.
pub trait MessageRefs {
    fn reference(&mut self, message: &Message) -> DraggyRef;
}

impl WireMessage {
    pub fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.to_string(),
            content: content.into(),
            ..Self::default()
        }
    }
}

/// The result of a tool, or a refusal, as the model reads it back.
fn tool_message(call: &ToolCall, content: String) -> WireMessage {
    WireMessage {
        role: "tool".to_string(),
        content,
        tool_call_id: call.id.clone(),
        tool_name: Some(call.name.clone()),
        ..WireMessage::default()
    }
}

/// The metrics of one generation, as the speed line and the statistics page read them.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationMetrics {
    pub prompt_tokens: f64,
    pub response_tokens: f64,
    pub prompt_ms: f64,
    pub response_ms: f64,
    pub load_ms: f64,
    pub total_ms: f64,
    pub tokens_per_second: f64,
    pub time_to_first_token_ms: Option<f64>,
    pub context_window: f64,
    pub model: String,
    pub gpu_percent: Option<f64>,
    pub breakdown: Option<ContextBreakdown>,
}

/// The counts a finished generation reports. Durations are in nanoseconds, as the engine sends them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FinalCounts {
    pub done_reason: Option<String>,
    pub prompt_eval_count: f64,
    pub eval_count: f64,
    pub prompt_eval_duration_ns: f64,
    pub eval_duration_ns: f64,
    pub load_duration_ns: f64,
    pub total_duration_ns: f64,
}

/// `readMetrics`: the figures of one generation, or none when the engine reported nothing.
pub fn read_metrics(
    counts: &FinalCounts,
    model: &str,
    context_window: f64,
    time_to_first_token_ms: Option<f64>,
) -> Option<GenerationMetrics> {
    if counts.eval_count == 0.0 && counts.eval_duration_ns == 0.0 {
        return None;
    }
    let response_ms = counts.eval_duration_ns / NS_PER_MS;
    Some(GenerationMetrics {
        prompt_tokens: counts.prompt_eval_count,
        response_tokens: counts.eval_count,
        prompt_ms: counts.prompt_eval_duration_ns / NS_PER_MS,
        response_ms,
        load_ms: counts.load_duration_ns / NS_PER_MS,
        total_ms: counts.total_duration_ns / NS_PER_MS,
        tokens_per_second: rate(counts.eval_count, response_ms),
        time_to_first_token_ms,
        context_window,
        model: model.to_string(),
        gpu_percent: None,
        breakdown: None,
    })
}

const NS_PER_MS: f64 = 1_000_000.0;

fn rate(tokens: f64, ms: f64) -> f64 {
    if ms > 0.0 { tokens / ms * 1000.0 } else { 0.0 }
}

/// `mergeMetrics`: adds one generation's figures to the turn so far.
pub fn merge_metrics(
    earlier: Option<GenerationMetrics>,
    later: Option<GenerationMetrics>,
) -> Option<GenerationMetrics> {
    let (Some(a), Some(b)) = (earlier.as_ref(), later.as_ref()) else {
        return later.or(earlier);
    };
    let response_tokens = a.response_tokens + b.response_tokens;
    let response_ms = a.response_ms + b.response_ms;
    Some(GenerationMetrics {
        prompt_tokens: a.prompt_tokens.max(b.prompt_tokens),
        response_tokens,
        prompt_ms: a.prompt_ms + b.prompt_ms,
        response_ms,
        load_ms: a.load_ms.max(b.load_ms),
        total_ms: a.total_ms + b.total_ms,
        tokens_per_second: rate(response_tokens, response_ms),
        time_to_first_token_ms: a.time_to_first_token_ms.or(b.time_to_first_token_ms),
        context_window: a.context_window.max(b.context_window),
        model: a.model.clone(),
        gpu_percent: b.gpu_percent.or(a.gpu_percent),
        breakdown: None,
    })
}

/// A plan step's status, as the checklist marks it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanStatus {
    Todo,
    Doing,
    Done,
}

/// One step of a turn's plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanItem {
    pub id: String,
    pub text: String,
    pub status: PlanStatus,
}

/// How many steps are worth showing before a plan is just a wall.
pub const MAX_PLAN_ITEMS: usize = 20;

/// `parsePlan`: reads a checklist the model wrote. A list item counts even without brackets, since the model meant it.
pub fn parse_plan(text: &str) -> Vec<PlanItem> {
    let mut items: Vec<PlanItem> = Vec::new();
    for line in text
        .split('\n')
        .map(trim_js)
        .filter(|line| !line.is_empty())
    {
        if items.len() >= MAX_PLAN_ITEMS {
            break;
        }
        let without_bullet = strip_bullet(line);
        let (status, body) = match marked(without_bullet) {
            Some((mark, rest)) => (status_of(mark), trim_js(rest)),
            None => (PlanStatus::Todo, trim_js(without_bullet)),
        };
        if body.is_empty() {
            continue;
        }
        items.push(PlanItem {
            id: format!("step-{}", items.len() + 1),
            text: body.to_string(),
            status,
        });
    }

    // Exactly one step can be in hand at a time; a second "doing" is told back as a waiting step.
    let mut seen_doing = false;
    for item in &mut items {
        if item.status != PlanStatus::Doing {
            continue;
        }
        if seen_doing {
            item.status = PlanStatus::Todo;
        }
        seen_doing = true;
    }
    items
}

/// `^(?:[-*•]|\d+[.)])\s*` removed from the front of a line.
fn strip_bullet(line: &str) -> &str {
    if let Some(rest) = line.strip_prefix(['-', '*', '•']) {
        return trim_start_js(rest);
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && matches!(line.as_bytes().get(digits), Some(b'.' | b')')) {
        return trim_start_js(&line[digits + 1..]);
    }
    line
}

/// `^\[([^\]]*)\]\s*(.*)$`: the text inside the first brackets, and what follows them.
fn marked(line: &str) -> Option<(&str, &str)> {
    let inner = line.strip_prefix('[')?;
    let close = inner.find(']')?;
    let rest = trim_start_js(&inner[close + 1..]);
    // JS `.` stops at a line terminator, so one left in the rest makes the whole pattern miss.
    if rest.contains(['\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((&inner[..close], rest))
}

fn status_of(mark: &str) -> PlanStatus {
    match trim_js(mark).to_lowercase().as_str() {
        "x" | "done" => PlanStatus::Done,
        ">" | "-" | "doing" => PlanStatus::Doing,
        _ => PlanStatus::Todo,
    }
}

/// `renderPlan`: the checklist as text, one line per step.
pub fn render_plan(items: &[PlanItem]) -> String {
    items
        .iter()
        .map(|item| {
            let mark = match item.status {
                PlanStatus::Todo => "[ ]",
                PlanStatus::Doing => "[>]",
                PlanStatus::Done => "[x]",
            };
            format!("{mark} {}", item.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `samePlan`: the same texts in the same states, in the same order.
pub fn same_plan(left: &[PlanItem], right: &[PlanItem]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(a, b)| a.text == b.text && a.status == b.status)
}

/// `describeEdit`: what the model is told when the user changed the plan under it.
pub fn describe_edit(items: &[PlanItem]) -> String {
    if items.is_empty() {
        return "The user cleared the plan. Ask them what they want instead of carrying on with the old steps.".to_string();
    }
    format!(
        "The user edited the plan. It now reads:\n\n{}\n\nWork to this, not to the version you wrote. Mark a step done as you finish it.",
        render_plan(items)
    )
}

/// `describePlan`: what the model is told at the start of a turn that already has a plan.
pub fn describe_plan(items: &[PlanItem]) -> String {
    format!(
        "The plan for this task so far:\n\n{}\n\nCarry on from it. Call update_plan with the whole list whenever a step changes, and stop when every step is done.",
        render_plan(items)
    )
}

// ---------------------------------------------------------------------------------------------------------------
// Wire messages
// ---------------------------------------------------------------------------------------------------------------

/// `toWireMessage`: one stored message as the model reads it. Images are sent as bare base64; anything the model
/// cannot take is said in words, so it does not guess at what was attached.
pub fn to_wire_message(message: &Message, allow_images: bool, keep_thinking: bool) -> WireMessage {
    let mut content = message.content.clone();
    let mut images: Vec<String> = Vec::new();

    for attachment in message.attachments.iter().flatten() {
        let extension = attachment
            .name
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_lowercase();
        let is_image =
            attachment.kind.starts_with("image/") || IMAGE_EXTENSIONS.contains(&extension.as_str());

        if is_image && allow_images {
            let base64 = match attachment.content.find(',') {
                Some(comma) => &attachment.content[comma + 1..],
                None => attachment.content.as_str(),
            };
            let base64 = trim_js(base64);
            // Empty data makes the model reject the whole request, so say the image was not read.
            if base64.is_empty() {
                content.push_str(&format!(
                    "\n\n[Attached image: {}. The image data could not be read, so it was not sent.]",
                    attachment.name
                ));
            } else {
                images.push(base64.to_string());
            }
        } else if is_image {
            content.push_str(&format!(
                "\n\n[Attached image: {}. This model cannot read images, so describe the limitation instead of guessing its contents.]",
                attachment.name
            ));
        } else if attachment.kind.starts_with("video/") {
            content.push_str(&format!("\n\n[Attached Video: {}]", attachment.name));
        } else if !is_binary(&attachment.content) {
            content.push_str(&format!(
                "\n\n--- ATTACHED FILE: {} ---\n{}\n--- END ATTACHED FILE ---",
                attachment.name, attachment.content
            ));
        } else {
            content.push_str(&format!("\n\n[Attached Binary File: {}]", attachment.name));
        }
    }

    let thinking = if keep_thinking && message.role == "assistant" {
        let parts: Vec<&str> = message
            .steps
            .iter()
            .flatten()
            .filter(|step| step.kind == "thinking")
            .filter_map(|step| step.content.as_deref())
            .filter(|text| !trim_js(text).is_empty())
            .collect();
        parts.join("\n\n")
    } else {
        String::new()
    };

    let trimmed = trim_js(&content);
    WireMessage {
        role: message.role.clone(),
        content: if trimmed.is_empty() {
            " ".to_string()
        } else {
            trimmed.to_string()
        },
        thinking: (!thinking.is_empty()).then_some(thinking),
        images,
        provider_state: message.provider_state.clone().filter(is_truthy),
        ..WireMessage::default()
    }
}

/// `toWireMessage` keeps a provider state whenever it is truthy, of whatever shape the provider wrote.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|x| x != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `isBinary`: control characters, or a long string that is mostly non-ASCII. Data URLs are never binary.
pub fn is_binary(text: &str) -> bool {
    if text.is_empty() || text.starts_with("data:") {
        return false;
    }
    if text.chars().any(|c| {
        matches!(c, '\u{0}'..='\u{8}' | '\u{B}' | '\u{C}' | '\u{E}'..='\u{1F}' | '\u{7F}'..='\u{9F}' | '\u{FFFD}')
    }) {
        return true;
    }
    let units = utf16_len(text);
    if units > 50 {
        let non_ascii = text.encode_utf16().filter(|unit| *unit > 127).count();
        return non_ascii as f64 > units as f64 * 0.2;
    }
    false
}

/// `estimateChars`: what a request weighs on the wire, in UTF-16 units. Each image counts as a fixed allowance.
pub fn estimate_chars(messages: &[WireMessage], tool_chars: i64) -> i64 {
    tool_chars
        + messages
            .iter()
            .map(|message| {
                utf16_len(&message.content) as i64
                    + message
                        .thinking
                        .as_deref()
                        .map_or(0, |t| utf16_len(t) as i64)
                    + message.images.len() as i64 * MAX_IMAGE_CHARS
            })
            .sum::<i64>()
}

/// Keeps a provider's state only on messages bound for that provider, as `scopeToTarget` does.
pub fn scope_to_target(messages: &[WireMessage], model: &str) -> Vec<WireMessage> {
    let instance = provider_of(model);
    messages
        .iter()
        .map(|message| {
            let mut kept = message.clone();
            // As `scopeToTarget` reads it, a state with no string instance id belongs to no provider.
            if let Some(state) = &message.provider_state {
                let owner = match state.get("instanceId") {
                    Some(Value::String(id)) => Some(id.as_str()),
                    _ => None,
                };
                if owner.is_none() || owner != instance {
                    kept.provider_state = None;
                }
            }
            // A reference means something only to a provider; the built-in engine never sees one.
            if instance.is_none() {
                kept.draggy_ref = None;
            }
            kept
        })
        .collect()
}

/// `isRemote`: a provider's model is named `@instance/model`; anything else runs on the built-in engine.
pub fn is_remote(model: &str) -> bool {
    model.starts_with('@')
}

/// `providerOf`: the instance a provider's model belongs to, or none for the built-in engine.
pub fn provider_of(model: &str) -> Option<&str> {
    let rest = model.strip_prefix('@')?;
    Some(rest.split('/').next().unwrap_or(rest))
}

// ---------------------------------------------------------------------------------------------------------------
// Requests, chunks and the traits a turn runs through
// ---------------------------------------------------------------------------------------------------------------

/// What the loop asks the model for on each pass. The client turns it into its own request body.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub num_ctx: i64,
    pub messages: Vec<WireMessage>,
    /// `None` when the model is sent no tool schemas at all; `Some(vec![])` when it is sent an empty list.
    pub tools: Option<Vec<ToolDefinition>>,
    /// `None` for a model without a thinking capability, which is sent no thinking option.
    pub think: Option<bool>,
    /// Only a provider takes a level; the built-in engine's body stays as it was.
    pub thinking_level: Option<String>,
}

/// A one-off repair of a broken text tool call, constrained to a schema.
#[derive(Debug, Clone, PartialEq)]
pub struct RepairRequest {
    pub model: String,
    pub schema: Value,
    pub messages: Vec<WireMessage>,
}

/// A tool call whose arguments are still arriving, as the engine reports it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StreamingCall {
    pub id: Option<String>,
    pub name: String,
    pub args_string: String,
}

/// A delta on a native tool call: the name, id or argument text that just arrived.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ToolCallDelta {
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// A provider's wait before its next attempt, shown as a countdown.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Retry {
    pub attempt: u32,
    pub of: u32,
    pub retry_after_ms: f64,
}

/// One parsed item of a model's stream. A chunk can carry text, reasoning, tool data and the final counts together.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ModelChunk {
    pub content: String,
    pub thinking: String,
    pub tool_calls: Vec<ToolCall>,
    pub streaming_calls: Option<Vec<StreamingCall>>,
    pub tool_call_deltas: Vec<ToolCallDelta>,
    pub done: Option<FinalCounts>,
    pub provider_state: Option<ProviderState>,
    pub retry: Option<Retry>,
    /// A failure the provider reports after the stream has opened, already worded for the user.
    pub error: Option<String>,
}

/// A stream of chunks. Dropping it stops the generation.
pub type ChunkStream = Box<dyn Iterator<Item = Result<ModelChunk, TurnError>>>;

/// Why a turn failed. Stopping a turn is not an error; it returns an aborted result.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TurnError {
    /// The built-in engine could not be started for this model.
    #[error("{0}")]
    Engine(String),
    /// The model or its provider failed, with the message to show.
    #[error("{0}")]
    Model(String),
}

/// Millisecond time as the turn needs it: for durations, the throttles and the countdown of a retry.
pub trait Clock {
    fn now_ms(&self) -> f64;
}

/// Source of step ids. Injected so a test sees the same ids every run.
pub trait IdSource {
    fn next_id(&mut self) -> String;
}

/// The model, reached through whatever transport the shell uses.
pub trait ModelClient {
    /// Starts one generation. Errors here are failures before any text arrived.
    fn stream(&mut self, request: ChatRequest) -> Result<ChunkStream, TurnError>;
    /// The reply to a repair request, or `None` when the repair itself failed.
    fn repair(&mut self, request: RepairRequest) -> Option<String>;
}

/// The engine that holds the model in memory. Window sizing and loading live behind it.
pub trait Engine {
    /// The window a request of this many characters should ask for.
    fn context_size(
        &mut self,
        model: &str,
        chars: i64,
        max_context: Option<i64>,
        fixed: Option<FixedContext>,
    ) -> i64;
    /// Whether the model is loaded at this window: `Some(false)` means a load is needed; `None` means unknown.
    fn is_loaded_at(&mut self, model: &str, num_ctx: i64) -> Option<bool>;
    /// Starts the engine for the model. `exact` is set when the user fixed the window.
    fn start(&mut self, model: &str, num_ctx: i64, exact: bool) -> Result<(), String>;
    /// How much of the model sits on the GPU, when the engine can say.
    fn gpu_percent(&mut self, model: &str) -> Option<f64>;
}

/// A window the user fixed in settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedContext {
    Tokens(i64),
    /// The model's own maximum.
    Max,
}

/// What a tool can see and change while it runs.
pub struct ToolContext<'a> {
    /// The timeline. A tool pushes or patches its own steps here.
    pub steps: &'a mut Vec<SearchStep>,
    pub ids: &'a mut dyn IdSource,
    pub cancel: &'a CancelToken,
    /// Set by a tool that rewrites the plan; the loop reports it to the host and remembers it as seen.
    pub plan: Option<Vec<PlanItem>>,
}

impl ToolContext<'_> {
    /// A fresh id for a step the tool is about to push.
    pub fn new_id(&mut self) -> String {
        self.ids.next_id()
    }
}

/// The tools the turn may run. Definitions travel with the request; this trait runs them.
pub trait ToolRuntime {
    /// What a tool can do to the world. An unknown tool reads as the cautious answer.
    fn annotations(&self, name: &str) -> ToolAnnotations;
    /// Runs one tool and returns what the model reads back. An unknown name returns a message, not an error.
    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String;
}

/// What the loop asks of the person driving the turn, and tells them immediately rather than in a batch.
pub trait TurnHost {
    /// The text for a key, in the user's language.
    fn text(&self, key: &str) -> String;
    /// Whether anyone can answer an approval. Without someone to ask, a call that needs an answer is refused.
    fn can_ask(&self) -> bool;
    /// Puts a call to the user and waits for the answer. `None` only when nobody is there to answer.
    fn request_approval(&mut self, request: &ApprovalRequest) -> Option<ApprovalAnswer>;
    /// A permission the user wants kept for the workspace, not just this task.
    fn on_grant(&mut self, grant: &Grant);
    /// The plan as the host holds it now, so the loop catches up on the user's edits.
    fn get_plan(&mut self) -> Option<Vec<PlanItem>>;
    /// A plan the model wrote, so the host shows it at once.
    fn on_plan(&mut self, items: &[PlanItem]);
}

/// A call waiting for an answer.
#[derive(Debug, Clone, PartialEq)]
pub struct ApprovalRequest {
    pub id: String,
    pub tool: String,
    pub target: Option<String>,
    /// Why this needs an answer, in the permission engine's words.
    pub reason: String,
}

/// The timeline and the reply as they stand. Sent as a whole, so a later snapshot replaces an earlier one.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AgentPatch {
    pub content: String,
    pub text_content: String,
    pub steps: Vec<SearchStep>,
}

/// One thing the observer is told. Each one is a snapshot of the state it describes.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnEvent {
    Patch(AgentPatch),
    Steps(Vec<SearchStep>),
    OutOfContext(bool),
    Metrics(GenerationMetrics),
    Live(LiveTurn),
}

impl TurnEvent {
    fn same_kind(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

/// Receives batches of events. A batch holds the latest snapshot of each kind, in the order they last changed.
pub trait TurnObserver {
    fn on_events(&mut self, events: &[TurnEvent]);
}

/// Delivers events at most once per interval: the first at once, then the latest of each kind when the interval has
/// passed. Whatever waits is handed over by the next event, or by `flush` when the turn ends.
#[derive(Debug, Clone)]
pub struct Batcher {
    interval_ms: f64,
    pending: Vec<TurnEvent>,
    last_delivered: Option<f64>,
}

/// `16 ms` is one frame: a burst of tokens reaches the screen as one update.
pub const BATCH_INTERVAL_MS: f64 = 16.0;

impl Batcher {
    pub fn new(interval_ms: f64) -> Self {
        Self {
            interval_ms,
            pending: Vec::new(),
            last_delivered: None,
        }
    }

    /// Queues an event at `now`. Returns a batch when the interval has passed since the last one was handed over.
    pub fn push(&mut self, event: TurnEvent, now: f64) -> Option<Vec<TurnEvent>> {
        if let Some(position) = self.pending.iter().position(|kept| kept.same_kind(&event)) {
            self.pending.remove(position);
        }
        self.pending.push(event);
        let due = self
            .last_delivered
            .is_none_or(|at| now - at >= self.interval_ms);
        if due {
            return self.flush(now);
        }
        None
    }

    /// Takes whatever is queued, if anything, and starts the next interval at `now`.
    pub fn flush(&mut self, now: f64) -> Option<Vec<TurnEvent>> {
        if self.pending.is_empty() {
            return None;
        }
        self.last_delivered = Some(now);
        Some(std::mem::take(&mut self.pending))
    }
}

/// The permission a turn runs under, and what the user has already allowed.
#[derive(Debug, Clone, PartialEq)]
pub struct Permission {
    pub mode: PermissionMode,
    pub grants: Vec<Grant>,
}

/// The context the last pass ended at, as the model counted it. The meter starts from it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContextBase {
    pub tokens: f64,
    pub chars: i64,
}

/// How the model is reached and what it can do. The shell works this out from the model's probe.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelProfile {
    pub model: String,
    pub tool_access: ToolAccess,
    /// Whether the probe answered at all. A model it could not reach keeps the thinking setting it was asked for.
    pub probed: bool,
    pub has_thinking: bool,
    /// Whether the settings allow reasoning for this model at all.
    pub thinking_allowed: bool,
    pub native_vision: bool,
    pub prompt_profile: PromptProfile,
    /// The most passes a turn may make.
    pub loop_limit: usize,
    /// The largest window the model reports, when it reports one.
    pub max_context: Option<i64>,
    pub fixed_context: Option<FixedContext>,
}

/// How a model may call tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAccess {
    /// The model calls tools natively.
    Native,
    /// The model writes its calls as text, in the prompt's format.
    Text,
    /// The model cannot call tools; it is given none and told web access is off.
    Unavailable,
}

/// Everything a turn is started with.
#[derive(Debug, Clone)]
pub struct TurnRequest {
    pub profile: ModelProfile,
    /// The workspace the skills and their loaded instructions belong to; empty reads as the default one.
    pub workspace_id: String,
    pub settings: PromptSettings,
    pub environment: PromptEnvironment,
    /// The tools offered to a model that calls them natively, and the schema of a repair.
    pub tools: Vec<ToolDefinition>,
    /// The tools listed in the prompt for a model that writes its calls as text.
    pub prompt_tools: Vec<PromptTool>,
    pub memory: Option<ProjectMemory>,
    /// The skills on the shelf. A turn offers the ones switched on for its side, Code when there is a folder.
    pub skills: Vec<InstalledSkill>,
    /// The date, already formatted for the user's locale.
    pub date: String,
    /// The clock, already formatted; it goes on the last user message, not in the system prompt.
    pub now: String,
    pub messages: Vec<Message>,
    pub is_continuation: bool,
    pub seed: Option<Seed>,
    pub compaction: Option<CompactionState>,
    pub permission: Option<Permission>,
    pub context_base: Option<ContextBase>,
}

/// The time notes a conversation has already stamped, by message id. A stamp stays put so the cached prefix holds.
/// The reference keeps one map for the whole app; message ids are unique, so one per conversation reads the same.
#[derive(Debug, Clone, Default)]
pub struct TailNotes(HashMap<String, String>);

/// What one turn produced when it ends.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AgentResult {
    pub content: String,
    pub text_content: String,
    pub steps: Vec<SearchStep>,
    pub metrics: Option<GenerationMetrics>,
    pub out_of_context: bool,
    pub loops: usize,
    pub exhausted: bool,
    pub aborted: bool,
    /// How many times the model reached for each tool, refused calls included.
    pub tool_calls: BTreeMap<String, u32>,
    /// The last provider state handed back, stored on the reply for its next turn.
    pub provider_state: Option<ProviderState>,
}

/// The parts of the outside world a turn uses. Each is a borrow, so the shell keeps ownership of its own objects.
pub struct Ports<'a> {
    pub model: &'a mut dyn ModelClient,
    pub engine: &'a mut dyn Engine,
    pub skills: &'a mut dyn SkillReader,
    pub tools: &'a mut dyn ToolRuntime,
    pub host: &'a mut dyn TurnHost,
    pub observer: &'a mut dyn TurnObserver,
    pub refs: &'a mut dyn MessageRefs,
    pub ids: &'a mut dyn IdSource,
    pub clock: &'a dyn Clock,
    pub cancel: &'a CancelToken,
}

// ---------------------------------------------------------------------------------------------------------------
// Preparing the turn
// ---------------------------------------------------------------------------------------------------------------

/// Everything a turn sends before the model says a word, worked out once from the request.
#[derive(Debug, Clone)]
pub struct PreparedTurn {
    pub system: String,
    pub wire: Vec<WireMessage>,
    pub definitions: Vec<ToolDefinition>,
    pub native_tools: bool,
    pub native_thinking: bool,
    pub has_thinking: bool,
    pub clean_stream: bool,
    pub settings: PromptSettings,
    /// The level the turn runs at, after the rules in [`effective_effort`] have applied.
    pub effective_effort: Effort,
    pub prompt_parts: PromptParts,
    pub tool_chars: i64,
    /// The skill the last message started with a slash command, once its instructions are loaded.
    pub invoked_skill: Option<InvokedSkill>,
}

/// A skill a slash command started, by the id and name the context view shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvokedSkill {
    pub id: String,
    pub name: String,
}

/// `prepareTurn`: the system prompt, the tools and the wire for one turn. Time-stamps the last user message and keeps
/// the stamps of earlier ones in `tail_notes`, so the prefix a local engine cached is not disturbed.
pub fn prepare_turn(
    request: &TurnRequest,
    tail_notes: &mut TailNotes,
    refs: &mut dyn MessageRefs,
    skill_reader: &mut dyn SkillReader,
) -> PreparedTurn {
    let profile = &request.profile;
    let remote = is_remote(&profile.model);
    let unavailable = profile.tool_access == ToolAccess::Unavailable;

    // A model that cannot think is run as if thinking were off. A probe that got no answer proves nothing, so the setting stands.
    let surface = if request.environment.has_folder { Surface::Code } else { Surface::Chat };
    let outcome = effective_effort(EffortInput {
        asked: request.settings.effort,
        surface,
        allow_max_in_chat: request.settings.allow_max_in_chat,
        can_think: profile.probed.then_some(profile.has_thinking),
        supported: None,
        // A slow model does not think until the settings allow it.
        slow_blocks_thinking: !profile.thinking_allowed,
    });
    let sent = outcome.sent;
    let native_tools = profile.tool_access == ToolAccess::Native;
    let native_thinking = profile.has_thinking && sent.is_thinking();
    let clean_stream = native_tools && native_thinking;

    // A model that cannot call tools is offered none, is told web access is off, and loses the prompt sections that
    // describe its tools. The folder stays, since its rules are still text.
    let mut settings = request.settings.clone();
    settings.effort = sent;
    if unavailable {
        settings.web_mode = WebMode::Off;
    }
    let environment = if unavailable {
        without_tools(&request.environment)
    } else {
        request.environment.clone()
    };
    // The side follows the folder, as the reference's loadSkills does. Skills are read only where the environment has them.
    let side = if environment.has_folder {
        Side::Code
    } else {
        Side::Chat
    };
    let offered: Vec<PromptSkill> = if environment.has_skills {
        skills_for(&request.skills, side)
            .into_iter()
            .map(PromptSkill::from)
            .collect()
    } else {
        Vec::new()
    };
    let definitions = if unavailable {
        Vec::new()
    } else {
        request.tools.clone()
    };
    let prompt_tools: Vec<PromptTool> = if unavailable {
        Vec::new()
    } else {
        request.prompt_tools.clone()
    };

    // The skills a conversation loaded stay in the system prompt. A skill that cannot be read is left out.
    let workspace = if request.workspace_id.is_empty() {
        DEFAULT_WORKSPACE
    } else {
        request.workspace_id.as_str()
    };
    let loaded_ids = loaded_skill_ids(&request.messages, &offered);
    let loaded: Vec<LoadedSkill> = loaded_ids
        .iter()
        .filter_map(|id| skill_reader.read(workspace, id))
        .collect();
    let loaded_section = render_loaded_skills(&loaded);

    // "/code-review src/app.ts" starts that skill with the message, as a slash command should.
    let invoked = match request.messages.last() {
        Some(last) if !request.is_continuation && last.role == "user" => {
            skill_invocation(&last.content, &offered)
                .map(|found| (found.skill.clone(), found.request.to_string()))
        }
        _ => None,
    };
    let invoked = invoked.filter(|(skill, _)| loaded.iter().any(|one| one.id == skill.id));
    let skill_tail = invoked
        .as_ref()
        .map(|(skill, request)| render_invoked_skill(skill, request));

    let mut system = build_system_prompt(&SystemPromptInput {
        settings: &settings,
        mode: PromptMode {
            native_tools,
            native_thinking,
            profile: Some(profile.prompt_profile),
        },
        environment: &environment,
        tools: &prompt_tools,
        date: &request.date,
        memory: request.memory.as_ref(),
        skills: &offered,
    });
    if !loaded_section.is_empty() {
        system.push_str("\n\n");
        system.push_str(&loaded_section);
    }

    let wire = build_wire(
        request,
        &system,
        native_thinking,
        remote,
        skill_tail.as_deref(),
        tail_notes,
        refs,
    );

    // What the fixed parts of the prompt cost, so the context view can say where the window went.
    let tool_chars = if native_tools {
        serde_json::to_string(&definitions).map_or(0, |text| utf16_len(&text) as i64)
    } else {
        0
    };
    let catalogue_chars = if native_tools {
        0
    } else {
        utf16_len(&describe_tools_for_prompt(&prompt_tools)) as i64
    };
    let memory_chars = request
        .memory
        .as_ref()
        .map_or(0, |memory| utf16_len(&render_memory(memory)) as i64);
    let skill_chars = utf16_len(&describe_skills(&offered)) as i64;
    let loaded_skill_chars = utf16_len(&loaded_section) as i64;
    let summary_chars = request
        .compaction
        .as_ref()
        .map_or(0, |state| utf16_len(&render_compaction_block(state)) as i64);
    let prompt_parts = PromptParts {
        system_chars: (utf16_len(&system) as i64
            - memory_chars
            - skill_chars
            - loaded_skill_chars
            - catalogue_chars)
            .max(0),
        tool_chars: if native_tools {
            tool_chars
        } else {
            catalogue_chars
        },
        memory_chars,
        skill_chars,
        summary_chars,
        loaded_skill_chars: Some(loaded_skill_chars),
        loaded_skills: Some(
            loaded
                .iter()
                .map(|skill| LoadedSkillPart {
                    id: skill.id.clone(),
                    name: skill.name.clone(),
                    chars: utf16_len(&render_skill(skill)) as i64,
                })
                .collect(),
        ),
        tool_count: Some(definitions.len() as i64),
        skill_count: Some(
            offered
                .iter()
                .filter(|skill| skill.model_invocable != Some(false))
                .count()
                .min(MAX_LISTED_SKILLS) as i64,
        ),
    };

    PreparedTurn {
        system,
        wire,
        definitions,
        native_tools,
        native_thinking,
        has_thinking: profile.has_thinking,
        clean_stream,
        settings,
        effective_effort: sent,
        prompt_parts,
        tool_chars,
        invoked_skill: invoked.map(|(skill, _)| InvokedSkill {
            id: skill.id,
            name: skill.name,
        }),
    }
}

/// `withoutTools`: the environment as a model that cannot call tools sees it. Library and code execution are off.
fn without_tools(environment: &PromptEnvironment) -> PromptEnvironment {
    PromptEnvironment {
        library_ready: false,
        code_execution: false,
        has_skills: false,
        ..environment.clone()
    }
}

/// The wire for a turn: the system prompt, any folded summary, the messages it carries, and on a continuation the
/// rebuilt work and the instruction to carry on. The last user message gets the clock, and a slash command's note.
fn build_wire(
    request: &TurnRequest,
    system: &str,
    native_thinking: bool,
    remote: bool,
    skill_tail: Option<&str>,
    tail_notes: &mut TailNotes,
    refs: &mut dyn MessageRefs,
) -> Vec<WireMessage> {
    let profile = &request.profile;
    let messages = &request.messages;

    // A continuation's half-written reply moves to the very end, where the model completes it.
    let history: &[Message] = match messages.last() {
        Some(last) if request.is_continuation && last.role == "assistant" => {
            &messages[..messages.len() - 1]
        }
        _ => messages,
    };

    // Messages a summary covers are not sent again, unless the summary claims more than the conversation has.
    let compaction = request
        .compaction
        .as_ref()
        .filter(|state| state.through_index < history.len());
    let carried: &[Message] = match compaction {
        Some(state) => &history[state.through_index..],
        None => history,
    };

    let mut wire = vec![WireMessage::text("system", system)];
    if let Some(state) = compaction {
        wire.push(WireMessage::text("user", render_compaction_block(state)));
    }
    let offset = wire.len();
    for message in carried {
        let mut entry = to_wire_message(message, profile.native_vision, native_thinking);
        if remote {
            entry.draggy_ref = Some(refs.reference(message));
        }
        wire.push(entry);
    }

    for note in unsendable_notes(&wire) {
        match note {
            Unsendable::UnknownRole { role } => {
                warn!(target: "agent.loop", role = role.as_str(), "history message with an unknown role");
            }
            Unsendable::OrphanToolResult { has_call_id } => {
                warn!(target: "agent.loop", has_call_id, "tool result without a call");
            }
        }
    }

    if request.is_continuation {
        // Tool results only lived inside the cut-off turn, so what was done is rebuilt from the steps that survived.
        if let Some(resume) = request
            .seed
            .as_ref()
            .and_then(|seed| build_resume_message(&seed.steps))
        {
            wire.push(WireMessage::text("user", resume));
        }
        wire.push(WireMessage::text("user", CONTINUE_PROMPT));
        let prefill = request
            .seed
            .as_ref()
            .map_or("", |seed| seed.text_content.as_str());
        if !prefill.is_empty() {
            wire.push(WireMessage::text("assistant", prefill));
        }
    }

    // The clock goes on the last user message. Earlier stamps are kept, so their text does not change between turns.
    let last_user = wire.iter().rposition(|entry| entry.role == "user");
    let stamp_tails = !remote;
    for (index, entry) in wire.iter_mut().enumerate() {
        if entry.role != "user" {
            continue;
        }
        let key = (index >= offset)
            .then(|| carried.get(index - offset))
            .flatten()
            .map_or_else(|| index.to_string(), |message| message_key(message, index));
        let mut tail = if stamp_tails {
            tail_notes.0.get(&key).cloned()
        } else {
            None
        };
        if tail.is_none() && last_user == Some(index) {
            let note = current_time_note(&request.now);
            let fresh = match skill_tail {
                Some(skill) => format!("\n\n{skill}\n\n{note}"),
                None => format!("\n\n{note}"),
            };
            if stamp_tails {
                tail_notes.0.insert(key, fresh.clone());
            }
            tail = Some(fresh);
        }
        if let Some(tail) = tail {
            entry.content.push_str(&tail);
        }
    }

    wire
}

/// The key a message's time note is kept under: its id, or its wire index when the id is empty.
fn message_key(message: &Message, index: usize) -> String {
    if message.id.is_empty() {
        index.to_string()
    } else {
        message.id.clone()
    }
}

/// A history entry the engine would skip. Only ids and roles are reported, never the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unsendable {
    UnknownRole { role: String },
    OrphanToolResult { has_call_id: bool },
}

/// Finds the history entries that cannot be sent as they are.
pub fn unsendable_notes(wire: &[WireMessage]) -> Vec<Unsendable> {
    let mut notes = Vec::new();
    let mut known_calls: Vec<&str> = Vec::new();
    for entry in wire {
        // An empty id is no id: the reference adds only truthy ones.
        known_calls.extend(
            entry
                .tool_calls
                .iter()
                .filter_map(|call| call.id.as_deref())
                .filter(|id| !id.is_empty()),
        );
        match entry.role.as_str() {
            "system" | "user" | "assistant" => {}
            "tool" => {
                let has_call_id = entry
                    .tool_call_id
                    .as_deref()
                    .is_some_and(|id| !id.is_empty());
                let answers_a_call = entry
                    .tool_call_id
                    .as_deref()
                    .is_some_and(|id| known_calls.contains(&id));
                if !answers_a_call {
                    notes.push(Unsendable::OrphanToolResult { has_call_id });
                }
            }
            other => notes.push(Unsendable::UnknownRole {
                role: other.to_string(),
            }),
        }
    }
    notes
}

// ---------------------------------------------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------------------------------------------

/// Runs one agent turn to its end: passes through the model until it answers, asks for nothing more, runs out of
/// passes, or is stopped. `tail_notes` is the conversation's own, kept across its turns.
pub fn run_turn(
    request: &TurnRequest,
    tail_notes: &mut TailNotes,
    ports: Ports<'_>,
) -> Result<AgentResult, TurnError> {
    let prepared = prepare_turn(request, tail_notes, &mut *ports.refs, &mut *ports.skills);
    let names: Vec<&str> = prepared
        .definitions
        .iter()
        .map(|definition| definition.function.name.as_str())
        .collect();
    let parser = ToolParser::new(&names).map_err(|error| TurnError::Model(error.to_string()))?;
    let mut turn = Turn::new(request, prepared, parser, ports);
    turn.run()
}

/// Per-pass state: the steps this pass owns and what has streamed in so far.
#[derive(Debug, Default)]
struct Pass {
    think_step_id: String,
    think_start: Option<f64>,
    thought_time: Option<f64>,
    first_token_at: Option<f64>,
    text_step_id: Option<String>,
    load_step_id: Option<String>,
    loading: bool,
    retry_step_id: Option<String>,
    file_step_id: Option<String>,
    raw: String,
    thinking_text: String,
    current_thought: String,
    text_content: String,
    tool_match: Option<String>,
    maybe_tool_call: bool,
    native_calls: Vec<ToolCall>,
    pass_chunks: u64,
    last_streaming_len: usize,
    final_counts: Option<FinalCounts>,
    pass_state: Option<ProviderState>,
    request_start: f64,
    last_update: f64,
    last_emitted: Option<usize>,
}

/// The state of one turn while it runs.
struct Turn<'a> {
    model: String,
    remote: bool,
    loop_limit: usize,
    max_context: Option<i64>,
    fixed_context: Option<FixedContext>,
    ports: Ports<'a>,
    parser: ToolParser,
    prepared: PreparedTurn,
    mode: PermissionMode,
    grants: Vec<Grant>,
    wire: Vec<WireMessage>,
    steps: Vec<SearchStep>,
    events: Batcher,
    is_continuation: bool,
    last_seen_plan: Option<Vec<PlanItem>>,
    tool_calls: BTreeMap<String, u32>,
    repairs_left: u32,
    checkpoint: Option<ContextBase>,
    finished_tokens: f64,
    tokens_per_chunk: f64,
    live_rate: f64,
    live_at: Option<f64>,
    num_ctx: i64,
    full_content: String,
    full_text: String,
    last_thought: String,
    last_tool_result: String,
    answer_asked: bool,
    action_asked: bool,
    tools_ran: bool,
    turn_state: Option<ProviderState>,
    out_of_context: bool,
    metrics: Option<GenerationMetrics>,
    loop_count: usize,
    finished: bool,
    aborted: bool,
    patch_miss_logged: bool,
}

impl<'a> Turn<'a> {
    fn new(
        request: &TurnRequest,
        prepared: PreparedTurn,
        parser: ToolParser,
        ports: Ports<'a>,
    ) -> Self {
        let (mode, grants) = match &request.permission {
            Some(permission) => (permission.mode, permission.grants.clone()),
            None => (PermissionMode::Auto, Vec::new()),
        };
        let steps = request
            .seed
            .as_ref()
            .map_or_else(Vec::new, |seed| seed.steps.clone());
        let full_content = request
            .seed
            .as_ref()
            .map_or_else(String::new, |seed| seed.content.clone());
        let full_text = request
            .seed
            .as_ref()
            .map_or_else(String::new, |seed| seed.text_content.clone());
        Self {
            model: request.profile.model.clone(),
            remote: is_remote(&request.profile.model),
            loop_limit: request.profile.loop_limit,
            max_context: request.profile.max_context,
            fixed_context: request.profile.fixed_context,
            wire: prepared.wire.clone(),
            prepared,
            ports,
            parser,
            mode,
            grants,
            steps,
            events: Batcher::new(BATCH_INTERVAL_MS),
            is_continuation: request.is_continuation,
            last_seen_plan: None,
            tool_calls: BTreeMap::new(),
            repairs_left: 1,
            checkpoint: request.context_base,
            finished_tokens: 0.0,
            tokens_per_chunk: 1.0,
            live_rate: 0.0,
            live_at: None,
            num_ctx: 0,
            full_content,
            full_text,
            last_thought: String::new(),
            last_tool_result: String::new(),
            answer_asked: false,
            action_asked: false,
            tools_ran: false,
            turn_state: None,
            out_of_context: false,
            metrics: None,
            loop_count: 0,
            finished: false,
            aborted: false,
            patch_miss_logged: false,
        }
    }

    fn run(&mut self) -> Result<AgentResult, TurnError> {
        debug!(target: "agent.loop", model = self.model.as_str(), steps = self.steps.len(), "turn start");
        let outcome = self.body();
        // Whatever the observer still has queued, including the metrics, is delivered before the turn returns.
        let now = self.ports.clock.now_ms();
        if let Some(batch) = self.events.flush(now) {
            self.ports.observer.on_events(&batch);
        }
        outcome
    }

    fn body(&mut self) -> Result<AgentResult, TurnError> {
        // A slash command's skill shows where it loaded, as one the model asked for does.
        if let Some(invoked) = self.prepared.invoked_skill.clone() {
            let id = self.next_id();
            let content = format!("{} **{}**", self.ports.host.text("usedSkill"), invoked.name);
            let mut entry = step(&id, "skill", &content, true);
            entry.extra.insert("skill".to_string(), json!(invoked.id));
            self.push_step(entry);
        }

        self.passes()?;

        if self.aborted {
            self.finish_incomplete_steps();
            self.patch_now();
            return Ok(self.result(false));
        }

        let exhausted = !self.finished && self.loop_count >= self.loop_limit;
        if exhausted {
            for step in &mut self.steps {
                if step.is_complete != Some(true) {
                    step.is_complete = Some(true);
                }
            }
            if self.full_text.is_empty() {
                self.full_text = EXHAUSTED_MESSAGE.to_string();
            }
            self.sync_steps();
        } else if trim_js(&self.full_text).is_empty() && !self.ports.cancel.is_aborted() {
            // A blank bubble reads as a crash; the thought, or failing that the tool output, beats it.
            self.full_text = if !trim_js(&self.last_thought).is_empty() {
                trim_js(&self.last_thought).to_string()
            } else {
                prefix_units(trim_js(&self.last_tool_result), FALLBACK_RESULT_UNITS).to_string()
            };
        }

        if !self.ports.cancel.is_aborted() {
            self.patch_now();
        }

        if let Some(metrics) = self.metrics.clone() {
            let gpu = self.ports.engine.gpu_percent(&self.model);
            // As the reference does, no conversation size is passed: an unmeasured turn reads as zero messages.
            let breakdown = measure_breakdown(
                &self.prepared.prompt_parts,
                (metrics.prompt_tokens + metrics.response_tokens) as i64,
                0,
            );
            let metrics = GenerationMetrics {
                gpu_percent: gpu,
                breakdown: Some(breakdown),
                ..metrics
            };
            self.metrics = Some(metrics.clone());
            self.emit(TurnEvent::Metrics(metrics));
        }

        debug!(target: "agent.loop", loops = self.loop_count, exhausted, out_of_context = self.out_of_context, "turn complete");
        Ok(self.result(exhausted))
    }

    fn passes(&mut self) -> Result<(), TurnError> {
        while !self.finished && self.loop_count < self.loop_limit {
            if self.ports.cancel.is_aborted() {
                self.aborted = true;
                return Ok(());
            }
            self.loop_count += 1;
            self.catch_up_on_plan();

            let mut pass = Pass {
                think_step_id: self.next_id(),
                ..Pass::default()
            };
            self.push_step(step(&pass.think_step_id, "thinking", "", false));

            self.num_ctx = self.ports.engine.context_size(
                &self.model,
                estimate_chars(&self.wire, self.tool_chars()),
                self.max_context,
                self.fixed_context,
            );
            self.emit_live(0, None, false);

            // The long silence before the first token is a load; it gets its own step so it is not mistaken for a stall.
            if !self.remote
                && self.ports.engine.is_loaded_at(&self.model, self.num_ctx) == Some(false)
            {
                let load_id = self.next_id();
                let content = self
                    .ports
                    .host
                    .text("loadingModel")
                    .replace("{model}", &self.model)
                    .replace("{seconds}", "0.0");
                let mut loading = step(&load_id, "loading", &content, false);
                loading
                    .extra
                    .insert("model".into(), json!(self.model.clone()));
                loading
                    .extra
                    .insert("startedAt".into(), json!(self.ports.clock.now_ms()));
                self.push_step(loading);
                pass.load_step_id = Some(load_id);
                pass.loading = true;
            }

            let result = self.pass(&mut pass);
            self.done_loading(&mut pass);
            result?;
            if self.aborted {
                return Ok(());
            }
        }
        Ok(())
    }

    fn pass(&mut self, pass: &mut Pass) -> Result<(), TurnError> {
        if !self.remote {
            let exact = matches!(self.fixed_context, Some(FixedContext::Tokens(_)));
            self.ports
                .engine
                .start(&self.model, self.num_ctx, exact)
                .map_err(TurnError::Engine)?;
        }

        let request = ChatRequest {
            model: self.model.clone(),
            num_ctx: self.num_ctx,
            messages: scope_to_target(&self.wire, &self.model),
            tools: self
                .prepared
                .native_tools
                .then(|| self.prepared.definitions.clone()),
            think: self
                .prepared
                .has_thinking
                .then_some(self.prepared.native_thinking),
            thinking_level: (self.remote && self.prepared.has_thinking)
                .then(|| self.prepared.effective_effort.name().to_string()),
        };
        pass.request_start = self.ports.clock.now_ms();
        let mut stream = self.ports.model.stream(request)?;
        self.read_stream(pass, stream.as_mut())?;
        drop(stream);
        if let Some(state) = pass.pass_state.clone() {
            self.turn_state = Some(state);
        }

        if self.ports.cancel.is_aborted() {
            // The stop came mid-stream: keep what was written as the reply, or the saved turn is blank.
            self.stop_mid_pass(pass);
            return Ok(());
        }

        self.account_for_pass(pass);

        let current = if self.prepared.native_thinking {
            pass.thinking_text.clone()
        } else {
            extract_thought(&pass.raw).map_or_else(|| pass.current_thought.clone(), str::to_string)
        };
        pass.current_thought = current;
        if !self.prepared.native_tools && pass.tool_match.is_none() {
            pass.tool_match = self.parser.detect(&pass.raw);
        }
        let post = detect_repetition(&pass.raw);
        if post.has_loop {
            pass.raw = post.trimmed_text;
        }
        pass.text_content = self.clean_text(&pass.raw);

        // A reply that was trying to be a tool call and came out mangled gets one constrained retry.
        if !self.prepared.native_tools
            && pass.tool_match.is_none()
            && looks_like_call(&pass.raw, &self.tool_names())
        {
            let repaired = self.repair_call(&pass.raw.clone());
            if let Some(name) = repaired.name {
                pass.tool_match = Some(
                    json!({"name": name, "args": repaired.args.unwrap_or_else(|| json!({}))})
                        .to_string(),
                );
            }
        }

        let has_tool_call = if self.prepared.native_tools {
            !pass.native_calls.is_empty()
        } else {
            pass.tool_match.is_some()
        };

        if self.ports.cancel.is_aborted() {
            self.stop_mid_pass(pass);
            return Ok(());
        }

        if let Some(started) = pass.think_start
            && pass.thought_time.is_none()
        {
            pass.thought_time = Some((self.ports.clock.now_ms() - started) / 1000.0);
        }
        self.finish_thinking_step(pass);
        if !trim_js(&pass.current_thought).is_empty() {
            self.last_thought = pass.current_thought.clone();
        }
        self.emit(TurnEvent::OutOfContext(self.out_of_context));

        if !has_tool_call {
            self.answer_without_tools(pass);
            return Ok(());
        }

        self.call_tools(pass);
        if self.ports.cancel.is_aborted() {
            if let Some(id) = pass.text_step_id.take() {
                self.drop_step(&id);
            }
            self.finish_incomplete_steps();
            self.patch_now();
            self.aborted = true;
            return Ok(());
        }
        self.emit_live(0, None, false);
        Ok(())
    }

    /// Reads chunks as they arrive: text, reasoning, tool data and the counts, stopping early on a loop or a call.
    fn read_stream(
        &mut self,
        pass: &mut Pass,
        stream: &mut dyn Iterator<Item = Result<ModelChunk, TurnError>>,
    ) -> Result<(), TurnError> {
        for item in stream {
            if self.ports.cancel.is_aborted() {
                break;
            }
            let chunk = item?;
            if let Some(error) = chunk.error.as_ref() {
                return Err(TurnError::Model(error.clone()));
            }
            if let Some(retry) = chunk.retry {
                self.show_retry(pass, retry);
                continue;
            }
            self.done_loading(pass);

            let added = chunk.content.clone();
            let thinking_added = chunk.thinking.clone();
            let streaming_len: usize = chunk.streaming_calls.as_ref().map_or(0, |calls| {
                calls
                    .iter()
                    .map(|call| utf16_len(&call.args_string) + utf16_len(&call.name))
                    .sum()
            });
            let calls_added = streaming_len > pass.last_streaming_len;
            if calls_added {
                pass.last_streaming_len = streaming_len;
            }
            let tool_added = chunk.tool_call_deltas.iter().any(|delta| {
                non_empty(delta.arguments.as_deref())
                    || non_empty(delta.name.as_deref())
                    || non_empty(delta.id.as_deref())
            }) || calls_added;

            if !added.is_empty() || !thinking_added.is_empty() || tool_added {
                pass.pass_chunks += 1;
            }
            self.read_chunk(pass, &chunk);

            if (!added.is_empty() || !thinking_added.is_empty() || tool_added)
                && pass.first_token_at.is_none()
            {
                pass.first_token_at = Some(self.ports.clock.now_ms());
            }

            if !thinking_added.is_empty() {
                if pass.think_start.is_none() {
                    pass.think_start = Some(self.ports.clock.now_ms());
                }
                pass.thinking_text.push_str(&thinking_added);
            }

            if !added.is_empty() {
                let marker = !self.prepared.native_tools
                    && !pass.maybe_tool_call
                    && has_tool_marker_across(&pass.raw, &added);
                pass.raw.push_str(&added);

                if !self.prepared.native_thinking {
                    if pass.think_start.is_none() && contains_think_tag(&pass.raw) {
                        pass.think_start = Some(self.ports.clock.now_ms());
                    }
                    if pass.thought_time.is_none()
                        && pass.think_start.is_some()
                        && pass.raw.contains("</think>")
                    {
                        pass.thought_time = pass
                            .think_start
                            .map(|started| (self.ports.clock.now_ms() - started) / 1000.0);
                    }
                }
                if marker {
                    pass.maybe_tool_call = true;
                }

                // Runaway repetition is cut before it fills the reply.
                let check = detect_repetition(&pass.raw);
                if check.has_loop {
                    pass.raw = check.trimmed_text;
                    break;
                }
            }

            // A file being written shows up as it streams, so the user sees the file grow.
            let streaming_call = match chunk.streaming_calls.as_ref() {
                Some(calls) => calls
                    .iter()
                    .find(|call| FILE_TOOLS.contains(&call.name.as_str()))
                    .map(|call| call.args_string.clone())
                    .filter(|args| !args.is_empty()),
                None if pass.raw.contains("create_file") || pass.raw.contains("write_file") => {
                    Some(pass.raw.clone())
                }
                None => None,
            };
            if let Some(args) = streaming_call {
                self.show_file_progress(pass, &args);
            }

            if !self.prepared.native_tools && pass.maybe_tool_call {
                pass.tool_match = self.parser.detect(&pass.raw);
                if pass.tool_match.is_some() {
                    break;
                }
            }

            let now = self.ports.clock.now_ms();
            let all_calls_len = match chunk.streaming_calls.as_ref() {
                Some(calls) => calls
                    .iter()
                    .map(|call| utf16_len(&call.args_string) + utf16_len(&call.name))
                    .sum(),
                None => 0,
            };
            let emitted = utf16_len(&pass.raw) + utf16_len(&pass.thinking_text) + all_calls_len;
            if now - pass.last_update > STREAM_UI_INTERVAL_MS && pass.last_emitted != Some(emitted)
            {
                pass.last_update = now;
                pass.last_emitted = Some(emitted);
                pass.current_thought = if self.prepared.native_thinking {
                    pass.thinking_text.clone()
                } else {
                    extract_thought(&pass.raw)
                        .map_or_else(|| pass.current_thought.clone(), str::to_string)
                };
                pass.text_content = self.clean_text(&pass.raw);
                let thought_time = pass
                    .thought_time
                    .or_else(|| pass.think_start.map(|started| (now - started) / 1000.0));
                let content = pass.current_thought.clone();
                self.patch_thinking(pass, &content, thought_time);
                let text = pass.text_content.clone();
                self.show_text(pass, &text);
                if pass.file_step_id.is_some() {
                    self.sync_steps();
                }
                self.patch_now();
                self.emit_live(pass.pass_chunks, pass.first_token_at, false);
            }
        }
        Ok(())
    }

    fn read_chunk(&mut self, pass: &mut Pass, chunk: &ModelChunk) {
        pass.native_calls.extend(chunk.tool_calls.iter().cloned());
        // A state tagged for another instance could only be misdirected later, so it is not kept.
        if let Some(state) = &chunk.provider_state
            && Some(state.instance_id.as_str()) == provider_of(&self.model)
        {
            pass.pass_state = Some(state.clone());
        }
        if let Some(counts) = &chunk.done {
            if counts.done_reason.as_deref() == Some("length") {
                self.out_of_context = true;
            }
            pass.final_counts = Some(counts.clone());
        }
    }

    /// Creates or updates the step for a file the model is writing.
    fn show_file_progress(&mut self, pass: &mut Pass, args: &str) {
        let parsed = extract_file_streaming_args(args);
        if parsed.filename.is_none() && parsed.content.is_none() {
            return;
        }
        let display = parsed.filename.clone().unwrap_or_default();
        let content = format!("{} **{}**", self.ports.host.text("creatingFile"), display);
        match pass.file_step_id.clone() {
            None => {
                let id = self.next_id();
                pass.file_step_id = Some(id.clone());
                self.patch_step(&pass.think_step_id.clone(), "isComplete", |step| {
                    step.is_complete = Some(true);
                });
                let mut file = step(&id, "create_file", &content, false);
                file.filename = Some(parsed.filename.unwrap_or_default());
                file.filepath = Some(String::new());
                file.extra.insert(
                    "fileContent".into(),
                    json!(parsed.content.unwrap_or_default()),
                );
                self.push_step(file);
            }
            Some(id) => {
                let filename = parsed.filename.unwrap_or_default();
                let file_content = parsed.content.unwrap_or_default();
                self.patch_step(&id, "filename,content,fileContent", |file| {
                    file.filename = Some(filename.clone());
                    file.content = Some(content.clone());
                    file.extra.insert("fileContent".into(), json!(file_content));
                });
            }
        }
    }

    /// Folds a finished pass's counts into the turn's metrics and the context checkpoint.
    fn account_for_pass(&mut self, pass: &mut Pass) {
        let now = self.ports.clock.now_ms();
        if let Some(counts) = pass.final_counts.clone() {
            let turn_metrics = read_metrics(
                &counts,
                &self.model,
                self.num_ctx as f64,
                pass.first_token_at.map(|at| at - pass.request_start),
            );
            if let Some(metrics) = &turn_metrics {
                debug!(target: "agent.loop", tokens = metrics.response_tokens, tps = metrics.tokens_per_second, "generation metrics");
            }
            self.metrics = merge_metrics(self.metrics.take(), turn_metrics.clone());

            let written = counts.eval_count;
            let prompt = counts.prompt_eval_count;
            if pass.pass_chunks > 0 && written > 0.0 {
                self.tokens_per_chunk = (written / pass.pass_chunks as f64).clamp(1.0, 1.5);
            }
            let counted = if written > 0.0 {
                written
            } else {
                pass.pass_chunks as f64
            };
            self.finished_tokens += counted;
            match turn_metrics {
                Some(metrics) if metrics.tokens_per_second > 0.0 => {
                    self.live_rate = metrics.tokens_per_second;
                }
                _ => {
                    if let Some(first) = pass.first_token_at
                        && now > first
                        && counted > 0.0
                    {
                        let elapsed = (now - first) / 1000.0;
                        if elapsed > 0.0 {
                            self.live_rate = counted / elapsed;
                        }
                    }
                }
            }
            if prompt > 0.0 {
                self.checkpoint = Some(ContextBase {
                    tokens: prompt + written,
                    chars: estimate_chars(&self.wire, self.prepared.tool_chars)
                        + utf16_len(&pass.raw) as i64
                        + utf16_len(&pass.thinking_text) as i64,
                });
            }
            self.emit_live(0, None, true);
        } else if pass.pass_chunks > 0 {
            // The stream ended without counts, as it does on a tool call: estimate the pass so later passes stay honest.
            let written = (pass.pass_chunks as f64 * self.tokens_per_chunk).round();
            self.finished_tokens += written;
            let duration_ms = pass.first_token_at.map_or(0.0, |at| now - at);
            let pass_rate = if duration_ms > 0.0 {
                written / duration_ms * 1000.0
            } else {
                0.0
            };
            if pass_rate > 0.0 {
                self.live_rate = pass_rate;
            }
            let wire_chars = estimate_chars(&self.wire, self.prepared.tool_chars)
                + utf16_len(&pass.raw) as i64
                + utf16_len(&pass.thinking_text) as i64;
            let checkpoint = match self.checkpoint {
                Some(known) => ContextBase {
                    tokens: known.tokens + written,
                    chars: wire_chars,
                },
                None => ContextBase {
                    tokens: (wire_chars as f64 / CHARS_PER_TOKEN as f64).round(),
                    chars: wire_chars,
                },
            };
            self.checkpoint = Some(checkpoint);
            let first_token_ms = pass.first_token_at.map(|at| at - pass.request_start);
            let passed = GenerationMetrics {
                prompt_tokens: checkpoint.tokens,
                response_tokens: written,
                prompt_ms: first_token_ms.unwrap_or(0.0).max(0.0),
                response_ms: duration_ms,
                load_ms: 0.0,
                total_ms: first_token_ms.unwrap_or(0.0).max(0.0) + duration_ms,
                tokens_per_second: pass_rate,
                time_to_first_token_ms: first_token_ms,
                context_window: self.num_ctx as f64,
                model: self.model.clone(),
                gpu_percent: None,
                breakdown: None,
            };
            self.metrics = merge_metrics(self.metrics.take(), Some(passed));
            self.emit_live(0, None, false);
        }
    }

    /// A stop that landed during a pass: the text written so far is kept, and the turn ends.
    fn stop_mid_pass(&mut self, pass: &mut Pass) {
        if let Some(id) = pass.text_step_id.take() {
            self.drop_step(&id);
        }
        self.finish_incomplete_steps();
        self.full_content.push_str(&pass.raw);
        // TS quirk: the saved text is the last throttled snapshot, up to 50 ms behind the raw stream, not the whole.
        if !pass.text_content.is_empty() {
            self.full_text = join_continuation(&self.full_text, &pass.text_content);
        }
        self.patch_now();
        self.aborted = true;
    }

    /// The reply with no tool call: asked for an answer or an action once if it lacks them, else it is the reply.
    fn answer_without_tools(&mut self, pass: &mut Pass) {
        self.drop_file_step(pass);

        if trim_js(&pass.text_content).is_empty()
            && !self.answer_asked
            && self.loop_count < self.loop_limit
            && (!trim_js(&pass.thinking_text).is_empty()
                || self.tools_ran
                || self.wire.iter().any(|entry| entry.role == "tool"))
        {
            self.answer_asked = true;
            let kept = self.kept_thinking(pass);
            self.wire.push(WireMessage {
                role: "assistant".into(),
                content: if pass.raw.is_empty() {
                    " ".into()
                } else {
                    pass.raw.clone()
                },
                thinking: kept,
                provider_state: pass.pass_state.as_ref().map(|state| json!(state)),
                ..WireMessage::default()
            });
            self.wire
                .push(WireMessage::text("user", FINAL_ANSWER_PROMPT));
            return;
        }

        if !self.action_asked
            && !self.prepared.definitions.is_empty()
            && self.loop_count < self.loop_limit
            && announces_action(&pass.text_content)
        {
            self.action_asked = true;
            let text = pass.text_content.clone();
            self.show_text(pass, &text);
            if let Some(id) = pass.text_step_id.clone() {
                self.patch_step(&id, "content,isComplete", |step| {
                    step.content = Some(text.clone());
                    step.is_complete = Some(true);
                });
            }
            self.full_content.push_str(&pass.raw);
            self.full_content.push('\n');
            self.patch_now();
            let kept = self.kept_thinking(pass);
            self.wire.push(WireMessage {
                role: "assistant".into(),
                content: pass.raw.clone(),
                thinking: kept,
                provider_state: pass.pass_state.as_ref().map(|state| json!(state)),
                ..WireMessage::default()
            });
            self.wire
                .push(WireMessage::text("user", ACT_ON_ANNOUNCEMENT));
            return;
        }

        // Nothing follows this, so it is the reply: it leaves the timeline for the message body.
        if let Some(id) = pass.text_step_id.take() {
            self.drop_step(&id);
        }
        self.finished = true;
        self.full_content.push_str(&pass.raw);
        if !pass.text_content.is_empty() {
            self.full_text = join_continuation(&self.full_text, &pass.text_content);
        }
        self.patch_now();
    }

    /// Runs the calls of a pass: native calls in order, or the one text call the model wrote.
    fn call_tools(&mut self, pass: &mut Pass) {
        self.show_text_final(pass);
        self.full_content.push_str(&pass.raw);
        self.full_content.push('\n');
        self.patch_now();

        let kept = self.kept_thinking(pass);
        if self.prepared.native_tools {
            let calls = pass.native_calls.clone();
            self.wire.push(WireMessage {
                role: "assistant".into(),
                content: pass.raw.clone(),
                thinking: kept,
                provider_state: pass.pass_state.as_ref().map(|state| json!(state)),
                tool_calls: calls.clone(),
                ..WireMessage::default()
            });
            for call in &calls {
                if self.ports.cancel.is_aborted() {
                    break;
                }
                let result = self.run_guarded(&call.name, &call.arguments);
                if self.ports.cancel.is_aborted() {
                    break;
                }
                self.tools_ran = true;
                self.last_tool_result = result.clone();
                self.wire.push(tool_message(call, result));
            }
            return;
        }

        self.wire.push(WireMessage {
            role: "assistant".into(),
            content: pass.raw.clone(),
            thinking: kept,
            provider_state: pass.pass_state.as_ref().map(|state| json!(state)),
            ..WireMessage::default()
        });
        let broken = pass.tool_match.clone().unwrap_or_default();
        let ParsedToolCall { name, args } = parse_tool_call(&broken);
        let mut name = name.as_ref().and_then(Value::as_str).map(str::to_string);
        let mut args = args;
        if name.is_none() && !self.ports.cancel.is_aborted() {
            let repaired = self.repair_call(&broken);
            name = repaired.name;
            args = repaired.args;
        }
        if !self.ports.cancel.is_aborted() {
            let args = args.unwrap_or_else(|| json!({}));
            let result = self.run_guarded(name.as_deref().unwrap_or(""), &args);
            self.tools_ran = true;
            self.last_tool_result = result.clone();
            self.wire.push(WireMessage::text("user", result));
        }
    }

    /// The prose written before a call stays where the model wrote it, as a step in the timeline.
    fn show_text_final(&mut self, pass: &mut Pass) {
        let text = pass.text_content.clone();
        self.show_text(pass, &text);
        if let Some(id) = pass.text_step_id.clone() {
            self.patch_step(&id, "content,isComplete", |step| {
                step.content = Some(text.clone());
                step.is_complete = Some(true);
            });
        }
    }

    /// Every tool call goes through here. A forbidden call returns an ordinary result, because a refused model carries
    /// on and a model handed an error stops.
    fn run_guarded(&mut self, name: &str, args: &Value) -> String {
        if self.ports.cancel.is_aborted() {
            return "Tool execution cancelled.".to_string();
        }
        *self.tool_calls.entry(name.to_string()).or_insert(0) += 1;

        let target = target_from_args(args);
        let annotations = self.ports.tools.annotations(name);
        let verdict = decide(&PermissionQuery {
            mode: self.mode,
            tool: name,
            annotations,
            target: target.as_deref(),
            grants: &self.grants,
        });
        let kind = annotations.executes.then_some("command");
        let remembered = grants_for(name, target.as_deref(), annotations);

        match verdict.decision {
            Decision::Allow => self.execute(name, args),
            Decision::Deny => {
                let id = self.next_id();
                let mut refused = step(&id, "approval", &self.ports.host.text("toolRefused"), true);
                refused.extra.insert("answer".into(), json!("no"));
                refused.extra.insert(
                    "approval".into(),
                    approval_json(&id, name, target.as_deref(), &verdict, kind, None),
                );
                self.push_step(refused);
                refusal_for(name, &verdict)
            }
            Decision::Ask => {
                self.ask_then_run(name, args, target, &verdict, kind, &remembered, annotations)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn ask_then_run(
        &mut self,
        name: &str,
        args: &Value,
        target: Option<String>,
        verdict: &Verdict,
        kind: Option<&'static str>,
        remembered: &[Grant],
        _annotations: ToolAnnotations,
    ) -> String {
        // Nobody to ask, or the user has already stopped the turn: the call is refused rather than run unasked.
        if !self.ports.host.can_ask() || self.ports.cancel.is_aborted() {
            return refusal_for(name, verdict);
        }

        let id = self.next_id();
        let allows: Vec<String> = remembered
            .iter()
            .map(|grant| grant.target.clone().unwrap_or_default())
            .collect();
        let mut pending = step(
            &id,
            "approval",
            &self.ports.host.text("approvalNeeded"),
            false,
        );
        pending.extra.insert(
            "approval".into(),
            approval_json(
                &id,
                name,
                target.as_deref(),
                verdict,
                kind,
                kind.map(|_| allows.clone()),
            ),
        );
        self.push_step(pending);
        // The card has to be on screen before the answer is awaited.
        let now = self.ports.clock.now_ms();
        if let Some(batch) = self.events.flush(now) {
            self.ports.observer.on_events(&batch);
        }

        let request = ApprovalRequest {
            id: id.clone(),
            tool: name.to_string(),
            target: target.clone(),
            reason: verdict.reason.clone(),
        };
        let Some(answer) = self.ports.host.request_approval(&request) else {
            return refusal_for(name, verdict);
        };
        self.patch_step(&id, "answer,isComplete", |step| {
            step.extra.insert("answer".into(), json!(answer.as_str()));
            step.is_complete = Some(true);
        });
        self.sync_steps();

        // A stop that lands while the user is deciding wins over a late "yes".
        if answer == ApprovalAnswer::No || self.ports.cancel.is_aborted() {
            return denied_by_user(name);
        }
        // "once" leaves nothing behind: the next call of the same tool asks again.
        if matches!(answer, ApprovalAnswer::Task | ApprovalAnswer::Workspace) {
            for grant in remembered {
                self.grants = add_grant(&self.grants, grant.clone());
            }
        }
        if answer == ApprovalAnswer::Workspace {
            for grant in remembered {
                self.ports.host.on_grant(grant);
            }
        }
        self.execute(name, args)
    }

    /// Runs a tool the turn is allowed to run, and takes any plan it wrote.
    fn execute(&mut self, name: &str, args: &Value) -> String {
        let mut ctx = ToolContext {
            steps: &mut self.steps,
            ids: &mut *self.ports.ids,
            cancel: self.ports.cancel,
            plan: None,
        };
        let output = self.ports.tools.run(name, args, &mut ctx);
        let plan = ctx.plan.take();
        if let Some(items) = plan {
            // The model's own update is not the user's edit, so it is remembered as seen.
            self.last_seen_plan = Some(items.clone());
            self.ports.host.on_plan(&items);
        }
        self.sync_steps();
        output
    }

    /// One repair per turn for a malformed call, asked again with a schema so the sampler can only produce a valid
    /// call. A provider's model is never repaired: a repair would send the whole turn again.
    fn repair_call(&mut self, broken: &str) -> RepairedCall {
        if self.repairs_left == 0 || self.remote {
            return RepairedCall::default();
        }
        self.repairs_left -= 1;

        let mut messages = scope_to_target(&self.wire, &self.model);
        messages.push(WireMessage::text("user", repair_prompt(broken)));
        let request = RepairRequest {
            model: self.model.clone(),
            schema: repair_schema(&self.prepared.definitions),
            messages,
        };
        match self.ports.model.repair(request) {
            Some(text) => read_repair(&text),
            None => RepairedCall::default(),
        }
    }

    /// The text as the user sees it: tool syntax and reasoning removed, a runaway loop cut. A continued reply keeps
    /// its leading space, which is the only thing keeping the joined words apart.
    fn clean_text(&self, raw: &str) -> String {
        let trimmed = detect_repetition(raw).trimmed_text;
        let cleaned = if self.prepared.clean_stream {
            trim_js(&trimmed).to_string()
        } else {
            self.parser.strip(&trimmed)
        };
        if cleaned.is_empty() || !self.is_continuation {
            return cleaned;
        }
        if raw.chars().next().is_some_and(is_js_space) {
            format!(" {cleaned}")
        } else {
            cleaned
        }
    }

    /// The reasoning a reply carries back to the model with its call, when the model reasons natively.
    fn kept_thinking(&self, pass: &Pass) -> Option<String> {
        (self.prepared.native_thinking && !trim_js(&pass.thinking_text).is_empty())
            .then(|| pass.thinking_text.clone())
    }

    fn tool_chars(&self) -> i64 {
        self.prepared.tool_chars
    }

    fn tool_names(&self) -> Vec<&str> {
        self.prepared
            .definitions
            .iter()
            .map(|definition| definition.function.name.as_str())
            .collect()
    }

    /// `maybeCatchUpOnPlan`: the first pass tells the model the plan it has; later passes tell it only the user's edits.
    fn catch_up_on_plan(&mut self) {
        let Some(live) = self.ports.host.get_plan().filter(|items| !items.is_empty()) else {
            return;
        };
        let seen = self.last_seen_plan.clone();
        if seen.as_ref().is_some_and(|seen| same_plan(seen, &live)) {
            return;
        }
        let text = match seen {
            None => describe_plan(&live),
            Some(_) => describe_edit(&live),
        };
        self.wire.push(WireMessage::text("user", text));
        self.last_seen_plan = Some(live);
    }

    fn show_retry(&mut self, pass: &mut Pass, retry: Retry) {
        let until = self.ports.clock.now_ms() + retry.retry_after_ms;
        let info = json!({"attempt": retry.attempt, "of": retry.of, "until": until});
        match pass.retry_step_id.clone() {
            Some(id) => {
                self.patch_step(&id, "retry", |step| {
                    step.extra.insert("retry".into(), info.clone());
                });
            }
            None => {
                let id = self.next_id();
                let mut waiting = step(&id, "loading", "", false);
                waiting.extra.insert("retry".into(), info);
                pass.retry_step_id = Some(id);
                self.push_step(waiting);
            }
        }
        self.sync_steps();
    }

    /// Ends the load and retry waits, which last only until the first real output.
    fn done_loading(&mut self, pass: &mut Pass) {
        if let Some(id) = pass.retry_step_id.take() {
            self.drop_step(&id);
            self.sync_steps();
        }
        if !pass.loading {
            return;
        }
        pass.loading = false;
        if let Some(id) = pass.load_step_id.take() {
            self.drop_step(&id);
        }
        self.sync_steps();
    }

    fn finish_thinking_step(&mut self, pass: &Pass) {
        let Some(index) = self
            .steps
            .iter()
            .position(|entry| entry.id.as_deref() == Some(pass.think_step_id.as_str()))
        else {
            return;
        };
        if trim_js(&pass.current_thought).is_empty() {
            self.steps.remove(index);
            return;
        }
        let entry = &mut self.steps[index];
        entry.content = Some(pass.current_thought.clone());
        entry.is_complete = Some(true);
        entry.extra.insert(
            "thoughtTime".into(),
            json!(pass.thought_time.unwrap_or(0.0)),
        );
    }

    fn patch_thinking(&mut self, pass: &Pass, content: &str, thought_time: Option<f64>) {
        let id = pass.think_step_id.clone();
        let content = content.to_string();
        self.patch_step(&id, "content,thoughtTime", |step| {
            step.content = Some(content.clone());
            if let Some(time) = thought_time {
                step.extra.insert("thoughtTime".into(), json!(time));
            }
        });
    }

    fn drop_file_step(&mut self, pass: &mut Pass) {
        if let Some(id) = pass.file_step_id.take() {
            self.drop_step(&id);
            self.sync_steps();
        }
    }

    fn show_text(&mut self, pass: &mut Pass, value: &str) {
        if trim_js(value).is_empty() {
            return;
        }
        match pass.text_step_id.clone() {
            None => {
                let id = self.next_id();
                pass.text_step_id = Some(id.clone());
                self.push_step(step(&id, "text", value, false));
            }
            Some(id) => {
                let value = value.to_string();
                self.patch_step(&id, "content", |step| step.content = Some(value.clone()));
            }
        }
    }

    /// Marks any step still running as done, and drops the loading ones, which can no longer finish.
    fn finish_incomplete_steps(&mut self) {
        let mut changed = false;
        let mut index = self.steps.len();
        while index > 0 {
            index -= 1;
            if self.steps[index].is_complete == Some(true) {
                continue;
            }
            if self.steps[index].kind == "loading" {
                self.steps.remove(index);
            } else {
                self.steps[index].is_complete = Some(true);
            }
            changed = true;
        }
        if changed {
            self.sync_steps();
        }
    }

    fn emit_live(&mut self, pass_chunks: u64, pass_started: Option<f64>, exact: bool) {
        let now = self.ports.clock.now_ms();
        if !exact
            && let Some(last) = self.live_at
            && now - last < LIVE_INTERVAL_MS
        {
            return;
        }
        self.live_at = Some(now);

        let streamed = pass_chunks as f64 * self.tokens_per_chunk;
        if let Some(started) = pass_started
            && pass_chunks > 1
            && now > started
        {
            self.live_rate = streamed / ((now - started) / 1000.0);
        }

        let wire_chars = estimate_chars(&self.wire, self.prepared.tool_chars);
        let unchanged =
            matches!(self.checkpoint, Some(known) if pass_chunks == 0 && wire_chars == known.chars);
        let known_tokens = match self.checkpoint {
            Some(known) => {
                known.tokens + (wire_chars - known.chars).max(0) as f64 / CHARS_PER_TOKEN as f64
            }
            None => wire_chars as f64 / CHARS_PER_TOKEN as f64,
        };
        let has_checkpoint = self.checkpoint.is_some();
        let from_model = (exact || unchanged) && has_checkpoint;
        let context_tokens = match self.checkpoint {
            Some(known) if from_model => known.tokens,
            _ => known_tokens + streamed,
        };
        let live = LiveTurn {
            response_tokens: (self.finished_tokens + streamed).round(),
            tokens_per_second: self.live_rate,
            context_tokens: context_tokens.round(),
            context_exact: from_model,
            context_window: self.num_ctx as f64,
            parts: Some(self.prepared.prompt_parts.clone()),
        };
        self.events.push(TurnEvent::Live(live), now);
    }

    // -- steps and the observer --------------------------------------------------------------------------------

    fn next_id(&mut self) -> String {
        self.ports.ids.next_id()
    }

    fn push_step(&mut self, step: SearchStep) {
        self.steps.push(step);
        self.sync_steps();
    }

    fn drop_step(&mut self, id: &str) {
        if let Some(index) = self
            .steps
            .iter()
            .position(|entry| entry.id.as_deref() == Some(id))
        {
            self.steps.remove(index);
        }
    }

    /// Settles a step by id. `fields` names what the patch sets, for the log, as the reference logs the keys it patches.
    fn patch_step(&mut self, id: &str, fields: &str, patch: impl FnOnce(&mut SearchStep)) {
        match self
            .steps
            .iter_mut()
            .find(|entry| entry.id.as_deref() == Some(id))
        {
            Some(entry) => patch(entry),
            None if !self.patch_miss_logged => {
                // Logged once per turn, as the reference logs it once per app.
                self.patch_miss_logged = true;
                warn!(target: "agent.loop", step_id = id, fields, "step patch target missing");
            }
            None => {}
        }
    }

    /// Queues one event for the observer, delivering a batch once the interval has passed.
    fn emit(&mut self, event: TurnEvent) {
        let now = self.ports.clock.now_ms();
        if let Some(batch) = self.events.push(event, now) {
            self.ports.observer.on_events(&batch);
        }
    }

    fn sync_steps(&mut self) {
        self.emit(TurnEvent::Steps(self.steps.clone()));
    }

    fn patch_now(&mut self) {
        let patch = AgentPatch {
            content: self.full_content.clone(),
            text_content: join_continuation(&self.full_text, ""),
            steps: self.steps.clone(),
        };
        self.emit(TurnEvent::Patch(patch));
    }

    fn result(&mut self, exhausted: bool) -> AgentResult {
        AgentResult {
            content: self.full_content.clone(),
            text_content: self.full_text.clone(),
            steps: self.steps.clone(),
            metrics: self.metrics.clone(),
            out_of_context: self.out_of_context,
            loops: self.loop_count,
            exhausted,
            aborted: self.aborted,
            tool_calls: self.tool_calls.clone(),
            provider_state: self.turn_state.clone(),
        }
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

fn approval_json(
    id: &str,
    tool: &str,
    target: Option<&str>,
    verdict: &Verdict,
    kind: Option<&str>,
    allows: Option<Vec<String>>,
) -> Value {
    json!({
        "id": id,
        "tool": tool,
        "target": target,
        "reason": verdict.reason,
        "kind": kind,
        "allows": allows,
    })
}

fn non_empty(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.is_empty())
}

/// Whether the text carries a `<think>` or `</think>` tag, in any letter case.
fn contains_think_tag(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("<think>") || lower.contains("</think>")
}

/// The first `units` UTF-16 code units, with a surrogate pair cut by the window left out.
// TS quirk: slice keeps a lone high surrogate at the window's end. A Rust string cannot hold one, so a pair
// that straddles the window is cut and the window stops one unit short.
fn prefix_units(text: &str, units: usize) -> &str {
    let mut used = 0;
    let mut end = 0;
    for (index, c) in text.char_indices() {
        let width = c.len_utf16();
        if used + width > units {
            break;
        }
        used += width;
        end = index + c.len_utf8();
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_list_item_without_brackets_is_a_todo() {
        let items = parse_plan("- Read it\n2) Fix it");
        assert_eq!(items[0].status, PlanStatus::Todo);
        assert_eq!(items[1].text, "Fix it");
    }

    #[test]
    fn the_second_doing_step_is_put_back_to_todo() {
        let items = parse_plan("[>] One\n[>] Two");
        assert_eq!(items[0].status, PlanStatus::Doing);
        assert_eq!(items[1].status, PlanStatus::Todo);
    }

    #[test]
    fn a_batch_keeps_the_latest_snapshot_of_each_kind() {
        let mut batcher = Batcher::new(BATCH_INTERVAL_MS);
        assert!(batcher.push(TurnEvent::OutOfContext(false), 0.0).is_some());
        assert!(batcher.push(TurnEvent::OutOfContext(true), 4.0).is_none());
        let batch = batcher.flush(5.0).unwrap_or_default();
        assert_eq!(batch, vec![TurnEvent::OutOfContext(true)]);
    }
}
