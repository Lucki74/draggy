//! Whether a tool call may run: a port of `src/agent/permissions.ts`. One pure function for built-in and MCP tools,
//! with flags mirroring MCP's own annotations, so there is one answer everywhere.

use serde_json::Value;

use crate::command_rules::{command_covered, command_grant_targets, dialect_for};
use crate::js::trim_js;

const PLAN_REFUSAL: &str = "This conversation is in plan mode, which cannot change anything or run commands. Describe what you would do instead, and the user will decide.";

/// What a tool call can do to the world. A missing flag reads as the cautious answer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ToolAnnotations {
    /// Reads or searches. Changes nothing, anywhere.
    pub read_only: bool,
    /// Can lose work: deletes, overwrites, moves.
    pub destructive: bool,
    /// Running it twice is the same as running it once.
    pub idempotent: bool,
    /// Reaches the network, or drives a browser at a real site.
    pub open_world: bool,
    /// Its effects stay inside Draggy's own storage.
    pub sandboxed: bool,
    /// Runs a command on the user's computer, which can do anything the user can.
    pub executes: bool,
}

/// The modes a conversation can be in, as the settings name them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Plan,
    Ask,
    AcceptEdits,
    Auto,
}

/// Something the user has already agreed to. No target covers every call of the tool; a target covers that path or
/// address and anything under it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    pub tool: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
    Deny,
}

/// A decision and the reason, which is shown to the user and handed to the model on a refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub decision: Decision,
    pub reason: String,
}

/// One call to decide: the mode, the tool, what it can do, what it is about, and what is already allowed.
#[derive(Debug, Clone, Copy)]
pub struct PermissionQuery<'a> {
    pub mode: PermissionMode,
    pub tool: &'a str,
    pub annotations: ToolAnnotations,
    pub target: Option<&'a str>,
    pub grants: &'a [Grant],
    /// The shell a command runs in; a missing one reads as the strictest grammar.
    pub shell: Option<&'a str>,
}

/// Whether a tool call may run.
pub fn decide(query: &PermissionQuery<'_>) -> Verdict {
    let annotations = query.annotations;

    // Reading is allowed everywhere, plan mode included: looking at the project is exactly what plan mode is for.
    if annotations.read_only {
        return verdict(Decision::Allow, "This tool only reads.");
    }
    if query.mode == PermissionMode::Plan {
        return verdict(Decision::Deny, PLAN_REFUSAL);
    }
    if query.mode == PermissionMode::Auto {
        return verdict(Decision::Allow, "This workspace runs tools without asking.");
    }

    // A command can do anything, so accepting edits does not cover it; only an earlier "always" for every command
    // in the line does.
    if annotations.executes {
        let allowed: Vec<String> = query
            .grants
            .iter()
            .filter(|grant| grant.tool == query.tool)
            .filter_map(|grant| grant.target.clone().filter(|target| !target.is_empty()))
            .collect();
        if command_covered(&allowed, query.target, dialect_for(query.shell)) {
            return verdict(
                Decision::Allow,
                "The user has already allowed this command.",
            );
        }
        return verdict(
            Decision::Ask,
            "This runs a command on the user's computer, so the user is asked first.",
        );
    }

    // Writing a file Draggy made, running code in the scratch directory, driving the embedded browser: nothing here
    // is the user's to lose.
    if annotations.sandboxed && !annotations.destructive {
        return verdict(Decision::Allow, "This stays inside Draggy's own storage.");
    }

    if query
        .grants
        .iter()
        .any(|grant| grant_covers(grant, query.tool, query.target))
    {
        return verdict(Decision::Allow, "The user has already allowed this.");
    }

    if query.mode == PermissionMode::AcceptEdits && !annotations.destructive {
        return verdict(Decision::Allow, "Edits are accepted in this workspace.");
    }

    verdict(
        Decision::Ask,
        if annotations.destructive {
            "This can lose work, so the user is asked first."
        } else {
            "This changes something outside Draggy, so the user is asked first."
        },
    )
}

fn verdict(decision: Decision, reason: &str) -> Verdict {
    Verdict {
        decision,
        reason: reason.to_string(),
    }
}

/// Compares paths and addresses the way the file system does on this platform: separators unified, trailing
/// separators dropped, case ignored.
fn normalise_path(value: &str) -> String {
    value
        .trim_end_matches(['\\', '/'])
        .replace('\\', "/")
        .to_lowercase()
}

fn same_or_inside(granted: &str, target: &str) -> bool {
    let granted = normalise_path(granted);
    let asked = normalise_path(target);

    // TS quirk: a grant of only separators normalises to empty and covers every path.
    if granted.is_empty() {
        return true;
    }
    if granted == asked {
        return true;
    }
    asked.starts_with(&format!("{granted}/"))
}

/// Whether one grant covers a call to `tool` about `target`.
pub fn grant_covers(grant: &Grant, tool: &str, target: Option<&str>) -> bool {
    if grant.tool != tool {
        return false;
    }
    let Some(granted) = grant
        .target
        .as_deref()
        .filter(|granted| !granted.is_empty())
    else {
        return true;
    };
    let Some(target) = target.filter(|target| !target.is_empty()) else {
        return false;
    };
    same_or_inside(granted, target)
}

/// Adds a grant, dropping any it makes redundant.
pub fn add_grant(grants: &[Grant], grant: Grant) -> Vec<Grant> {
    let mut kept: Vec<Grant> = grants
        .iter()
        .filter(|existing| !grant_covers(&grant, &existing.tool, existing.target.as_deref()))
        .cloned()
        .collect();
    kept.push(grant);
    kept
}

/// What an approval remembers. A command keeps the start of each command in it, so "always" for "npm test --watch"
/// allows "npm test" again but not anything chained after it.
pub fn grants_for(
    tool: &str,
    target: Option<&str>,
    annotations: ToolAnnotations,
    shell: Option<&str>,
) -> Vec<Grant> {
    if annotations.executes {
        return command_grant_targets(target, dialect_for(shell))
            .into_iter()
            .map(|prefix| Grant {
                tool: tool.to_string(),
                target: Some(prefix),
            })
            .collect();
    }
    vec![Grant {
        tool: tool.to_string(),
        target: target
            .filter(|target| !target.is_empty())
            .map(str::to_string),
    }]
}

/// The argument names that say what a call is about, in the order they are looked for.
const TARGET_KEYS: [&str; 10] = [
    "path",
    "filepath",
    "file_path",
    "filename",
    "file",
    "directory",
    "folder",
    "source",
    "url",
    "command",
];

/// The path, file or address a call is about, trimmed. `None` when the call is about nothing in particular.
pub fn target_from_args(args: &Value) -> Option<String> {
    TARGET_KEYS.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(trim_js)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

/// What a refusal reads like to the model, in the shape tools answer in.
pub fn refusal_for(tool: &str, verdict: &Verdict) -> String {
    format!("TOOL RESULT ({tool}): Not allowed. {}", verdict.reason)
}

/// What a declined call reads like to the model.
pub fn denied_by_user(tool: &str) -> String {
    format!(
        "TOOL RESULT ({tool}): The user declined this. Do not try it again; ask them what to do instead, or carry on without it."
    )
}
