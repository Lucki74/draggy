use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateConfig {
    pub auto_check: bool,
    pub channel: String,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            auto_check: true,
            channel: "stable".to_string(),
        }
    }
}
