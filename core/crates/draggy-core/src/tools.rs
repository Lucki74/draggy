//! The tools a session offers. The harness set is read-only: `read_file` and `list_directory`, both inside the
//! project folder and both behind the same guard the Electron app uses. More tools join here as they are wired.

use std::path::PathBuf;

use draggy_agent::agent_loop::{ToolContext, ToolRuntime};
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::resume::SearchStep;
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_tools::files::{
    Checkpoint, CheckpointStore, FileOps, NewCheckpoint, Recycler, StoreError,
};
use draggy_tools::fs_guard::Guard;
use draggy_tools::shell::{CommandRequest, run_command};
use draggy_tools::spawn::CancelToken as RunCancel;
use serde_json::{Value, json};
use std::time::Duration;

/// A store that keeps nothing. The read tools never write a checkpoint, so none is needed.
struct NoStore;

impl CheckpointStore for NoStore {
    fn keep(&self, bytes: &[u8]) -> Result<String, StoreError> {
        Ok(draggy_tools::files::content_hash(bytes))
    }

    fn read(&self, _hash: &str) -> Option<Vec<u8>> {
        None
    }

    fn add(&self, _entry: &NewCheckpoint) -> Result<i64, StoreError> {
        Err(StoreError("this session cannot change files".to_owned()))
    }

    fn get(&self, _id: i64) -> Result<Option<Checkpoint>, StoreError> {
        Ok(None)
    }

    fn drop_checkpoint(&self, _id: i64) -> Result<(), StoreError> {
        Ok(())
    }
}

struct NoRecycler;

impl Recycler for NoRecycler {
    fn recycle(&self, _path: &std::path::Path) -> std::io::Result<()> {
        Err(std::io::Error::other("this session cannot change files"))
    }
}

type Roots = Box<dyn Fn(&str) -> Vec<PathBuf>>;

pub struct FileTools {
    ops: FileOps<NoStore, NoRecycler, Roots>,
    folder: String,
    allow_commands: bool,
}

/// The tool definitions a model is offered when the session has a folder. `run_command` is offered only when the
/// session allows commands; every call to it still goes through the permission engine.
pub fn definitions(allow_commands: bool) -> Vec<ToolDefinition> {
    let mut tools = vec![
        definition(
            "read_file",
            "Read a text file from the project folder. Use it before changing anything.",
            &json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file, relative to the project folder, for example src/App.tsx."
                    }
                },
                "required": ["path"]
            }),
        ),
        definition(
            "list_directory",
            "List what is in a folder of the project. Use it to find your way around before reading files.",
            &json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Folder to list, relative to the project folder. Leave empty for the project folder itself."
                    }
                },
                "required": []
            }),
        ),
    ];
    if allow_commands {
        tools.push(definition(
            "run_command",
            "Run a command in the project folder, the way a developer types it in a terminal: git, gh, npm, pnpm, cargo, python, tests, builds and linters. Returns what it printed and its exit code. Nothing can be typed into it while it runs, so pass flags that avoid prompts.",
            &json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command line to run, as it would be typed."},
                    "shell": {"type": "string", "description": "Optional. One of \"bash\" or \"sh\". Leave it out to use this computer's default shell."},
                    "timeout_seconds": {"type": "integer", "description": "Optional. How long it may run before it is stopped, up to 600. Defaults to 120."}
                },
                "required": ["command"]
            }),
        ));
    }
    tools
}

fn definition(name: &str, description: &str, parameters: &Value) -> ToolDefinition {
    ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: name.to_owned(),
            description: description.to_owned(),
            parameters: parameters.clone(),
        },
    }
}

impl FileTools {
    pub fn new(folder: &str, allow_commands: bool) -> Self {
        let root = PathBuf::from(folder);
        let roots: Roots = Box::new(move |_workspace| vec![root.clone()]);
        Self {
            ops: FileOps::new(Guard::default(), NoStore, NoRecycler, roots),
            folder: folder.to_owned(),
            allow_commands,
        }
    }

