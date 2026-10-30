//! What the window shares with its dialogs: the settings in memory and the place the key is kept.

use std::cell::RefCell;
use std::sync::Arc;

use draggy_core::{AgyAccount, EngineHost, LocalEngine, McpManager, ModelLibrary};
use draggy_linux::models;
use draggy_linux::secrets::{KeyringStore, SecretStore};
use draggy_linux::servers::PlainValues;
use draggy_linux::settings::Settings;
use draggy_storage::Storage;

/// The name under which the model server's key is stored.
pub const SERVER_KEY: &str = "model-server";
/// The name under which the Brave search key is stored.
pub const BRAVE_KEY: &str = "brave-search";

pub struct AppState {
    pub settings: RefCell<Settings>,
    pub secrets: Arc<dyn SecretStore>,
    /// The non-secret values of MCP server inputs. `None` when there is no home directory.
    pub plain: Option<PlainValues>,
    mcp: RefCell<Option<Arc<McpManager>>>,
    engine: RefCell<Option<Arc<LocalEngine>>>,
    library: RefCell<Option<Arc<ModelLibrary>>>,
    agy: RefCell<Option<Arc<AgyAccount>>>,
    storage: RefCell<Option<Arc<Storage>>>,
    /// The llama-server program the Models page installed or found.
    pub engine_binary: RefCell<String>,
    /// The model file the Models page picked.
    pub engine_model: RefCell<String>,
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
            plain: PlainValues::in_config_dir(),
            mcp: RefCell::new(None),
            engine: RefCell::new(None),
            library: RefCell::new(None),
            agy: RefCell::new(None),
            storage: RefCell::new(None),
            engine_binary: RefCell::new(String::new()),
            engine_model: RefCell::new(String::new()),
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

    /// The local engine shared by the Models page, made on first use.
    pub fn engine(&self) -> Arc<LocalEngine> {
        let mut slot = self.engine.borrow_mut();
        slot.get_or_insert_with(|| {
            Arc::new(LocalEngine::new(EngineHost {
                total_ram_bytes: models::total_ram_bytes(),
                gpu_memory_gb: models::GPU_MEMORY_GB,
            }))
        })
        .clone()
    }

    /// The engine if one was made, so closing the window does not start one just to stop it.
    pub fn engine_if_started(&self) -> Option<Arc<LocalEngine>> {
        self.engine.borrow().clone()
    }

    /// The Antigravity account, made on first use. It keeps its state beside the models.
    pub fn agy(&self) -> Arc<AgyAccount> {
        let mut slot = self.agy.borrow_mut();
        slot.get_or_insert_with(|| {
            let dir = models::data_dir().unwrap_or_default().join("agy");
            AgyAccount::new(dir.to_string_lossy().into_owned())
        })
        .clone()
    }

    /// The local database the turns and their costs are kept in. `None` when there is no data folder or it cannot open.
    pub fn storage(&self) -> Option<Arc<Storage>> {
        let mut slot = self.storage.borrow_mut();
        if slot.is_none() {
            let dir = models::data_dir()?;
            *slot = Storage::open(&dir).ok().map(Arc::new);
        }
        slot.clone()
    }

    /// The model library, made on first use. `None` when there is no data folder or it cannot start.
    pub fn library(&self) -> Option<Arc<ModelLibrary>> {
        let mut slot = self.library.borrow_mut();
        if slot.is_none() {
            let dir = models::models_dir()?;
            *slot = ModelLibrary::new(dir.to_string_lossy().into_owned())
                .ok()
                .map(Arc::new);
        }
        slot.clone()
    }
}
