//! The turn's plan: one checklist the model rewrites with `update_plan` and the shell shows beside the chat.

use draggy_agent::agent_loop::{PlanItem, PlanStatus, ToolContext, parse_plan, render_plan};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use serde_json::{Value, json};

/// The `update_plan` definition a session offers.
pub fn definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: "update_plan".to_owned(),
            description: "Write or rewrite the plan for this task as a checklist, one step per line: [ ] to do, [>] in hand, [x] done. Send the whole list each time a step changes.".to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "steps": {"type": "string", "description": "The checklist, one step per line."}
                },
                "required": ["steps"]
            }),
        },
    }]
}

pub fn owns(name: &str) -> bool {
    name == "update_plan"
}

/// Records the plan the model wrote and tells it what was kept.
pub fn run(args: &Value, ctx: &mut ToolContext<'_>) -> String {
    let text = args.get("steps").and_then(Value::as_str).unwrap_or("");
    let items = parse_plan(text);
    if items.is_empty() {
        return "The plan needs at least one step, one per line.".to_owned();
    }
    let rendered = render_plan(&items);
    ctx.plan = Some(items);
    format!("Plan recorded:\n{rendered}")
}

/// A step as the shells show it: its text and `todo`, `doing` or `done`.
pub fn status_name(item: &PlanItem) -> &'static str {
    match item.status {
        PlanStatus::Todo => "todo",
        PlanStatus::Doing => "doing",
        PlanStatus::Done => "done",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tool_is_named_update_plan() {
        assert!(owns("update_plan"));
        assert!(!owns("use_skill"));
        assert_eq!(definitions()[0].function.name, "update_plan");
    }

    #[test]
    fn status_names_follow_the_marks() {
        let items = parse_plan("[x] one\n[>] two\n[ ] three");
        let names: Vec<_> = items.iter().map(status_name).collect();
        assert_eq!(names, ["done", "doing", "todo"]);
    }
}
