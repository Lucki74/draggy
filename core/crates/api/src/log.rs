//! The short in-memory list of recent requests. Never holds a prompt, a reply or a key.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};

/// Longest client name kept.
const CLIENT_LIMIT: usize = 60;

/// One served request.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LogEntry {
    pub time: i64,
    pub method: String,
    pub path: String,
    pub model: String,
    /// `agent`, `model`, or empty when the request never reached either.
    pub mode: String,
    pub status: u16,
    pub duration_ms: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub client: String,
}

impl LogEntry {
    pub fn to_value(&self) -> Value {
        json!({
            "time": self.time, "method": self.method, "path": self.path, "model": self.model,
            "mode": self.mode, "status": self.status, "durationMs": self.duration_ms,
            "promptTokens": self.prompt_tokens, "completionTokens": self.completion_tokens,
            "client": self.client,
        })
    }
}

/// The client name for the log: the User-Agent cut to 60 characters, without control characters.
pub fn client_of(user_agent: &str) -> String {
    user_agent
        .chars()
        .filter(|c| !c.is_control())
        .take(CLIENT_LIMIT)
        .collect()
}

/// A bounded list that drops its oldest entry first.
#[derive(Debug, Default)]
pub struct Ring {
    items: VecDeque<LogEntry>,
}

impl Ring {
    pub const fn new() -> Self {
        Self {
            items: VecDeque::new(),
        }
    }

    /// Adds an entry and drops the oldest past `cap`.
    pub fn push(&mut self, entry: LogEntry, cap: usize) {
        self.items.push_back(entry);
        while self.items.len() > cap.max(1) {
            self.items.pop_front();
        }
    }

    /// Newest first, at most `cap` of them.
    pub fn newest_first(&self, cap: usize) -> Vec<LogEntry> {
        self.items.iter().rev().take(cap).cloned().collect()
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }
}

/// What a handler learns about a request while it runs, read once the answer is made.
#[derive(Debug, Clone, Default)]
pub struct Note(Arc<Mutex<Noted>>);

#[derive(Debug, Default)]
struct Noted {
    model: String,
    mode: &'static str,
}

impl Note {
    pub fn set(&self, model: &str, mode: &'static str) {
        let mut noted = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        noted.model = model.chars().take(128).collect();
        noted.mode = mode;
    }

    pub fn read(&self) -> (String, &'static str) {
        let noted = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        (noted.model.clone(), noted.mode)
    }
}

/// Token counts of a streamed reply, filled in as the stream learns them and read when it ends.
#[derive(Debug, Clone, Default)]
pub struct Counter(Arc<Mutex<(u64, u64)>>);

impl Counter {
    pub fn set(&self, prompt: u64, completion: u64) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = (prompt, completion);
    }

    pub fn get(&self) -> (u64, u64) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Token counts of a whole reply, carried on the response so the log can read them.
#[derive(Debug, Clone, Copy)]
pub struct Tokens(pub u64, pub u64);

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(n: i64) -> LogEntry {
        LogEntry {
            time: n,
            ..LogEntry::default()
        }
    }

    #[test]
    fn the_oldest_entry_goes_first() {
        let mut ring = Ring::new();
        for n in 0..5 {
            ring.push(entry(n), 3);
        }
        let times: Vec<i64> = ring.newest_first(10).iter().map(|e| e.time).collect();
        assert_eq!(times, [4, 3, 2]);
        ring.clear();
        assert!(ring.newest_first(10).is_empty());
    }

    #[test]
    fn the_client_is_cut_and_cleaned() {
        assert_eq!(client_of(&"a".repeat(100)).len(), 60);
        assert_eq!(client_of("curl\n/8"), "curl/8");
    }
}