    fn command(&self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned();
        let shell = args
            .get("shell")
            .and_then(Value::as_str)
            .filter(|name| matches!(*name, "bash" | "sh"))
            .map(str::to_owned);
        let seconds = args
            .get("timeout_seconds")
            .and_then(Value::as_f64)
            .filter(|seconds| *seconds >= 1.0)
            .unwrap_or(120.0)
            .min(600.0);
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id.clone()),
            kind: "command".to_owned(),
            content: Some(format!("Running `{command}`")),
            is_complete: Some(false),
            language: shell.clone(),
            ..SearchStep::default()
        });

        let halt = RunCancel::new();
        let request = CommandRequest {
            cwd: PathBuf::from(&self.folder),
            command: command.clone(),
            shell,
            timeout_ms: Some(seconds * 1000.0),
            base_env: None,
            cancel: halt.clone(),
        };
        let outcome = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime.block_on(async {
                    let run = run_command(request);
                    tokio::pin!(run);
                    loop {
                        tokio::select! {
                            done = &mut run => break done.map_err(|error| error.to_string()),
                            () = tokio::time::sleep(Duration::from_millis(50)) => {
                                // Stopping the turn stops the command and whatever it started.
                                if ctx.cancel.is_aborted() {
                                    halt.cancel();
                                }
                            }
                        }
                    }
                })
            });

        let set = |ctx: &mut ToolContext<'_>,
                   kind: Option<&str>,
                   text: String,
                   stdout: Option<String>| {
            if let Some(step) = ctx
                .steps
                .iter_mut()
                .find(|step| step.id.as_deref() == Some(id.as_str()))
            {
                step.is_complete = Some(true);
                if let Some(kind) = kind {
                    kind.clone_into(&mut step.kind);
                }
                step.content = Some(text);
                if stdout.is_some() {
                    step.stdout = stdout;
                }
            }
        };

        match outcome {
            Err(error) => {
                set(
                    ctx,
                    Some("error"),
                    format!("Could not run `{command}`: {error}"),
                    None,
                );
                format!("TOOL RESULT (run_command): Could not run the command. {error}")
            }
            Ok(done) => {
                let verb = if done.cancelled {
                    "Stopped"
                } else if done.timed_out {
                    "Timed out"
                } else if done.success {
                    "Ran"
                } else {
                    "Failed"
                };
                let exit = if done.success || done.cancelled {
                    String::new()
                } else {
                    format!(
                        " (exit {})",
                        done.exit_code
                            .map_or("?".to_owned(), |code| code.to_string())
                    )
                };
                set(
                    ctx,
                    None,
                    format!("{verb} `{command}`{exit}"),
                    Some(done.output.clone()),
                );
                if done.cancelled {
                    return "TOOL RESULT (run_command): The user stopped the command.".to_owned();
                }
                let status = if done.timed_out {
                    format!(
                        "The command was still running after {seconds} seconds and was stopped."
                    )
                } else {
                    format!(
                        "Exit code {}.",
                        done.exit_code
                            .map_or("?".to_owned(), |code| code.to_string())
                    )
                };
                let cut = if done.truncated {
                    " The middle of the output was cut."
                } else {
                    ""
                };
                let shown = if done.output.is_empty() {
                    "(no output)"
                } else {
                    done.output.as_str()
                };
                format!("TOOL RESULT (run_command): {status}{cut}\n\n{shown}")
            }
        }
    }

    fn step(ctx: &mut ToolContext<'_>, text: String, filename: Option<String>) -> String {
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id.clone()),
            kind: "reading".to_owned(),
            content: Some(text),
            is_complete: Some(false),
            filename,
            ..SearchStep::default()
        });
        id
    }

    fn settle(ctx: &mut ToolContext<'_>, id: &str, kind: Option<&str>, path: Option<String>) {
        if let Some(step) = ctx
            .steps
            .iter_mut()
            .find(|step| step.id.as_deref() == Some(id))
        {
            step.is_complete = Some(true);
            if let Some(kind) = kind {
                kind.clone_into(&mut step.kind);
            }
            if path.is_some() {
                step.filepath = path;
            }
        }
    }

    fn read(&self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let target = args.get("path").and_then(Value::as_str).unwrap_or("");
        let id = Self::step(
            ctx,
            format!("Reading **{}**", draggy_tools::files::name_of(target)),
            Some(draggy_tools::files::name_of(target)),
        );
        match self.ops.read("default", target) {
            Ok(opened) => {
                let path = opened.path.display().to_string();
                Self::settle(ctx, &id, None, Some(path.clone()));
                format!("TOOL RESULT (read_file) {path}:\n{}", opened.text)
            }
            Err(error) => {
                Self::settle(ctx, &id, Some("error"), None);
                format!("TOOL RESULT (read_file): {error}")
            }
        }
    }

    fn list(&self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let target = args
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .unwrap_or(".");
        let label = if target == "." {
            draggy_tools::files::name_of(&self.folder)
        } else {
            draggy_tools::files::name_of(target)
        };
        let id = Self::step(ctx, format!("Listing **{label}**"), None);
        match self.ops.list("default", target) {
            Ok(listing) => {
                let path = listing.path.display().to_string();
                Self::settle(ctx, &id, None, Some(path.clone()));
                let lines: Vec<String> = listing
                    .entries
                    .iter()
                    .map(|entry| {
                        if entry.is_directory {
                            format!("{}/", entry.name)
                        } else {
                            format!("{} ({} bytes)", entry.name, entry.size)
                        }
                    })
                    .collect();
                let tail = if listing.truncated {
                    "\n... and more, not listed."
                } else {
                    ""
                };
                format!(
                    "TOOL RESULT (list_directory) {path}:\n{}{tail}",
                    lines.join("\n")
                )
            }
            Err(error) => {
                Self::settle(ctx, &id, Some("error"), None);
                format!("TOOL RESULT (list_directory): {error}")
            }
        }
    }
}

impl ToolRuntime for FileTools {
    fn annotations(&self, name: &str) -> ToolAnnotations {
        match name {
            "read_file" | "list_directory" => ToolAnnotations {
                read_only: true,
                idempotent: true,
                ..ToolAnnotations::default()
            },
            "run_command" if self.allow_commands => ToolAnnotations {
                executes: true,
                open_world: true,
                ..ToolAnnotations::default()
            },
            _ => ToolAnnotations::default(),
        }
    }

    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        match name {
            "read_file" => self.read(args, ctx),
            "list_directory" => self.list(args, ctx),
            "run_command" if self.allow_commands => self.command(args, ctx),
            other => format!(
                "TOOL ERROR: There is no tool called \"{other}\". Available tools: read_file, list_directory, run_command."
            ),
        }
    }
}

/// A runtime for a session with no folder: it offers nothing, and answers any call with the available tools.
pub struct NoTools;

impl ToolRuntime for NoTools {
    fn annotations(&self, _name: &str) -> ToolAnnotations {
        ToolAnnotations::default()
    }

    fn run(&mut self, name: &str, _args: &Value, _ctx: &mut ToolContext<'_>) -> String {
        format!("TOOL ERROR: There is no tool called \"{name}\". No tools are available.")
    }
}
