//! The bookkeeping behind running turns: which conversations are generating, what each turn sends, how a finished
//! turn is written back, and which approvals are waiting. Port of `src/agent/taskManager.ts`.
//!
//! The agent loop and the fold itself run behind the caller. This module holds the state they act on: a turn is
//! begun with [`TaskManager::begin_turn`] and finished with [`TaskManager::finish_turn`]. Time and ids come in as
//! parameters, so the state is deterministic under test.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::compaction::{CHARS_PER_TOKEN, CompactionState, compaction_survives};
use crate::context_breakdown::compact_threshold;
use crate::js::utf16_len;
use crate::live_turn::{LiveTurn, LiveTurns};
use crate::permissions::Grant;
use crate::resume::SearchStep;

/// The reply text written when a turn fails without a message of its own.
const FAILURE_TEXT: &str = "Error generating response.";

/// A file the user attached to a message.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub content: String,
}

/// An earlier version of a message, kept when it is regenerated or edited.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageVersion {
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought_time: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<SearchStep>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<Value>,
    #[serde(
        rename = "provider_state",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_state: Option<Value>,
}

/// Whether a fold is still being written or has been written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FoldStatus {
    Running,
    Done,
}

/// The marker a reply shows while a fold runs under it, and after it has finished.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FoldMarker {
    pub status: FoldStatus,
    pub tokens: i64,
    pub at: f64,
}

/// One message of a conversation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub versions: Option<Vec<MessageVersion>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_version_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<SearchStep>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought_time: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<Value>,
    #[serde(
        rename = "provider_state",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_state: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold: Option<FoldMarker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<bool>,
    /// Every other key the message was sent with, kept so a saved message is not trimmed.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One conversation: its messages, whether it is generating, and where it was last folded.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// None for a session saved without a workspace, which the window then reads as the open one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub updated_at: f64,
    #[serde(default)]
    pub is_generating: bool,
    #[serde(default)]
    pub is_out_of_context: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<CompactionState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Value>,
    /// Every other key the session was sent with.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// The speed and size a finished pass reports, as the agent loop measured them.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnMetrics {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub prompt_tokens: f64,
    #[serde(default)]
    pub response_tokens: f64,
    #[serde(default)]
    pub response_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_to_first_token_ms: Option<f64>,
    #[serde(default)]
    pub load_ms: f64,
}

/// What a turn produced, as the agent loop reports it when it stops.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TurnResult {
    pub steps: Vec<SearchStep>,
    pub text_content: String,
    pub exhausted: bool,
    pub out_of_context: bool,
    pub aborted: bool,
    pub metrics: Option<TurnMetrics>,
    pub provider_state: Option<Value>,
    pub loops: f64,
    pub tool_calls: BTreeMap<String, f64>,
}

/// One finished turn as the statistics page keeps it. Kept on this machine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    pub recorded_at: f64,
    pub workspace_id: String,
    pub chat_id: String,
    pub model: String,
    pub prompt_tokens: f64,
    pub response_tokens: f64,
    pub response_ms: f64,
    pub first_token_ms: Option<f64>,
    pub load_ms: f64,
    pub task_ms: f64,
    pub loops: f64,
    pub tools: BTreeMap<String, f64>,
}

/// What a turn sends and how it was started.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TurnOptions {
    /// Replace the last reply, keeping the old one as a version.
    pub is_retry: bool,
    /// Carry on where a reply that ran out of room stopped.
    pub is_continuation: bool,
    /// Let a running fold finish first. Only for turns that add to the conversation.
    pub wait_for_fold: bool,
}

/// Where a continuation picks up: the reply as it stands, steps included.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Seed {
    pub content: String,
    pub text_content: String,
    pub steps: Vec<SearchStep>,
}

/// A fold a turn must wait for before it sends. `started` says whether anything is being folded yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FoldWait {
    pub started: bool,
}

/// A flag that is set when a turn or fold is stopped. Shared between the manager and whoever runs the turn.
#[derive(Debug, Clone, Default)]
pub struct CancelSignal(Arc<AtomicBool>);

