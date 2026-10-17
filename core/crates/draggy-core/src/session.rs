//! A conversation with a model. The shell holds the `Session` handle, calls `send` and reads events through its
//! observer. The turn itself runs on a thread of its own, so the caller's thread is never blocked on the network.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_agent::agent_loop::Permission;
use draggy_agent::agent_loop::{
    AgentResult, ApprovalAnswer, ApprovalRequest, Clock, DraggyRef, Engine, FixedContext, IdSource,
    MessageRefs, ModelProfile, Ports, TailNotes, ToolAccess, ToolRuntime, TurnHost, TurnRequest,
    run_turn,
};
use draggy_agent::effort::Effort;
use draggy_agent::permissions::{Grant, PermissionMode};
use draggy_agent::prompts::{
    PromptEnvironment, PromptProfile, PromptSettings, WebMode,
};
use draggy_agent::resume::SearchStep;
use draggy_agent::skills::{LoadedSkill, SkillReader};
use draggy_agent::task_manager::{CancelSignal, Message};
use draggy_tools::files::content_hash;

use crate::cancel::CancelToken;
use crate::error::CoreError;
use crate::model::OpenAiModel;
use crate::net::Net;
use crate::observer::{ApprovalHandler, Bridge, TurnObserver};
use crate::records::{ApprovalChoice, ApprovalRecord, MessageRecord, SessionConfig, TurnOutcome};
use crate::tools::{FileTools, NoTools, definitions};

struct WallClock;

impl Clock for WallClock {
    fn now_ms(&self) -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
    }
}

#[derive(Default)]
struct Counter(u64);

impl IdSource for Counter {
    fn next_id(&mut self) -> String {
        self.0 += 1;
        format!("step-{}", self.0)
    }
}

struct Refs;

impl MessageRefs for Refs {
    fn reference(&mut self, message: &Message) -> DraggyRef {
        DraggyRef {
            id: message.id.clone(),
            hash: content_hash(message.content.as_bytes()),
        }
    }
}

struct NoSkills;

impl SkillReader for NoSkills {
    fn read(&mut self, _workspace_id: &str, _id: &str) -> Option<LoadedSkill> {
        None
    }
}

/// The engine is whatever server `base_url` points at, already running. It is never started or stopped from here.
struct RunningServer {
    window: i64,
}

impl Engine for RunningServer {
    fn context_size(
        &mut self,
        _model: &str,
        _chars: i64,
        max_context: Option<i64>,
        fixed: Option<FixedContext>,
    ) -> i64 {
        match fixed {
            Some(FixedContext::Tokens(tokens)) => tokens,
            Some(FixedContext::Max) => max_context.unwrap_or(self.window),
            None => self.window,
        }
    }

    fn is_loaded_at(&mut self, _model: &str, _num_ctx: i64) -> Option<bool> {
        None
    }

    fn start(&mut self, _model: &str, _num_ctx: i64, _exact: bool) -> Result<(), String> {
        Ok(())
    }

    fn gpu_percent(&mut self, _model: &str) -> Option<f64> {
        None
    }
}

/// Puts approvals to the shell's handler. Without one nobody can answer, so a call that needs an answer is refused.
/// Grants the user keeps for the session are collected here and stored once the turn ends.
struct Host {
    approvals: Option<Arc<dyn ApprovalHandler>>,
    cancel: CancelSignal,
    kept: Vec<Grant>,
}

impl TurnHost for Host {
    fn text(&self, key: &str) -> String {
        key.to_owned()
    }

    fn can_ask(&self) -> bool {
        self.approvals.is_some()
    }

    fn request_approval(&mut self, request: &ApprovalRequest) -> Option<ApprovalAnswer> {
        let handler = Arc::clone(self.approvals.as_ref()?);
        let record = ApprovalRecord {
            id: request.id.clone(),
            tool: request.tool.clone(),
            target: request.target.clone(),
            reason: request.reason.clone(),
        };
        // The shell's handler may block until the user decides. It runs on a thread of its own so that stopping the
        // turn answers "no" at once instead of waiting for it.
        let (send, receive) = mpsc::channel();
        let asked = std::thread::Builder::new()
            .name("draggy-approval".to_owned())
            .spawn(move || {
                // Nobody is listening once the turn was stopped; the answer has nowhere to go.
                let _ = send.send(handler.ask(record));
            });
        if asked.is_err() {
            return None;
        }
        let choice = loop {
            match receive.recv_timeout(Duration::from_millis(50)) {
                Ok(choice) => break choice,
                Err(RecvTimeoutError::Timeout) if !self.cancel.is_aborted() => {}
                Err(_) => break ApprovalChoice::No,
            }
        };
        Some(match choice {
            ApprovalChoice::Once => ApprovalAnswer::Once,
            ApprovalChoice::Task => ApprovalAnswer::Task,
            ApprovalChoice::Workspace => ApprovalAnswer::Workspace,
            ApprovalChoice::No => ApprovalAnswer::No,
        })
    }

