use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TierStatsSummary {
    pub active_tier: String,
    pub tokens_per_sec: f64,
}

pub fn current_tier_stats() -> TierStatsSummary {
    TierStatsSummary {
        active_tier: "Medium".to_string(),
        tokens_per_sec: 42.0,
    }
}