impl CancelSignal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn abort(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_aborted(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// A turn the manager started. The caller runs the agent loop with it and reports back with [`TaskManager::finish_turn`].
#[derive(Debug, Clone)]
pub struct Turn {
    pub chat_id: String,
    /// Distinguishes this turn from a later one on the same chat, which replaces it.
    pub generation: u64,
    pub model: String,
    /// The messages the turn is sent with.
    pub context: Vec<Message>,
    pub seed: Option<Seed>,
    pub started_at: f64,
    pub options: TurnOptions,
    pub signal: CancelSignal,
    pub fold_wait: Option<FoldWait>,
}

/// How a turn ended, as the agent loop reports it.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnOutcome {
    Finished(Box<TurnResult>),
    /// A failure with the message the user sees. An empty message reads as the generic failure.
    Failed(String),
    /// The turn was stopped, which writes nothing.
    Aborted,
}

/// What finishing a turn leaves for the caller to do.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FinishReport {
    /// Set when the turn is worth recording for the statistics page.
    pub metric: Option<MetricRow>,
    /// Set when this turn was the chat's current one and was not stopped, so folding may run.
    pub finished_idle: bool,
}

/// An approval answer delivered to the turn that was waiting for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalDelivery {
    pub approval_id: String,
    pub chat_id: String,
    pub answer: String,
}

/// Whether a fold may start for a chat, or what it says instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactGate {
    /// A fold is already running; the caller waits for it.
    InFlight,
    /// There is no model or no conversation to fold.
    Nothing,
    /// The conversation is generating, so folding would rewrite what is being sent.
    Busy,
    /// Folding may start.
    Proceed,
}

#[derive(Debug)]
struct Run {
    chat_id: String,
    generation: u64,
    signal: CancelSignal,
}

#[derive(Debug)]
struct FoldRun {
    started: bool,
    signal: CancelSignal,
}

#[derive(Debug)]
struct Waiting {
    approval_id: String,
    chat_id: String,
}

/// The fields of an active message a finished pass writes.
#[derive(Debug, Clone, Default)]
struct ActivePatch {
    steps: Option<Vec<SearchStep>>,
    text_content: Option<String>,
    provider_state: Option<Value>,
}

/// The state of every conversation's turns, folds and approvals. One per app.
#[derive(Debug, Default)]
pub struct TaskManager {
    workspace_id: String,
    model: Option<String>,
    sessions: BTreeMap<String, ChatSession>,
    /// Running turns in the order they started. Replacing a chat's turn keeps its place, as a map does.
    runs: Vec<Run>,
    folds: BTreeMap<String, FoldRun>,
    waiting: Vec<Waiting>,
    granted: Vec<Grant>,
    live: LiveTurns,
    generation: u64,
}

impl TaskManager {
    /// A manager for a window whose open workspace is `workspace_id`, with no model chosen yet.
    pub fn new(workspace_id: &str) -> Self {
        Self {
            workspace_id: workspace_id.to_string(),
            ..Self::default()
        }
    }

    pub fn set_model(&mut self, model: Option<String>) {
        self.model = model;
    }

    pub fn add_session(&mut self, session: ChatSession) {
        self.sessions.insert(session.id.clone(), session);
    }

    pub fn session(&self, chat_id: &str) -> Option<&ChatSession> {
        self.sessions.get(chat_id)
    }

    pub fn sessions(&self) -> &BTreeMap<String, ChatSession> {
        &self.sessions
    }

    /// The conversations that are generating, in the order they started.
    pub fn running(&self) -> Vec<String> {
        self.runs.iter().map(|run| run.chat_id.clone()).collect()
    }

    pub fn is_running(&self, chat_id: &str) -> bool {
        self.runs.iter().any(|run| run.chat_id == chat_id)
    }

    pub fn live_turn(&self, chat_id: &str) -> Option<&LiveTurn> {
        self.live.get(chat_id)
    }

    /// The permissions kept for the workspace beyond the turns that asked for them.
    pub fn granted(&self) -> &[Grant] {
        &self.granted
    }

    pub fn grant(&mut self, grant: Grant) {
        self.granted.push(grant);
    }

    /// A call is waiting on the user. Asking again under the same id replaces the earlier wait.
    pub fn request_approval(&mut self, chat_id: &str, approval_id: &str) {
        match self
            .waiting
            .iter_mut()
            .find(|waiting| waiting.approval_id == approval_id)
        {
            Some(waiting) => waiting.chat_id = chat_id.to_string(),
            None => self.waiting.push(Waiting {
                approval_id: approval_id.to_string(),
                chat_id: chat_id.to_string(),
            }),
        }
    }

