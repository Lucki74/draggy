//! What the window shares with its dialogs: the settings in memory and the place the key is kept.

use std::cell::RefCell;
use std::sync::Arc;

use draggy_core::McpManager;
use draggy_linux::secrets::{KeyringStore, SecretStore};
use draggy_linux::settings::Settings;

/// The name under which the model server's key is stored.
pub const SERVER_KEY: &str = "model-server";

pub struct AppState {
    pub settings: RefCell<Settings>,
    pub secrets: Arc<dyn SecretStore>,
    mcp: RefCell<Option<Arc<McpManager>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            settings: RefCell::new(Settings::default()),
            secrets: Arc::new(KeyringStore),
            mcp: RefCell::new(None),
        }
    }

    /// The MCP manager shared by every session, made on first use. `None` when it cannot start.
    pub fn mcp(&self) -> Option<Arc<McpManager>> {
        let mut slot = self.mcp.borrow_mut();
        if slot.is_none() {
            *slot = McpManager::new(None, None).ok();
        }
        slot.clone()
    }
}
