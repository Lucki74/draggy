//! The chat's logic without any widget: the transcript, how core events change it, and the bridge that carries a turn
//! from the core's threads to the window's main loop.

use std::sync::Arc;
use std::sync::mpsc;

use async_channel::Sender;
use draggy_core::{
    ApprovalChoice, ApprovalHandler, ApprovalRecord, CancelToken, CoreError, MessageRecord,
    MetricsRecord, Session, StepRecord, TurnEventRecord, TurnObserver, TurnOutcome,
};

use crate::conversations::SavedMessage;
use crate::runtime::runtime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

/// One message in the transcript. A reply is `streaming` until its turn ends.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub role: Role,
    pub text: String,
    pub steps: Vec<StepRecord>,
    pub metrics: Option<MetricsRecord>,
    pub streaming: bool,
    /// Something to tell the user beside the text: a failure, or that the turn was stopped.
    pub note: Option<String>,
}

impl Entry {
    fn new(role: Role, text: String, streaming: bool) -> Self {
        Self {
            role,
            text,
            steps: Vec::new(),
            metrics: None,
            streaming,
            note: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct Transcript {
    entries: Vec<Entry>,
}

impl Transcript {
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// Adds what the user sent and an empty reply that the turn will fill. Returns the reply's index.
    pub fn begin_turn(&mut self, text: &str) -> usize {
        self.entries
            .push(Entry::new(Role::User, text.to_owned(), false));
        self.entries
            .push(Entry::new(Role::Assistant, String::new(), true));
        self.entries.len() - 1
    }

    /// The transcript of a saved conversation: its user and assistant text. Steps and speed are not saved with it.
    pub fn from_saved(messages: &[SavedMessage]) -> Self {
        let entries = messages
            .iter()
            .filter_map(|message| {
                let role = match message.role.as_str() {
                    "user" => Role::User,
                    "assistant" => Role::Assistant,
                    _ => return None,
                };
                Some(Entry::new(role, message.content.clone(), false))
            })
            .collect();
        Self { entries }
    }

    /// True while a reply is still arriving.
    pub fn is_busy(&self) -> bool {
        self.entries.last().is_some_and(|entry| entry.streaming)
    }

    /// Applies a batch of core events to the reply being written. Each event carries a full snapshot, so applying
    /// them in order leaves the reply as the core last described it.
    pub fn apply(&mut self, events: &[TurnEventRecord]) {
        let Some(reply) = self.entries.last_mut().filter(|entry| entry.streaming) else {
            return;
        };
        for event in events {
            match event {
                TurnEventRecord::Patch {
                    text_content,
                    steps,
                    ..
                } => {
                    reply.text.clone_from(text_content);
                    reply.steps.clone_from(steps);
                }
                TurnEventRecord::Steps { steps } => reply.steps.clone_from(steps),
                TurnEventRecord::Metrics { metrics } => reply.metrics = Some(metrics.clone()),
                TurnEventRecord::OutOfContext { value } => {
                    reply.note = value.then(|| OUT_OF_CONTEXT.to_owned());
                }
                TurnEventRecord::Live { .. } => {}
            }
        }
    }

    /// Ends the reply with the turn's outcome, or with the reason it failed.
    pub fn finish(&mut self, result: Result<TurnOutcome, CoreError>) {
        let Some(reply) = self.entries.last_mut().filter(|entry| entry.streaming) else {
            return;
        };
        reply.streaming = false;
        match result {
            Ok(outcome) => {
                if !outcome.text_content.is_empty() {
                    reply.text = outcome.text_content;
                }
                if !outcome.steps.is_empty() {
                    reply.steps = outcome.steps;
                }
                if outcome.metrics.is_some() {
                    reply.metrics = outcome.metrics;
                }
                if outcome.aborted {
                    reply.note = Some("Stopped.".to_owned());
                } else if outcome.exhausted {
                    reply.note = Some(format!(
                        "Stopped after {} passes without an answer.",
                        outcome.loops
                    ));
                } else if outcome.out_of_context {
                    reply.note = Some(OUT_OF_CONTEXT.to_owned());
                }
            }
            Err(error) => reply.note = Some(error.to_string()),
        }
    }
}

const OUT_OF_CONTEXT: &str = "The conversation no longer fits the model's context window.";

/// The speed line under a finished reply, such as "120 tokens, 41.5 tok/s".
pub fn metrics_line(metrics: &MetricsRecord) -> String {
    format!(
        "{} tokens, {:.1} tok/s",
        metrics.response_tokens.round(),
        metrics.tokens_per_second
    )
}

/// A one-line description of a step the agent took, for the list under a reply. Steps that carry no visible content
/// (the model's thinking, for one) give `None`.
pub fn step_label(step: &StepRecord) -> Option<String> {
    let detail = step
        .filepath
        .as_deref()
        .or(step.filename.as_deref())
        .or(step.content.as_deref())
        .map(|text| text.lines().next().unwrap_or_default().trim())
        .filter(|text| !text.is_empty())?;
    let state = if step.is_complete == Some(true) {
        ""
    } else {
        " (running)"
    };
    Some(format!("{}: {detail}{state}", step.kind))
}

/// The core's messages in the form they are saved in.
pub fn to_saved(records: &[MessageRecord]) -> Vec<SavedMessage> {
    records
        .iter()
        .map(|record| SavedMessage {
            id: record.id.clone(),
            role: record.role.clone(),
            content: record.content.clone(),
        })
        .collect()
}

/// Saved messages in the form `Session::restore` takes.
pub fn to_records(saved: &[SavedMessage]) -> Vec<MessageRecord> {
    saved
        .iter()
        .map(|message| MessageRecord {
            id: message.id.clone(),
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect()
}

/// What the core's threads send to the window.
pub enum ChatMessage {
    Events(Vec<TurnEventRecord>),
    /// A tool call needs the user. The turn's thread waits on `reply`.
    Approval {
        request: ApprovalRecord,
        reply: mpsc::Sender<ApprovalChoice>,
    },
    Finished(Result<TurnOutcome, CoreError>),
}

struct Observer(Sender<ChatMessage>);

impl TurnObserver for Observer {
    fn on_events(&self, events: Vec<TurnEventRecord>) {
        // A closed window has nobody to tell.
        drop(self.0.send_blocking(ChatMessage::Events(events)));
    }
}

struct Approvals(Sender<ChatMessage>);

impl ApprovalHandler for Approvals {
    fn ask(&self, request: ApprovalRecord) -> ApprovalChoice {
        let (reply, answer) = mpsc::channel();
        if self
            .0
            .send_blocking(ChatMessage::Approval { request, reply })
            .is_err()
        {
            return ApprovalChoice::No;
        }
        // A dropped dialog counts as a refusal.
        answer.recv().unwrap_or(ApprovalChoice::No)
    }
}

/// Runs one turn on the shell's runtime. Events, approval questions and finally the outcome arrive on `tx`. The
/// returned token stops the turn.
pub fn start_turn(
    session: Arc<Session>,
    text: String,
    tx: Sender<ChatMessage>,
) -> Arc<CancelToken> {
    let cancel = CancelToken::new();
    let token = Arc::clone(&cancel);
    runtime().spawn(async move {
        let observer: Arc<dyn TurnObserver> = Arc::new(Observer(tx.clone()));
        let approvals: Arc<dyn ApprovalHandler> = Arc::new(Approvals(tx.clone()));
        let result = session.send(text, observer, Some(approvals), cancel).await;
        drop(tx.send(ChatMessage::Finished(result)).await);
    });
    token
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(text: &str) -> TurnEventRecord {
        TurnEventRecord::Patch {
            content: text.to_owned(),
            text_content: text.to_owned(),
            steps: Vec::new(),
        }
    }

    fn step(kind: &str, content: &str, complete: bool) -> StepRecord {
        StepRecord {
            kind: kind.to_owned(),
            content: Some(content.to_owned()),
            is_complete: Some(complete),
            ..StepRecord::default()
        }
    }

    #[test]
    fn a_turn_adds_the_message_and_an_empty_reply() {
        let mut transcript = Transcript::default();
        let reply = transcript.begin_turn("hello");
        assert_eq!(reply, 1);
        assert_eq!(transcript.entries()[0].role, Role::User);
        assert_eq!(transcript.entries()[0].text, "hello");
        assert!(transcript.entries()[1].streaming);
        assert!(transcript.is_busy());
    }

    #[test]
    fn the_latest_snapshot_in_a_batch_wins() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.apply(&[patch("Hel"), patch("Hello")]);
        assert_eq!(transcript.entries()[1].text, "Hello");
        transcript.apply(&[patch("Hello there")]);
        assert_eq!(transcript.entries()[1].text, "Hello there");
    }

    #[test]
    fn steps_and_metrics_are_kept() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.apply(&[
            TurnEventRecord::Steps {
                steps: vec![step("read_file", "a.txt", true)],
            },
            TurnEventRecord::Metrics {
                metrics: MetricsRecord {
                    response_tokens: 12.0,
                    tokens_per_second: 30.0,
                    ..MetricsRecord::default()
                },
            },
        ]);
        let reply = &transcript.entries()[1];
        assert_eq!(reply.steps.len(), 1);
        assert_eq!(
            reply.metrics.as_ref().map(metrics_line).as_deref(),
            Some("12 tokens, 30.0 tok/s")
        );
    }

    #[test]
    fn a_saved_conversation_restores_its_text_and_ids() {
        let saved = [
            SavedMessage {
                id: "m1".to_owned(),
                role: "user".to_owned(),
                content: "hi".to_owned(),
            },
            SavedMessage {
                id: "m2".to_owned(),
                role: "assistant".to_owned(),
                content: "hello".to_owned(),
            },
        ];
        let transcript = Transcript::from_saved(&saved);
        assert_eq!(transcript.entries().len(), 2);
        assert_eq!(transcript.entries()[1].role, Role::Assistant);
        assert_eq!(transcript.entries()[1].text, "hello");
        assert!(!transcript.is_busy());
        let records = to_records(&saved);
        assert_eq!(records[0].id, "m1");
        assert_eq!(to_saved(&records), saved);
    }

    #[test]
    fn events_after_the_turn_ended_change_nothing() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.apply(&[patch("done")]);
        transcript.finish(Ok(TurnOutcome::default()));
        transcript.apply(&[patch("late")]);
        assert_eq!(transcript.entries()[1].text, "done");
        assert!(!transcript.is_busy());
    }

    #[test]
    fn a_finished_turn_keeps_the_streamed_text_when_the_outcome_has_none() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.apply(&[patch("partial")]);
        transcript.finish(Ok(TurnOutcome::default()));
        assert_eq!(transcript.entries()[1].text, "partial");
        assert!(transcript.entries()[1].note.is_none());
    }

    #[test]
    fn the_outcome_text_replaces_the_stream() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.apply(&[patch("par")]);
        transcript.finish(Ok(TurnOutcome {
            text_content: "full answer".to_owned(),
            ..TurnOutcome::default()
        }));
        assert_eq!(transcript.entries()[1].text, "full answer");
    }