    fn on_grant(&mut self, grant: &Grant) {
        self.kept.push(grant.clone());
    }

    fn get_plan(&mut self) -> Option<Vec<draggy_agent::agent_loop::PlanItem>> {
        None
    }

    fn on_plan(&mut self, _items: &[draggy_agent::agent_loop::PlanItem]) {}
}

#[derive(Default)]
struct State {
    messages: Vec<Message>,
    tail_notes: TailNotes,
    next_message: u64,
    /// What the user allowed for the rest of the session.
    grants: Vec<Grant>,
}

#[derive(uniffi::Object)]
pub struct Session {
    config: SessionConfig,
    net: Arc<Net>,
    state: Mutex<State>,
}

fn message(id: String, role: &str, content: &str) -> Message {
    Message {
        id,
        role: role.to_owned(),
        content: content.to_owned(),
        ..Message::default()
    }
}

/// `2026-10-14` and `12:30`, in UTC. The shell can pass its own formatted values once it has a locale to offer.
fn stamp() -> (String, String) {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let rest = seconds % 86_400;
    // Days since 1970-01-01 to a calendar date (Howard Hinnant's civil_from_days).
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{:02}:{:02}", rest / 3600, rest % 3600 / 60),
    )
}

impl Session {
    fn request(&self, messages: Vec<Message>, grants: Vec<Grant>) -> TurnRequest {
        let has_folder = self.config.folder.is_some();
        let commands = has_folder && self.config.allow_commands;
        let (date, now) = stamp();
        TurnRequest {
            profile: ModelProfile {
                model: self.config.model.clone(),
                tool_access: ToolAccess::Native,
                probed: true,
                has_thinking: false,
                thinking_allowed: true,
                native_vision: false,
                prompt_profile: PromptProfile::Compact,
                loop_limit: self.config.loop_limit.map_or(75, |limit| limit as usize),
                max_context: None,
                fixed_context: self.config.context_tokens.map(FixedContext::Tokens),
            },
            workspace_id: "default".to_owned(),
            settings: PromptSettings {
                effort: Effort::Medium,
                allow_max_in_chat: false,
                web_mode: WebMode::Off,
                custom_instructions: Vec::new(),
            },
            environment: PromptEnvironment {
                has_folder,
                project_root: self.config.folder.clone(),
                code_execution: commands,
                library_ready: false,
                has_skills: false,
            },
            tools: if has_folder {
                definitions(commands)
            } else {
                Vec::new()
            },
            prompt_tools: Vec::new(),
            memory: None,
            skills: Vec::new(),
            date,
            now,
            messages,
            is_continuation: false,
            seed: None,
            compaction: None,
            permission: Some(Permission {
                mode: self
                    .config
                    .permission_mode
                    .map_or(PermissionMode::Ask, PermissionMode::from),
                grants,
            }),
            context_base: None,
        }
    }

    /// Runs one turn on the calling thread. Kept apart from `send` so tests can drive it without a runtime.
    pub(crate) fn run_blocking(
        &self,
        text: &str,
        observer: Arc<dyn TurnObserver>,
        approvals: Option<Arc<dyn ApprovalHandler>>,
        cancel: &CancelToken,
    ) -> Result<TurnOutcome, CoreError> {
        let (messages, mut tail_notes, grants) = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            state.next_message += 1;
            let id = format!("m{}", state.next_message);
            state.messages.push(message(id, "user", text));
            (
                state.messages.clone(),
                state.tail_notes.clone(),
                state.grants.clone(),
            )
        };

        let request = self.request(messages, grants);
        let mut model = OpenAiModel::new(
            Arc::clone(&self.net),
            &self.config.base_url,
            self.config.api_key.as_deref(),
        );
        let mut engine = RunningServer {
            window: self.config.context_tokens.unwrap_or(8192),
        };
        let mut files: Box<dyn ToolRuntime> = match &self.config.folder {
            Some(folder) => Box::new(FileTools::new(folder, self.config.allow_commands)),
            None => Box::new(NoTools),
        };
        let mut bridge = Bridge(observer);
        let mut host = Host {
            approvals,
            cancel: cancel.signal().clone(),
            kept: Vec::new(),
        };
        let (mut refs, mut skills, mut ids) = (Refs, NoSkills, Counter::default());
        let clock = WallClock;

