//! A turn as it runs, for the speed line and the context meter. Kept out of the conversation, so figures that
//! change every quarter second are neither saved nor re-render the whole chat. Port of `src/agent/liveTurn.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::context_breakdown::PromptParts;

/// What a running turn reports: tokens written, speed, and what the context holds now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTurn {
    /// Tokens written so far. An estimate until each pass ends, when the engine gives the real figure.
    pub response_tokens: f64,
    pub tokens_per_second: f64,
    /// What the context holds now, and whether that came from the model or is an estimate.
    pub context_tokens: f64,
    pub context_exact: bool,
    pub context_window: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<PromptParts>,
}

/// The live turn of each chat, held where the window can read it without asking the conversation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LiveTurns {
    turns: BTreeMap<String, LiveTurn>,
}

impl LiveTurns {
    /// Sets or clears a chat's live turn. Returns whether anything changed, so a listener is told only then.
    pub fn set(&mut self, chat_id: &str, live: Option<LiveTurn>) -> bool {
        match live {
            Some(live) => {
                self.turns.insert(chat_id.to_string(), live);
                true
            }
            None => self.turns.remove(chat_id).is_some(),
        }
    }

    /// The live turn of a chat, or None when it is not running.
    pub fn get(&self, chat_id: &str) -> Option<&LiveTurn> {
        self.turns.get(chat_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(tokens: f64) -> LiveTurn {
        LiveTurn {
            response_tokens: tokens,
            tokens_per_second: 1.0,
            context_tokens: 1.0,
            context_exact: true,
            context_window: 2.0,
            parts: None,
        }
    }

    #[test]
    fn clearing_a_chat_that_has_none_changes_nothing() {
        let mut turns = LiveTurns::default();
        assert!(!turns.set("a", None));
        assert!(turns.set("a", Some(turn(1.0))));
        assert!(turns.set("a", None));
        assert!(turns.get("a").is_none());
    }
}