    /// The user's answer to a waiting call. None when nothing was waiting under that id.
    pub fn answer_approval(&mut self, approval_id: &str, answer: &str) -> Option<ApprovalDelivery> {
        let position = self
            .waiting
            .iter()
            .position(|waiting| waiting.approval_id == approval_id)?;
        let waiting = self.waiting.remove(position);
        Some(ApprovalDelivery {
            approval_id: waiting.approval_id,
            chat_id: waiting.chat_id,
            answer: answer.to_string(),
        })
    }

    /// A new message from the user, starting the conversation if it is the first. `title` names a new conversation.
    pub fn send(
        &mut self,
        chat_id: &str,
        content: &str,
        attachments: Option<Vec<Attachment>>,
        title: &str,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> Option<Turn> {
        let existing = self
            .sessions
            .get(chat_id)
            .map(|session| session.messages.clone());

        let user = Message {
            id: ids(),
            role: "user".to_string(),
            content: content.to_string(),
            attachments,
            ..Message::default()
        };

        // TS quirk: with no model the session is kept but the message is not, since no turn starts.
        if existing.is_none() {
            self.add_session(ChatSession {
                id: chat_id.to_string(),
                workspace_id: Some(self.workspace_id.clone()),
                title: title.to_string(),
                updated_at: now,
                ..ChatSession::default()
            });
        }

        let mut context = existing.unwrap_or_default();
        context.push(user);

        self.begin_turn(
            chat_id,
            context,
            TurnOptions {
                wait_for_fold: true,
                ..TurnOptions::default()
            },
            now,
            ids,
        )
    }

    /// Replaces the last reply with a fresh one. The old reply is kept as a version, and a fold that describes
    /// it is dropped when the regenerated index falls inside it.
    pub fn regenerate(
        &mut self,
        chat_id: &str,
        index: Option<usize>,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> Option<Turn> {
        let session = self.sessions.get(chat_id)?;
        let messages = &session.messages;
        let target: Vec<Message> = match index {
            Some(index) => messages[..index.min(messages.len())].to_vec(),
            None => messages[..messages.len().saturating_sub(1)].to_vec(),
        };
        let survived = compaction_survives(session.compaction.as_ref(), &target, index).cloned();

        let session = self.sessions.get_mut(chat_id)?;
        session.compaction = survived;

        // TS quirk: a retry replaces the session's last reply, whichever index was asked for.

        self.begin_turn(
            chat_id,
            target,
            TurnOptions {
                is_retry: true,
                ..TurnOptions::default()
            },
            now,
            ids,
        )
    }

    /// Rewrites a user message and sends the conversation from there. Its old text is kept as a version.
    pub fn edit_message(
        &mut self,
        chat_id: &str,
        index: usize,
        content: &str,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> Option<Turn> {
        let session = self.sessions.get(chat_id)?;
        let target = session.messages.get(index)?.clone();
        if target.role != "user" {
            tracing::warn!(target: "agent.task", role = %target.role, "edit target not a user message");
            return None;
        }

        let mut versions = target.versions.clone().unwrap_or_default();
        versions.push(MessageVersion {
            content: target.content.clone(),
            ..MessageVersion::default()
        });
        let version_count = versions.len();

        let mut messages: Vec<Message> = session.messages[..index].to_vec();
        messages.push(Message {
            content: content.to_string(),
            versions: Some(versions),
            current_version_index: Some(version_count),
            ..target
        });

        let survived =
            compaction_survives(session.compaction.as_ref(), &messages, Some(index)).cloned();

        let session = self.sessions.get_mut(chat_id)?;
        session.messages = messages.clone();
        session.compaction = survived;

        self.begin_turn(chat_id, messages, TurnOptions::default(), now, ids)
    }

    /// Shows a different version of a message. The index is not checked against the versions kept.
    pub fn switch_version(&mut self, chat_id: &str, index: usize, version: usize) {
        if let Some(message) = self
            .sessions
            .get_mut(chat_id)
            .and_then(|session| session.messages.get_mut(index))
        {
            message.current_version_index = Some(version);
        }
    }

    /// Carries on from a reply that ran out of room.
    pub fn continue_generation(
        &mut self,
        chat_id: &str,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> Option<Turn> {
        let messages = {
            let session = self.sessions.get_mut(chat_id)?;
            session.is_out_of_context = false;
            session.messages.clone()
        };

        self.begin_turn(
            chat_id,
            messages,
            TurnOptions {
                is_continuation: true,
                ..TurnOptions::default()
            },
            now,
            ids,
        )
    }

    pub fn dismiss_out_of_context(&mut self, chat_id: &str) {
        if let Some(session) = self.sessions.get_mut(chat_id) {
            session.is_out_of_context = false;
        }
    }

    /// Starts a turn over `context`. None when there is no model, which starts nothing. A turn already running on
    /// the chat is stopped, and a fold it does not wait for is stopped too.
    pub fn begin_turn(
        &mut self,
        chat_id: &str,
        context: Vec<Message>,
        options: TurnOptions,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> Option<Turn> {
        let model = self.model.clone()?;

        if let Some(run) = self.runs.iter().find(|run| run.chat_id == chat_id) {
            run.signal.abort();
        }

        let pending_fold = self
            .folds
            .get(chat_id)
            .map(|fold| (fold.started, fold.signal.clone()));
        if let Some((_, signal)) = &pending_fold
            && !options.wait_for_fold
        {
            signal.abort();
        }

        self.generation += 1;
        let generation = self.generation;
        let signal = CancelSignal::new();
        let run = Run {
            chat_id: chat_id.to_string(),
            generation,
            signal: signal.clone(),
        };
        match self.runs.iter_mut().find(|run| run.chat_id == chat_id) {
            Some(existing) => *existing = run,
            None => self.runs.push(run),
        }

        self.scaffold(chat_id, &context, options, ids);

        let seed = if options.is_continuation {
            seed_for(&context)
        } else {
            None
        };

        let fold_wait = match pending_fold {
            Some((started, _)) if options.wait_for_fold => Some(FoldWait { started }),
            _ => None,
        };

        Some(Turn {
            chat_id: chat_id.to_string(),
            generation,
            model,
            context,
            seed,
            started_at: now,
            options,
            signal,
            fold_wait,
        })
    }

    /// Writes a finished turn back onto its conversation. A turn the user stopped writes nothing, except a reply
    /// that ran out of room. A turn that was superseded still writes, but does not end the chat's generation.
    pub fn finish_turn(
        &mut self,
        turn: &Turn,
        outcome: TurnOutcome,
        now: f64,
        ids: &mut dyn FnMut() -> String,
    ) -> FinishReport {
        let mut report = FinishReport::default();
        let chat_id = turn.chat_id.as_str();

        match outcome {
            TurnOutcome::Finished(result) => {
                let result = *result;
                if !result.aborted
                    && let Some(metrics) = &result.metrics
                {
                    report.metric = Some(self.metric_row(turn, metrics, &result, now));
                }

                // TS quirk: a superseded turn still writes its reply onto the newest message.
                if result.exhausted || !result.aborted {
                    let provider_state = if result.aborted {
                        None
                    } else {
                        result
                            .provider_state
                            .clone()
                            .filter(|value| !value.is_null())
                    };
                    self.patch_active(
                        chat_id,
                        ActivePatch {
                            steps: Some(result.steps),
                            text_content: Some(result.text_content),
                            provider_state,
                        },
                        now,
                        result.out_of_context,
                    );
                }
            }
            TurnOutcome::Failed(message) => {
                let text = if message.is_empty() {
                    FAILURE_TEXT.to_string()
                } else {
                    message
                };
                if let Some(session) = self.sessions.get_mut(chat_id) {
                    let keep = session.messages.len().saturating_sub(1);
                    session.messages.truncate(keep);
                    session.messages.push(Message {
                        id: ids(),
                        role: "assistant".to_string(),
                        content: text,
                        failed: Some(true),
                        ..Message::default()
                    });
                }
            }
            TurnOutcome::Aborted => {}
        }

        let current = self
            .runs
            .iter()
            .position(|run| run.chat_id == chat_id && run.generation == turn.generation);
        if let Some(position) = current {
            self.runs.remove(position);
            self.live.set(chat_id, None);
            if let Some(session) = self.sessions.get_mut(chat_id) {
                session.is_generating = false;
            }
            report.finished_idle = !turn.signal.is_aborted();
        }

        report
    }

    /// Stops a chat's turn and fold, and refuses any call waiting on the user in it. Its session stops generating.
    pub fn stop(&mut self, chat_id: &str) -> Vec<ApprovalDelivery> {
        let delivered = self.refuse_waiting(chat_id);

        if let Some(position) = self.runs.iter().position(|run| run.chat_id == chat_id) {
            let run = self.runs.remove(position);
            run.signal.abort();
            self.live.set(chat_id, None);
        }

        if let Some(fold) = self.folds.remove(chat_id) {
            fold.signal.abort();
        }

        if let Some(session) = self.sessions.get_mut(chat_id) {
            session.is_generating = false;
        }

        delivered
    }

    /// Stops every turn and fold, and refuses the calls waiting in the chats that were running. The sessions keep
    /// their generating flag, as the reference does.
    pub fn stop_all(&mut self) -> Vec<ApprovalDelivery> {
        // TS quirk: sessions keep isGenerating after a stop-all, since no finish follows it.
        let chats: Vec<String> = self.runs.iter().map(|run| run.chat_id.clone()).collect();

        let mut delivered = Vec::new();
        for chat_id in &chats {
            delivered.extend(self.refuse_waiting(chat_id));
        }

        for run in &self.runs {
            run.signal.abort();
        }
        for chat_id in &chats {
            self.live.set(chat_id, None);
        }
        self.runs.clear();

        for fold in self.folds.values() {
            fold.signal.abort();
        }
        self.folds.clear();

        delivered
    }

    /// Whether a fold may start for a chat now, and what the caller should do instead when it may not.
    pub fn compact_gate(&self, chat_id: &str) -> CompactGate {
        if self.folds.contains_key(chat_id) {
            return CompactGate::InFlight;
        }
        if self.model.is_none() {
            return CompactGate::Nothing;
        }
        match self.sessions.get(chat_id) {
            None => CompactGate::Nothing,
            Some(session) if session.is_generating || self.is_running(chat_id) => CompactGate::Busy,
            Some(_) => CompactGate::Proceed,
        }
    }

    /// Records that a fold has started for a chat. Returns the signal that stops it.
    pub fn begin_fold(&mut self, chat_id: &str) -> CancelSignal {
        let signal = CancelSignal::new();
        self.folds.insert(
            chat_id.to_string(),
            FoldRun {
                started: false,
                signal: signal.clone(),
            },
        );
        signal
    }

    /// Notes that there is now something being folded, which is when a waiting turn has anything worth saying.
    pub fn set_fold_started(&mut self, chat_id: &str) {
        if let Some(fold) = self.folds.get_mut(chat_id) {
            fold.started = true;
        }
    }

    /// Clears a fold once it has finished, unless a newer fold has replaced it.
    pub fn end_fold(&mut self, chat_id: &str, signal: &CancelSignal) {
        let current = self
            .folds
            .get(chat_id)
            .is_some_and(|fold| Arc::ptr_eq(&fold.signal.0, &signal.0));
        if current {
            self.folds.remove(chat_id);
        }
    }

    /// Sets or clears the fold marker on a message of a chat.
    pub fn mark_fold(&mut self, chat_id: &str, message_id: &str, fold: Option<FoldMarker>) {
        if message_id.is_empty() {
            return;
        }
        if let Some(session) = self.sessions.get_mut(chat_id) {
            mark_fold(&mut session.messages, message_id, fold);
        }
    }

    /// Writes the messages a turn is sent with onto its session, and marks the session as generating.
    fn scaffold(
        &mut self,
        chat_id: &str,
        context: &[Message],
        options: TurnOptions,
        ids: &mut dyn FnMut() -> String,
    ) {
        let Some(session) = self.sessions.get_mut(chat_id) else {
            return;
        };

        let messages = if options.is_continuation {
            context.to_vec()
        } else if options.is_retry {
            let mut messages = session.messages.clone();
            match messages.last_mut() {
                Some(last) if last.role == "assistant" => {
                    let old = MessageVersion {
                        content: last.content.clone(),
                        text_content: last.text_content.clone(),
                        thinking_content: last.thinking_content.clone(),
                        thought_time: last.thought_time.clone(),
                        steps: last.steps.clone(),
                        metrics: last.metrics.clone(),
                        provider_state: last.provider_state.clone(),
                    };
                    let mut versions = last.versions.clone().unwrap_or_default();
                    versions.push(old);
                    last.current_version_index = Some(versions.len());
                    last.versions = Some(versions);
                    last.content = String::new();
                    last.thinking_content = None;
                    last.text_content = Some(String::new());
                    last.thought_time = None;
                    last.steps = Some(Vec::new());
                    last.metrics = None;
                    last.provider_state = None;
                }
                other => {
                    let role = other
                        .map_or("missing", |message| message.role.as_str())
                        .to_string();
                    tracing::warn!(target: "agent.task", role = %role, "retry target not an assistant message");
                }
            }
            messages
        } else {
            let mut messages = context.to_vec();
            messages.push(Message {
                id: ids(),
                role: "assistant".to_string(),
                content: String::new(),
                steps: Some(Vec::new()),
                ..Message::default()
            });
            messages
        };

        session.messages = messages;
        session.is_generating = true;
    }

    /// Writes the fields of a finished pass onto the last message, and the session fields when there is one.
    /// Nothing is written to a conversation with no messages.
    fn patch_active(&mut self, chat_id: &str, patch: ActivePatch, now: f64, out_of_context: bool) {
        let Some(session) = self.sessions.get_mut(chat_id) else {
            return;
        };
        {
            let Some(last) = session.messages.last_mut() else {
                return;
            };
            if let Some(steps) = patch.steps {
                last.steps = Some(steps);
            }
            if let Some(text) = patch.text_content {
                last.text_content = Some(text);
            }
            if let Some(state) = patch.provider_state {
                last.provider_state = Some(state);
            }
        }
        session.updated_at = now;
        session.is_out_of_context = out_of_context;
    }

    fn metric_row(
        &self,
        turn: &Turn,
        metrics: &TurnMetrics,
        result: &TurnResult,
        now: f64,
    ) -> MetricRow {
        let workspace_id = self
            .sessions
            .get(&turn.chat_id)
            .and_then(|session| session.workspace_id.clone())
            .unwrap_or_else(|| self.workspace_id.clone());
        let model = if metrics.model.is_empty() {
            turn.model.clone()
        } else {
            metrics.model.clone()
        };

        MetricRow {
            recorded_at: now,
            workspace_id,
            chat_id: turn.chat_id.clone(),
            model,
            prompt_tokens: metrics.prompt_tokens,
            response_tokens: metrics.response_tokens,
            response_ms: metrics.response_ms,
            first_token_ms: metrics.time_to_first_token_ms,
            load_ms: metrics.load_ms,
            task_ms: now - turn.started_at,
            loops: result.loops,
            tools: result.tool_calls.clone(),
        }
    }

    /// Refuses, in order, the calls a chat is waiting on.
    fn refuse_waiting(&mut self, chat_id: &str) -> Vec<ApprovalDelivery> {
        let mut delivered = Vec::new();
        let mut kept = Vec::with_capacity(self.waiting.len());
        for waiting in self.waiting.drain(..) {
            if waiting.chat_id == chat_id {
                delivered.push(ApprovalDelivery {
                    approval_id: waiting.approval_id,
                    chat_id: waiting.chat_id,
                    answer: "no".to_string(),
                });
            } else {
                kept.push(waiting);
            }
        }
        self.waiting = kept;
        delivered
    }
}

/// The characters, tokens and the window a budget is worked from. A user limit wins; otherwise a share of the window,
/// capped for a paid provider. The window itself is resolved by the caller.
pub fn budget_chars(window_tokens: i64, limit_tokens: Option<i64>, paid: bool) -> i64 {
    compact_threshold(window_tokens, limit_tokens, paid).tokens * CHARS_PER_TOKEN
}

/// What a measurement was taken for, so a turn sending exactly those messages can start from it.
pub fn measured_for(model: &str, messages: &[Message]) -> String {
    let last = messages.last();
    let files = last
        .and_then(|message| message.attachments.as_ref())
        .into_iter()
        .flatten()
        .map(|file| format!("{}:{}", file.name, utf16_len(&file.content)));

    let mut parts = vec![
        model.to_string(),
        messages.len().to_string(),
        last.map_or_else(String::new, |message| message.role.clone()),
        last.map_or_else(String::new, |message| message.content.clone()),
    ];
    parts.extend(files);
    parts.join("\n")
}

/// The seed a continuation picks up from: the reply's current version, or the reply itself.
pub fn seed_for(context: &[Message]) -> Option<Seed> {
    let last = context.last()?;
    if last.role != "assistant" {
        return None;
    }

    let (content, text, steps) = match (&last.versions, last.current_version_index) {
        (Some(versions), Some(index)) if index < versions.len() => {
            let version = &versions[index];
            (
                version.content.clone(),
                version.text_content.clone(),
                version.steps.clone(),
            )
        }
        _ => (
            last.content.clone(),
            last.text_content.clone(),
            last.steps.clone(),
        ),
    };

    Some(Seed {
        content,
        text_content: text.unwrap_or_default(),
        steps: steps.unwrap_or_default(),
    })
}

/// The id of the last assistant reply, which is where a fold's marker sits.
pub fn last_reply_id(messages: &[Message]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .map(|message| message.id.as_str())
}

/// Sets, or removes, the fold marker of the message with `message_id`.
pub fn mark_fold(messages: &mut [Message], message_id: &str, fold: Option<FoldMarker>) {
    for message in messages
        .iter_mut()
        .filter(|message| message.id == message_id)
    {
        message.fold = fold;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counter() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            next += 1;
            format!("id-{next}")
        }
    }

    #[test]
    fn a_turn_without_a_model_starts_nothing() {
        let mut manager = TaskManager::new("default");
        let mut ids = counter();
        assert!(
            manager
                .send("chat-1", "hello", None, "t", 1.0, &mut ids)
                .is_none()
        );
        assert!(manager.session("chat-1").is_some());
        assert!(manager.running().is_empty());
    }

    #[test]
    fn a_replacing_turn_keeps_its_place_in_the_running_list() {
        let mut manager = TaskManager::new("default");
        manager.set_model(Some("m".to_string()));
        let mut ids = counter();
        manager.send("a", "one", None, "t", 1.0, &mut ids);
        manager.send("b", "two", None, "t", 1.0, &mut ids);
        manager.send("a", "again", None, "t", 1.0, &mut ids);
        assert_eq!(manager.running(), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn a_superseded_turn_does_not_end_the_chat_generation() {
        let mut manager = TaskManager::new("default");
        manager.set_model(Some("m".to_string()));
        let mut ids = counter();
        let first = manager
            .send("a", "one", None, "t", 1.0, &mut ids)
            .expect("turn");
        let second = manager
            .send("a", "two", None, "t", 1.0, &mut ids)
            .expect("turn");
        assert!(first.signal.is_aborted());

        let report = manager.finish_turn(&first, TurnOutcome::Aborted, 2.0, &mut ids);
        assert!(!report.finished_idle);
        assert!(manager.is_running("a"));

        manager.finish_turn(&second, TurnOutcome::Aborted, 2.0, &mut ids);
        assert!(!manager.is_running("a"));
    }

    #[test]
    fn a_stopped_chat_refuses_its_waiting_calls_and_keeps_others() {
        let mut manager = TaskManager::new("default");
        manager.set_model(Some("m".to_string()));
        let mut ids = counter();
        manager.send("a", "one", None, "t", 1.0, &mut ids);
        manager.send("b", "two", None, "t", 1.0, &mut ids);
        manager.request_approval("a", "x");
        manager.request_approval("b", "y");

        let refused = manager.stop("a");
        assert_eq!(refused.len(), 1);
        assert_eq!(refused[0].answer, "no");
        assert!(manager.answer_approval("y", "once").is_some());
    }

    #[test]
    fn a_compaction_gate_says_busy_while_generating() {
        let mut manager = TaskManager::new("default");
        manager.set_model(Some("m".to_string()));
        let mut ids = counter();
        manager.send("a", "one", None, "t", 1.0, &mut ids);
        assert_eq!(manager.compact_gate("a"), CompactGate::Busy);
        assert_eq!(manager.compact_gate("missing"), CompactGate::Nothing);
    }

    #[test]
    fn a_measurement_names_the_model_count_and_last_message() {
        let messages = vec![Message {
            id: "m".to_string(),
            role: "user".to_string(),
            content: "hi".to_string(),
            attachments: Some(vec![Attachment {
                name: "a.txt".to_string(),
                kind: "text/plain".to_string(),
                content: "xyz".to_string(),
            }]),
            ..Message::default()
        }];
        assert_eq!(measured_for("q", &messages), "q\n1\nuser\nhi\na.txt:3");
    }
}
