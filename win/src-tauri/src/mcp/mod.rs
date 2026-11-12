//! The MCP host: the server table, the sign-in browser and the keystore that holds the secrets. Port of mcp.cjs.

pub mod config;
pub mod redirect;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use draggy_diagnostics::Diagnostics;
use draggy_mcp::child_process::StdioLauncher;
use draggy_mcp::definition::ServerConfig;
use draggy_mcp::log::{Level, Log};
use draggy_mcp::ports::{BoxFuture, Ports, SystemClock, Vault};
use draggy_mcp::provision::NpmProvisioner;
use draggy_mcp::registry::{FileCache, Registry};
use draggy_mcp::reqwest_net::ReqwestHttp;
use draggy_mcp::server::{CallOptions, CallOutcome, ServerState, Servers};
use draggy_mcp::signin::{self, Browser, SignInRequest};
use serde_json::{Map, Value, json};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::ipc::web::keys::with_store;

/// The sidecar that runs stdio servers and the JavaScript runner. Shipped next to the app.
pub fn node_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("node.exe")))
        .unwrap_or_else(|| PathBuf::from("node.exe"))
}

/// The server table and the sign-in flow. Every call goes through one lock, so a slow call holds the rest.
pub struct Host {
    app: AppHandle,
    user_data: PathBuf,
    http: ReqwestHttp,
    ports: Ports,
    log: Arc<dyn Log>,
    servers: tokio::sync::Mutex<Servers<ReqwestHttp, StdioLauncher>>,
}

impl Host {
    pub fn new(app: AppHandle, diag: Arc<Diagnostics>, user_data: &Path) -> Result<Self, String> {
        let http = ReqwestHttp::new()?;
        let log: Arc<dyn Log> = Arc::new(DiagLog(diag));
        let ports = Ports {
            vault: Arc::new(KeystoreVault { app: app.clone() }),
            provisioner: Arc::new(NpmProvisioner::new(
                Some(user_data.join("mcp-servers")),
                None,
            )),
            clock: Arc::new(SystemClock),
        };
        let servers = Servers::new(
            http.clone(),
            StdioLauncher::new(node_path()),
            Arc::clone(&log),
            ports.clone(),
        );
        Ok(Self {
            app,
            user_data: user_data.to_path_buf(),
            http,
            ports,
            log,
            servers: tokio::sync::Mutex::new(servers),
        })
    }

    pub async fn list(&self) -> Vec<ServerState> {
        self.servers.lock().await.list()
    }

    pub async fn start(&self, id: &str, config: &ServerConfig) -> ServerState {
        self.servers.lock().await.start(id, config).await
    }

    pub async fn stop(&self, id: &str) -> bool {
        self.servers.lock().await.stop(id).await
    }

    /// Forgets the sign-in, stops the server, and reports whether it was running.
    pub async fn sign_out(&self, id: &str) -> bool {
        self.ports.vault.remove(&signin::vault_key(id));
        self.servers.lock().await.sign_out(id).await
    }

    pub async fn call_tool(
        &self,
        server: &str,
        tool: &str,
        args: Value,
        options: &CallOptions,
    ) -> CallOutcome {
        self.servers
            .lock()
            .await
            .call_tool(server, tool, args, options)
            .await
    }

    pub async fn stop_all(&self) {
        self.servers.lock().await.stop_all().await;
    }

    /// Runs one browser sign-in against a remote server, with its own redirect listener.
    pub async fn sign_in(&self, id: &str, url: &str) -> Result<(), String> {
        let state = redirect::random_token(16)?;
        let pkce = getrandom_bytes(32)?;
        let redirect = redirect::LoopbackRedirect::default();
        let browser = OpenBrowser {
            app: self.app.clone(),
        };
        let request = SignInRequest {
            id,
            url,
            state: &state,
            pkce_random: &pkce,
        };
        signin::sign_in(
            &self.http,
            &self.ports,
            self.log.as_ref(),
            &redirect,
            &browser,
            request,
        )
        .await
    }

    /// The registry's answer in the shape the renderer reads.
    pub async fn search(&self, query: &str) -> Value {
        let registry = Registry::new(self.http.clone(), FileCache::new(&self.user_data));
        let now = crate::engines::now_ms().max(0) as u64;
        let found = registry.search(query, now).await;
        json!({
            "success": found.success,
            "entries": found.entries,
            "cached": found.cached,
            "stale": found.stale,
            "error": found.error,
        })
    }
}

fn getrandom_bytes(count: usize) -> Result<Vec<u8>, String> {
    let mut buffer = vec![0u8; count];
    getrandom::fill(&mut buffer).map_err(|_| "no randomness for the sign-in".to_owned())?;
    Ok(buffer)
}

/// The keystore's fields for one owner. Empty when the keystore is not open.
pub fn owner_fields(app: &AppHandle, owner: &str) -> Map<String, Value> {
    with_store(app, |store| store.fields(owner)).unwrap_or_default()
}

/// Replaces an owner's fields. False when the keystore could not save them.
pub fn replace_owner(app: &AppHandle, owner: &str, fields: &Map<String, Value>) -> bool {
    with_store(app, |store| store.replace(owner, fields).is_ok()).unwrap_or(false)
}

/// Forgets every field of an owner.
pub fn forget_owner(app: &AppHandle, owner: &str) {
    let _ = with_store(app, |store| store.delete(owner));
}

/// The vault the MCP clients keep sign-in records in: the keystore when it is open, else nothing kept.
struct KeystoreVault {
    app: AppHandle,
}

impl Vault for KeystoreVault {
    fn get(&self, key: &str) -> Option<Value> {
        with_store(&self.app, |store| store.fields(key))
            .filter(|fields| !fields.is_empty())
            .map(Value::Object)
    }

    fn set(&self, key: &str, value: Value) {
        if let Value::Object(fields) = value {
            let _ = with_store(&self.app, |store| store.replace(key, &fields));
        }
    }

    fn remove(&self, key: &str) {
        forget_owner(&self.app, key);
    }
}

/// Sends the log lines of the MCP clients to the diagnostics file.
struct DiagLog(Arc<Diagnostics>);

impl Log for DiagLog {
    fn line(&self, level: Level, scope: &str, message: &str, data: Value) {
        let data = Some(data);
        match level {
            Level::Debug => self.0.debug(scope, message, data),
            Level::Info => self.0.info(scope, message, data),
            Level::Warn => self.0.warn(scope, message, data),
            Level::Error => self.0.error(scope, message, data),
        }
    }
}

/// Opens the sign-in page in the user's default browser.
struct OpenBrowser {
    app: AppHandle,
}

impl Browser for OpenBrowser {
    fn open(&self, url: &str) -> BoxFuture<'_, Result<(), String>> {
        let url = url.to_owned();
        Box::pin(async move {
            self.app
                .opener()
                .open_url(url, None::<String>)
                .map_err(|error| error.to_string())
        })
    }
}
