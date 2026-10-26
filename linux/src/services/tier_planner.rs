use super::hardware_probe::LinuxHardwareInfo;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TierRecommendation {
    pub tier: String,
    pub parameter_range: String,
}

pub fn plan_tier(info: &LinuxHardwareInfo) -> TierRecommendation {
    if info.ram_gb >= 32 {
        TierRecommendation {
            tier: "High".to_string(),
            parameter_range: "14B-32B".to_string(),
        }
    } else {
        TierRecommendation {
            tier: "Medium".to_string(),
            parameter_range: "7B-8B".to_string(),
        }
    }
}
