//! The background task tools: `task_output`, `task_list`, `task_stop`, `task_wait` and `task_input`, plus the
//! `background` flag of `run_command`. A session owns one [`TaskSet`], so tasks outlive the turn that started them
//! and the model hears about the ones that ended on its next tool call.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use draggy_agent::agent_loop::ToolContext;
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::resume::SearchStep;
use draggy_agent::tool_channel::ToolDefinition;
use draggy_tools::spawn::CancelToken as RunCancel;
use draggy_tools::tasks::{
    MAX_WAIT, OutputQuery, Status, TaskError, TaskInfo, TaskManager, describe_ended, describe_task,
};
use serde_json::{Value, json};

use crate::records::TaskRecord;
use crate::tools::definition;

/// A Rust session holds one chat, so every task lives under one name.
const CHAT: &str = "chat";
const DEFAULT_WAIT: f64 = 30.0;

const NAMES: [&str; 5] = [
    "task_output",
    "task_list",
    "task_stop",
    "task_wait",
    "task_input",
];

/// The tasks of a session and, per task, how far the model has read.
#[derive(Clone)]
pub struct TaskSet {
    manager: TaskManager,
    cursors: Arc<Mutex<HashMap<String, usize>>>,
}

impl Default for TaskSet {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskSet {
    pub fn new() -> Self {
        Self {
            manager: TaskManager::new(std::env::temp_dir().join("draggy-tasks")),
            cursors: Arc::default(),
        }
    }

    /// Stops whatever still runs. Called when the session ends.
    pub fn shutdown(&self) {
        self.manager.shutdown();
    }

    fn cursor(&self, id: &str) -> Option<f64> {
        let cursors = self.cursors.lock().unwrap_or_else(PoisonError::into_inner);
        cursors.get(id).map(|at| *at as f64)
    }

    fn advance(&self, id: &str, to: usize) {
        let mut cursors = self.cursors.lock().unwrap_or_else(PoisonError::into_inner);
        cursors.insert(id.to_owned(), to);
    }

    /// Every task of the session, for the shell's own list.
    pub fn records(&self) -> Vec<TaskRecord> {
        self.manager
            .list(CHAT)
            .into_iter()
            .map(|info| TaskRecord {
                status: match info.status {
                    Status::Running => "running",
                    Status::Exited => "exited",
                    Status::Failed => "failed",
                    Status::Stopped => "stopped",
                }
                .to_owned(),
                id: info.id,
                command: info.command,
                exit_code: info.exit_code,
                running_for_ms: u64::try_from(info.running_for.as_millis()).unwrap_or(u64::MAX),
                last_line: info.last_line,
            })
            .collect()
    }

    /// Stops a task from the shell's list. A task that already ended is left as it is.
    pub fn stop_task(&self, id: &str) {
        let _ = self.manager.stop(CHAT, id);
    }

    /// What ended since the model last heard, or nothing.
    pub fn ended_notice(&self) -> Option<String> {
        let ended = self.manager.take_ended(CHAT);
        (!ended.is_empty()).then(|| describe_ended(&ended))
    }

    /// Starts a command that keeps running after the call returns.
    pub fn start(
        &self,
        command: &str,
        shell: Option<&str>,
        cwd: &Path,
        ctx: &mut ToolContext<'_>,
    ) -> String {
        match self.manager.start(CHAT, command, shell, cwd, None) {
            Ok(info) => {
                let id = ctx.new_id();
                ctx.steps.push(SearchStep {
                    id: Some(id),
                    kind: "command".to_owned(),
                    content: Some(format!("Started `{command}` in the background")),
                    is_complete: Some(true),
                    language: Some(info.shell.clone()),
                    ..SearchStep::default()
                });
                format!(
                    "TOOL RESULT (run_command): Started in the background as task {}. Read it with task_output, wait for it with task_wait, end it with task_stop. You are told when it ends.",
                    info.id
                )
            }
            Err(error) => format!("TOOL RESULT (run_command): {error}"),
        }
    }

    pub fn run(&self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let id = args.get("task_id").and_then(Value::as_str).unwrap_or("");
        let reply = match name {
            "task_output" => self.output(id, args),
            "task_list" => Ok(self.list()),
            "task_stop" => self.stop(id),
            "task_wait" => self.wait(id, args, ctx),
            "task_input" => self.input(id, args),
            other => Ok(format!("There is no task tool called \"{other}\".")),
        };
        match reply {
            Ok(text) => format!("TOOL RESULT ({name}): {text}"),
            Err(error) => format!("TOOL RESULT ({name}): {error}"),
        }
    }

