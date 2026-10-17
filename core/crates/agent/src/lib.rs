//! Pure agent logic ported from `src/toolParsing.ts`, `src/prompts.ts` and `src/agent/*.ts`; `agent_loop` runs a turn.
//! The TypeScript stays the reference, and `shared/fixtures/agent` pins both.

pub mod agent_loop;
pub mod announcement;
pub mod command_rules;
pub mod compaction;
pub mod context_breakdown;
pub mod effort;
mod js;
pub mod json;
pub mod live_turn;
pub mod parsing;
pub mod permissions;
pub mod prompts;
pub mod repetition;
pub mod resume;
pub mod skills;
pub mod subagent;
pub mod task_manager;
pub mod tool_channel;

/// Failures while building the agent's patterns. A runtime matching error is logged and reads as no match.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// A JavaScript regex uses syntax the translation does not cover. Built-in patterns are covered by tests.
    #[error("unsupported regex syntax in {pattern}: {reason}")]
    Unsupported { pattern: String, reason: String },
    /// The translated pattern did not compile.
    #[error("regex did not compile: {0}")]
    Pattern(#[from] fancy_regex::Error),
}