        let result = run_turn(
            &request,
            &mut tail_notes,
            Ports {
                model: &mut model,
                engine: &mut engine,
                skills: &mut skills,
                tools: &mut *files,
                host: &mut host,
                observer: &mut bridge,
                refs: &mut refs,
                ids: &mut ids,
                clock: &clock,
                cancel: cancel.signal(),
            },
        );
        let result: AgentResult = match result {
            Ok(result) => result,
            Err(error) => {
                // The turn failed before it answered. Leaving the question in place would stack a second user turn on
                // the next send, so the conversation goes back to where it was.
                let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
                state.messages.pop();
                return Err(error.into());
            }
        };

        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.tail_notes = tail_notes;
        for grant in host.kept {
            if !state.grants.contains(&grant) {
                state.grants.push(grant);
            }
        }
        state.next_message += 1;
        let id = format!("m{}", state.next_message);
        let mut reply = message(id, "assistant", &result.content);
        reply.text_content = Some(result.text_content.clone());
        reply.steps =
            Some(result.steps.clone()).filter(|steps: &Vec<SearchStep>| !steps.is_empty());
        state.messages.push(reply);
        Ok(TurnOutcome::from(&result))
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl Session {
    /// A session with no messages. Failing to build the HTTP client is the only way this can fail.
    #[uniffi::constructor]
    pub fn new(config: SessionConfig) -> Result<Arc<Self>, CoreError> {
        let net = Net::new().map_err(|message| CoreError::Internal { message })?;
        if config.base_url.trim().is_empty() || config.model.trim().is_empty() {
            return Err(CoreError::Invalid {
                message: "A session needs a server address and a model.".to_owned(),
            });
        }
        Ok(Arc::new(Self {
            config,
            net: Arc::new(net),
            state: Mutex::new(State::default()),
        }))
    }

    /// The conversation so far.
    pub fn messages(&self) -> Vec<MessageRecord> {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state
            .messages
            .iter()
            .map(|message| MessageRecord {
                id: message.id.clone(),
                role: message.role.clone(),
                content: message.content.clone(),
            })
            .collect()
    }

    /// Replaces the conversation with saved messages, so the model sees them on the next turn. Grants and notes from
    /// the earlier conversation are dropped. Only `user` and `assistant` messages are accepted.
    pub fn restore(&self, saved: Vec<MessageRecord>) -> Result<(), CoreError> {
        if let Some(bad) = saved
            .iter()
            .find(|record| record.role != "user" && record.role != "assistant")
        {
            return Err(CoreError::Invalid {
                message: format!("Cannot restore a message with the role \"{}\".", bad.role),
            });
        }
        let highest = saved
            .iter()
            .filter_map(|record| record.id.strip_prefix('m')?.parse::<u64>().ok())
            .max()
            .unwrap_or(0);
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.next_message = highest.max(u64::try_from(saved.len()).unwrap_or(0));
        state.messages = saved
            .into_iter()
            .map(|record| message(record.id, &record.role, &record.content))
            .collect();
        state.tail_notes = TailNotes::default();
        state.grants.clear();
        Ok(())
    }

    /// Adds the user's message and runs the turn to its end. Events reach the observer while it runs. A call that
    /// needs the user's answer goes to `approvals`; without one it is refused.
    pub async fn send(
        self: Arc<Self>,
        text: String,
        observer: Arc<dyn TurnObserver>,
        approvals: Option<Arc<dyn ApprovalHandler>>,
        cancel: Arc<CancelToken>,
    ) -> Result<TurnOutcome, CoreError> {
        let (reply, answer) = tokio::sync::oneshot::channel();
        let session = Arc::clone(&self);
        std::thread::Builder::new()
            .name("draggy-turn".to_owned())
            .spawn(move || {
                let outcome = session.run_blocking(&text, observer, approvals, &cancel);
                // The receiver is gone when the shell dropped the call; nothing is waiting for the outcome.
                drop(reply.send(outcome));
            })
            .map_err(|error| CoreError::Internal {
                message: error.to_string(),
            })?;
        answer.await.unwrap_or_else(|_| {
            Err(CoreError::Internal {
                message: "The turn ended without an answer.".to_owned(),
            })
        })
    }
}
