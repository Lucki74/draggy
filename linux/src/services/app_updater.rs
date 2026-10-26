use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleasePayload {
    pub version: String,
    pub download_url: String,
}

pub struct AppUpdater;

impl AppUpdater {
    pub async fn check_latest() -> Result<Option<ReleasePayload>, String> {
        Ok(None)
    }
}