    fn output(&self, id: &str, args: &Value) -> Result<String, TaskError> {
        let tail = args.get("tail").and_then(Value::as_f64);
        let grep = args.get("grep").and_then(Value::as_str).map(str::to_owned);
        let since = args.get("since").and_then(Value::as_f64);
        // A plain read continues where the last one stopped; a filtered one reads the whole output.
        let unfiltered = tail.is_none() && grep.is_none() && since.is_none();
        let from = if unfiltered { self.cursor(id) } else { since };
        let read = self.manager.output(
            CHAT,
            id,
            &OutputQuery {
                since: from,
                tail,
                grep,
            },
        )?;
        if unfiltered {
            self.advance(id, read.next);
        }
        let text = match args.get("max_chars").and_then(Value::as_f64) {
            Some(max) if max >= 1.0 => last_chars(&read.text, max as usize),
            _ => read.text,
        };
        let cut = if read.truncated {
            " The middle was cut."
        } else {
            ""
        };
        let shown = if text.is_empty() {
            "(no new output)"
        } else {
            text.as_str()
        };
        Ok(format!(
            "{}. Next offset {}.{cut}\n\n{shown}",
            describe_task(&read.info),
            read.next
        ))
    }

    fn list(&self) -> String {
        let tasks = self.manager.list(CHAT);
        if tasks.is_empty() {
            return "There are no background tasks in this chat.".to_owned();
        }
        let lines: Vec<String> = tasks.iter().map(describe_task).collect();
        format!(
            "{} task{}.\n\n{}",
            tasks.len(),
            if tasks.len() == 1 { "" } else { "s" },
            lines.join("\n")
        )
    }

    fn stop(&self, id: &str) -> Result<String, TaskError> {
        match self.manager.stop(CHAT, id) {
            Ok(info) => Ok(format!(
                "Task {} is stopped. {}",
                info.id,
                describe_task(&info)
            )),
            Err(TaskError::NotRunning(_)) => {
                let info = self.find(id)?;
                Ok(format!(
                    "Task {id} had already ended. {}",
                    describe_task(&info)
                ))
            }
            Err(error) => Err(error),
        }
    }

    fn find(&self, id: &str) -> Result<TaskInfo, TaskError> {
        self.manager
            .list(CHAT)
            .into_iter()
            .find(|info| info.id == id)
            .ok_or_else(|| TaskError::Unknown(id.to_owned()))
    }

