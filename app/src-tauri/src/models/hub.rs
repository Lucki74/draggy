//! Shared HTTP clients for the model hub. Built once so the Hugging Face size and file caches survive between calls.

use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use draggy_models::download::ReqwestClient;
use draggy_models::huggingface::HuggingFace;

static CLIENT: OnceLock<Result<Arc<ReqwestClient>, String>> = OnceLock::new();
static HUB: OnceLock<Result<HuggingFace<ReqwestClient>, String>> = OnceLock::new();

/// The client for repository tree and file downloads.
pub fn client() -> Result<Arc<ReqwestClient>, String> {
    CLIENT
        .get_or_init(|| {
            ReqwestClient::new()
                .map(Arc::new)
                .map_err(|error| error.to_string())
        })
        .clone()
}

/// The Hugging Face lookups: search, size and resolve.
pub fn hub() -> Result<&'static HuggingFace<ReqwestClient>, String> {
    HUB.get_or_init(|| {
        ReqwestClient::new()
            .map(HuggingFace::new)
            .map_err(|error| error.to_string())
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// Milliseconds since the Unix epoch, for the hub's cache clock.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
