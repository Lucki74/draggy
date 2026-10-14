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
use serde_json::{Value, json};

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
}

/// The tool definitions a model is offered when the session has a folder.
pub fn definitions() -> Vec<ToolDefinition> {
    vec![
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
    ]
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
    pub fn new(folder: &str) -> Self {
        let root = PathBuf::from(folder);
        let roots: Roots = Box::new(move |_workspace| vec![root.clone()]);
        Self {
            ops: FileOps::new(Guard::default(), NoStore, NoRecycler, roots),
            folder: folder.to_owned(),
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
            _ => ToolAnnotations::default(),
        }
    }

    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        match name {
            "read_file" => self.read(args, ctx),
            "list_directory" => self.list(args, ctx),
            other => format!(
                "TOOL ERROR: There is no tool called \"{other}\". Available tools: read_file, list_directory."
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
