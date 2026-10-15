//! Counters for the closing summary: what went wrong and what was slow, without keeping any content.

use serde_json::{Map, Value, json};

/// Slow channels kept at most. Past this, the smallest entry is dropped.
const SLOW_KEPT: usize = 200;
const SLOWEST_SHOWN: usize = 5;

/// The counters `Diagnostics::note_stat` takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stat {
    Turn,
    EngineCrash,
    PeakMb,
}

#[derive(Debug, Default)]
pub(crate) struct Stats {
    turns: f64,
    errors: Vec<(String, u64)>,
    slow: Vec<(String, f64)>,
    peak_mb: f64,
    engine_crashes: f64,
}

impl Stats {
    /// Counts one ERROR line under its scope, in the order scopes first appear, as the JavaScript object keeps them.
    pub(crate) fn count_error(&mut self, scope: &str) {
        match self.errors.iter_mut().find(|(name, _)| name == scope) {
            Some(entry) => entry.1 += 1,
            None => self.errors.push((scope.to_owned(), 1)),
        }
    }

    pub(crate) fn add_turns(&mut self, value: f64) {
        self.turns += value;
    }

    /// Keeps the longest duration seen for a channel. A non-finite duration is ignored.
    pub(crate) fn note_slow(&mut self, channel: &str, dur_ms: f64) {
        if !dur_ms.is_finite() {
            return;
        }
        match self.slow.iter_mut().find(|(name, _)| name == channel) {
            Some(entry) => {
                if dur_ms > entry.1 {
                    entry.1 = dur_ms;
                }
            }
            None => self.slow.push((channel.to_owned(), dur_ms)),
        }
        if self.slow.len() > SLOW_KEPT {
            // The first of equal smallest entries goes, as a stable sort would leave it.
            let mut smallest = 0;
            for (index, (_, value)) in self.slow.iter().enumerate() {
                if *value < self.slow[smallest].1 {
                    smallest = index;
                }
            }
            self.slow.remove(smallest);
        }
    }

    pub(crate) fn note_stat(&mut self, stat: Stat, value: f64) {
        match stat {
            Stat::Turn => self.turns += value,
            Stat::EngineCrash => self.engine_crashes += value,
            Stat::PeakMb => {
                if value > self.peak_mb {
                    self.peak_mb = value;
                }
            }
        }
    }

    /// The summary logger.cjs writes at the end of a session.
    pub(crate) fn summary(&self) -> Value {
        let mut errors = Map::new();
        for (scope, count) in &self.errors {
            errors.insert(scope.clone(), json!(count));
        }
        let mut slowest = self.slow.clone();
        slowest.sort_by(|a, b| b.1.total_cmp(&a.1));
        let slowest: Vec<Value> = slowest
            .iter()
            .take(SLOWEST_SHOWN)
            .map(|(channel, ms)| json!({"channel": channel, "ms": ms}))
            .collect();
        json!({
            "turns": self.turns,
            "errorsByScope": errors,
            "slowestIpc": slowest,
            "peakMemoryMB": self.peak_mb,
            "engineCrashes": self.engine_crashes,
        })
    }
}
