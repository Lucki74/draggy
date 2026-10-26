use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudVoiceConfig {
    pub provider: String,
    pub api_key: String,
}

pub struct CloudVoice;

impl CloudVoice {
    pub async fn synthesize(_text: &str, _config: &CloudVoiceConfig) -> Result<Vec<u8>, String> {
        Ok(Vec::new())
    }
}
