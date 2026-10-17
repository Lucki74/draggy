//! A smaller model sent to explore, so reading a dozen files does not spend the main conversation's context.
//! Port of `src/agent/subagent.ts`. The nested turn itself is behind [`ExploreRunner`].

use serde::{Deserialize, Serialize};

use crate::effort::Effort;

/// How long an exploration may run before the answer stops being worth it.
pub const EXPLORE_TIMEOUT_MS: u64 = 120_000;

/// The instructions an explorer runs under: it reads, then answers in a few lines.
pub const EXPLORE_PROMPT: &str = "You are looking something up for another assistant, not talking to a person.

Read what you need with the tools you have, then answer in at most fifteen lines: what you found, and the files and line numbers it is in. No preamble, no offer to help further, no code unless a few lines are the answer.

If the project does not contain what was asked about, say exactly that.";

/// An installed model, as far as choosing an explorer needs it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstalledModel {
    pub name: String,
    pub size: f64,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// The explorer model: the smallest installed one that can call tools. Ties go to the loaded one.
pub fn pick_explore_model(installed: &[InstalledModel], current: &str) -> String {
    let capable: Vec<&InstalledModel> = installed
        .iter()
        .filter(|model| {
            model.capabilities.iter().any(|cap| cap == "tools")
                && !model.capabilities.iter().any(|cap| cap == "embedding")
                && model.size > 0.0
        })
        .collect();

    let Some(&first) = capable.first() else {
        return current.to_string();
    };

    let running = capable.iter().find(|model| model.name == current);
    // The first of the smallest, as a strict reduce keeps the earlier one on a tie.
    let smallest =
        capable.iter().copied().fold(
            first,
            |best, model| if model.size < best.size { model } else { best },
        );

    // Only worth a second model if it is meaningfully smaller than the one already loaded.
    if let Some(running) = running
        && smallest.size > running.size * 0.6
    {
        return current.to_string();
    }

    smallest.name.clone()
}

/// What one exploration asks of the nested turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExploreRequest {
    pub question: String,
    pub model: String,
    /// The explorer gets the parent's tools with the read-only ones only, and plan mode.
    pub read_only_tools: bool,
    pub effort: Effort,
    pub custom_instructions: Vec<&'static str>,
}

/// The request for one question: read-only, low thinking, and the explorer's instructions.
pub fn explore_request(question: &str, model: &str) -> ExploreRequest {
    ExploreRequest {
        question: question.to_string(),
        model: model.to_string(),
        read_only_tools: true,
        effort: Effort::Off,
        custom_instructions: vec![EXPLORE_PROMPT],
    }
}

/// How a nested turn ended without an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExploreError {
    /// The timeout fired before the explorer finished.
    Timeout,
    /// The turn failed with this message.
    Failed(String),
}

/// Runs a nested turn to completion. The real one is the agent loop; tests use a fake.
pub trait ExploreRunner {
    fn run(&mut self, request: &ExploreRequest, timeout_ms: u64) -> Result<String, ExploreError>;
}

/// Runs one exploration and turns the outcome into the text the parent sees.
pub fn explore(runner: &mut dyn ExploreRunner, question: &str, model: &str) -> String {
    let request = explore_request(question, model);
    match runner.run(&request, EXPLORE_TIMEOUT_MS) {
        Ok(answer) => {
            let trimmed = crate::js::trim_js(&answer);
            if trimmed.is_empty() {
                "That search came back with nothing.".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(ExploreError::Timeout) => {
            "That search took too long and was stopped. Ask something narrower.".to_string()
        }
        Err(ExploreError::Failed(message)) => format!("That search failed: {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_explorer_prompt_asks_for_fifteen_lines_at_most() {
        assert!(EXPLORE_PROMPT.contains("at most fifteen lines"));
    }
}