    fn wait(&self, id: &str, args: &Value, ctx: &ToolContext<'_>) -> Result<String, TaskError> {
        let seconds = args
            .get("seconds")
            .and_then(Value::as_f64)
            .filter(|seconds| *seconds >= 1.0)
            .unwrap_or(DEFAULT_WAIT)
            .min(MAX_WAIT.as_secs_f64());
        let until = args.get("until").and_then(Value::as_str);

        // Escape stops the turn; the wait watches for it from a second thread because it blocks this one.
        let halt = RunCancel::new();
        let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let result = std::thread::scope(|scope| {
            let (watch, done, signal) = (halt.clone(), Arc::clone(&finished), ctx.cancel.clone());
            scope.spawn(move || {
                while !done.load(std::sync::atomic::Ordering::SeqCst) {
                    if signal.is_aborted() {
                        watch.cancel();
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            });
            let result =
                self.manager
                    .wait(CHAT, id, until, Duration::from_secs_f64(seconds), &halt);
            finished.store(true, std::sync::atomic::Ordering::SeqCst);
            result
        })?;

        let why = if result.cancelled {
            "The wait was cancelled."
        } else if result.timed_out {
            "The time ran out and the task is still going."
        } else if result.matched {
            "The output matched."
        } else {
            "The task ended."
        };
        let shown = if result.text.is_empty() {
            "(no new output)"
        } else {
            result.text.as_str()
        };
        Ok(format!(
            "{why} {}. Next offset {}.\n\n{shown}",
            describe_task(&result.info),
            result.next
        ))
    }

    fn input(&self, id: &str, args: &Value) -> Result<String, TaskError> {
        let text = args.get("text").and_then(Value::as_str);
        let key = args.get("key").and_then(Value::as_str);
        let enter = args.get("enter").and_then(Value::as_bool).unwrap_or(true);
        let Some(data) = input_for(text, key, enter) else {
            return Ok("Give text to type, or a key: enter, tab, space or ctrl+d. This task reads a pipe, so keys that need a terminal are not available.".to_owned());
        };
        self.manager.input(CHAT, id, &data)?;
        Ok(format!(
            "Sent to task {id}. Read what it printed with task_output."
        ))
    }
}

/// What to write to a task's stdin, or `None` when the request names nothing that can be sent.
fn input_for(text: Option<&str>, key: Option<&str>, enter: bool) -> Option<String> {
    if let Some(text) = text.filter(|text| !text.is_empty()) {
        return Some(if enter {
            format!("{text}\n")
        } else {
            text.to_owned()
        });
    }
    match key?.trim().to_lowercase().as_str() {
        "enter" => Some("\n".to_owned()),
        "tab" => Some("\t".to_owned()),
        "space" => Some(" ".to_owned()),
        "ctrl+d" => Some("\u{4}".to_owned()),
        _ => None,
    }
}

fn last_chars(text: &str, count: usize) -> String {
    let total = text.chars().count();
    text.chars().skip(total.saturating_sub(count)).collect()
}

pub fn owns(name: &str) -> bool {
    NAMES.contains(&name)
}

pub fn annotations(name: &str) -> ToolAnnotations {
    match name {
        "task_output" | "task_list" | "task_wait" => ToolAnnotations {
            read_only: true,
            ..ToolAnnotations::default()
        },
        "task_stop" => ToolAnnotations {
            sandboxed: true,
            idempotent: true,
            ..ToolAnnotations::default()
        },
        "task_input" => ToolAnnotations {
            executes: true,
            open_world: true,
            ..ToolAnnotations::default()
        },
        _ => ToolAnnotations::default(),
    }
}

pub fn definitions() -> Vec<ToolDefinition> {
    let id = json!({"type": "string", "description": "The task id from run_command or task_list, like \"t1\"."});
    vec![
        definition(
            "task_output",
            "Read the output of a background task. By default it returns what the task printed since you last read it. Use tail for the last lines, grep for the lines that match a pattern, or since with the next value from an earlier read.",
            &json!({
                "type": "object",
                "properties": {
                    "task_id": id,
                    "tail": {"type": "integer", "description": "Optional. Return only the last this many lines of the whole output."},
                    "grep": {"type": "string", "description": "Optional. Return only the lines of the whole output that match this regular expression, with their line numbers."},
                    "since": {"type": "integer", "description": "Optional. Return the output after this character offset, the next value an earlier read gave."},
                    "max_chars": {"type": "integer", "description": "Optional. Return at most this many characters, the latest ones."}
                },
                "required": ["task_id"]
            }),
        ),
        definition(
            "task_list",
            "List the background tasks of this chat, running or ended, with their state.",
            &json!({"type": "object", "properties": {}, "required": []}),
        ),
        definition(
            "task_stop",
            "End a background task and everything it started. Use it for a server or watcher you no longer need.",
            &json!({"type": "object", "properties": {"task_id": id}, "required": ["task_id"]}),
        ),
        definition(
            "task_wait",
            "Wait for a background task to end, or for a pattern to show up in its new output, for up to 120 seconds. Use it when nothing else is left to do until the task is ready, such as a server that has to start.",
            &json!({
                "type": "object",
                "properties": {
                    "task_id": id,
                    "seconds": {"type": "integer", "description": "Optional. How long to wait, up to 120. Defaults to 30."},
                    "until": {"type": "string", "description": "Optional. A regular expression; the wait ends when new output matches it."}
                },
                "required": ["task_id"]
            }),
        ),
        definition(
            "task_input",
            "Type into a background task to answer a prompt it is waiting on. Give text (sent with Enter unless enter is false) or a key: enter, tab, space or ctrl+d. The task reads a pipe, not a terminal.",
            &json!({
                "type": "object",
                "properties": {
                    "task_id": id,
                    "text": {"type": "string", "description": "Optional. What to type."},
                    "key": {"type": "string", "description": "Optional. A key to press: enter, tab, space or ctrl+d."},
                    "enter": {"type": "boolean", "description": "Optional. Press Enter after the text. Defaults to true."}
                },
                "required": ["task_id"]
            }),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_sent_with_enter_unless_told_otherwise() {
        assert_eq!(input_for(Some("y"), None, true).as_deref(), Some("y\n"));
        assert_eq!(input_for(Some("y"), None, false).as_deref(), Some("y"));
    }

    #[test]
    fn a_named_key_is_sent_alone() {
        assert_eq!(
            input_for(None, Some(" Enter "), true).as_deref(),
            Some("\n")
        );
        assert_eq!(
            input_for(None, Some("ctrl+d"), true).as_deref(),
            Some("\u{4}")
        );
    }

    #[test]
    fn unknown_keys_and_empty_requests_send_nothing() {
        assert_eq!(input_for(None, Some("f13"), true), None);
        assert_eq!(input_for(None, None, true), None);
        assert_eq!(input_for(Some(""), None, true), None);
    }

    #[test]
    fn last_chars_keeps_the_end() {
        assert_eq!(last_chars("héllo", 3), "llo");
        assert_eq!(last_chars("ab", 9), "ab");
    }

    #[test]
    fn every_name_has_a_definition() {
        let defined: Vec<String> = definitions().into_iter().map(|d| d.function.name).collect();
        for name in NAMES {
            assert!(defined.iter().any(|d| d == name), "{name}");
            assert!(owns(name));
        }
    }
}