    #[test]
    fn a_stopped_turn_says_so() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.finish(Ok(TurnOutcome {
            aborted: true,
            ..TurnOutcome::default()
        }));
        assert_eq!(transcript.entries()[1].note.as_deref(), Some("Stopped."));
    }

    #[test]
    fn a_turn_that_ran_out_of_passes_says_how_many() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.finish(Ok(TurnOutcome {
            exhausted: true,
            loops: 8,
            ..TurnOutcome::default()
        }));
        assert_eq!(
            transcript.entries()[1].note.as_deref(),
            Some("Stopped after 8 passes without an answer.")
        );
    }

    #[test]
    fn a_failed_turn_shows_the_error() {
        let mut transcript = Transcript::default();
        transcript.begin_turn("hi");
        transcript.finish(Err(CoreError::Model {
            message: "The server refused the request.".to_owned(),
        }));
        let reply = &transcript.entries()[1];
        assert!(!reply.streaming);
        assert_eq!(
            reply.note.as_deref(),
            Some("The server refused the request.")
        );
    }

    #[test]
    fn running_and_finished_steps_are_labelled() {
        assert_eq!(
            step_label(&step("read_file", "a.txt\nmore", false)).as_deref(),
            Some("read_file: a.txt (running)")
        );
        assert_eq!(
            step_label(&step("list_directory", "src", true)).as_deref(),
            Some("list_directory: src")
        );
        let path = StepRecord {
            kind: "write_file".to_owned(),
            filepath: Some("/p/x.rs".to_owned()),
            content: Some("body".to_owned()),
            is_complete: Some(true),
            ..StepRecord::default()
        };
        assert_eq!(step_label(&path).as_deref(), Some("write_file: /p/x.rs"));
        assert!(step_label(&step("think", "  ", true)).is_none());
    }

    #[test]
    fn a_refused_window_refuses_the_approval() {
        let (tx, rx) = async_channel::unbounded();
        drop(rx);
        let choice = Approvals(tx).ask(ApprovalRecord {
            id: "1".to_owned(),
            tool: "run_command".to_owned(),
            target: None,
            reason: String::new(),
        });
        assert_eq!(choice, ApprovalChoice::No);
    }

    #[test]
    fn an_approval_waits_for_the_answer() {
        let (tx, rx) = async_channel::unbounded();
        let asker = std::thread::spawn(move || {
            Approvals(tx).ask(ApprovalRecord {
                id: "1".to_owned(),
                tool: "run_command".to_owned(),
                target: Some("ls".to_owned()),
                reason: String::new(),
            })
        });
        match rx.recv_blocking().expect("a message") {
            ChatMessage::Approval { request, reply } => {
                assert_eq!(request.target.as_deref(), Some("ls"));
                reply.send(ApprovalChoice::Once).expect("the asker waits");
            }
            _ => panic!("expected an approval"),
        }
        assert_eq!(asker.join().expect("joined"), ApprovalChoice::Once);
    }

    #[test]
    fn a_session_against_a_dead_server_ends_with_an_error_not_a_hang() {
        let session = Session::new(draggy_core::SessionConfig {
            base_url: "http://127.0.0.1:9/v1".to_owned(),
            model: "none".to_owned(),
            api_key: None,
            folder: None,
            context_tokens: None,
            loop_limit: None,
            allow_commands: false,
            permission_mode: None,
        })
        .expect("a session");
        let (tx, rx) = async_channel::unbounded();
        let _cancel = start_turn(session, "hello".to_owned(), tx);
        loop {
            match rx.recv_blocking().expect("the turn reports") {
                ChatMessage::Finished(result) => {
                    let mut transcript = Transcript::default();
                    transcript.begin_turn("hello");
                    transcript.finish(result);
                    let reply = &transcript.entries()[1];
                    assert!(!reply.streaming);
                    assert!(reply.note.is_some() || !reply.text.is_empty());
                    break;
                }
                _ => continue,
            }
        }
    }
}
