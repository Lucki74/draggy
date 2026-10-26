use super::hardware_metrics::{sample_metrics, SystemMetrics};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryItem {
    pub prompt_tokens: usize,
    pub completion_tokens: usize,
}

#[derive(Default, Clone)]
pub struct StatsStore {
    pub total_prompt: Arc<Mutex<usize>>,
    pub total_completion: Arc<Mutex<usize>>,
    pub history: Arc<Mutex<Vec<UsageHistoryItem>>>,
    pub metrics: Arc<Mutex<Option<SystemMetrics>>>,
}

impl StatsStore {
    pub fn new() -> Self {
        let store = Self::default();
        store.refresh_metrics();
        store
    }

    pub fn record_tokens(&self, prompt: usize, completion: usize) {
        *self.total_prompt.lock().unwrap() += prompt;
        *self.total_completion.lock().unwrap() += completion;
        self.history.lock().unwrap().push(UsageHistoryItem {
            prompt_tokens: prompt,
            completion_tokens: completion,
        });
    }

    pub fn refresh_metrics(&self) {
        *self.metrics.lock().unwrap() = Some(sample_metrics());
    }
}
