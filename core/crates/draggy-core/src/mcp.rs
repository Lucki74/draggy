//! The MCP servers Draggy offers, for the shell's server list. Starting and calling them is handled by `McpManager`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use draggy_mcp::catalogue::search_catalogue;
use draggy_mcp::child_process::StdioLauncher;
use draggy_mcp::definition::ServerConfig;
use draggy_mcp::log::TracingLog;
use draggy_mcp::ports::{MemoryVault, Ports, SystemClock};
use draggy_mcp::provision::{NpmProgram, NpmProvisioner};
use draggy_mcp::reqwest_net::ReqwestHttp;
use draggy_mcp::server::{ServerState, Servers, ToolState};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::error::CoreError;

/// One server of the catalogue, reduced to what a list shows.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct McpServerRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    /// A warning to show before the user turns the server on, such as access to files or the network.
    pub caution: Option<String>,
    /// The server runs elsewhere and is reached over HTTP, so nothing is installed on this machine.
    pub remote: bool,
    /// The page that documents the server.
    pub docs: String,
}

/// The settings for an MCP server: command arguments, environment variables, or remote URL.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq, Default)]
pub struct McpServerConfigRecord {
    pub url: Option<String>,
    pub name: Option<String>,
    pub package: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: HashMap<String, String>,
    pub arguments: HashMap<String, String>,
}

impl From<McpServerConfigRecord> for ServerConfig {
    fn from(record: McpServerConfigRecord) -> Self {
        let mut env = serde_json::Map::new();
        for (key, val) in record.env {
            env.insert(key, Value::String(val));
        }
        let mut arguments = serde_json::Map::new();
        for (key, val) in record.arguments {
            arguments.insert(key, Value::String(val));
        }
        Self {
            url: record.url,
            name: record.name,
            package: record.package,
            description: None,
            docs: None,
            args: record.args,
            arguments_list: None,
            env_declarations: None,
            env,
            arguments,
        }
    }
}

/// One tool a running MCP server offers.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct McpToolRecord {
    pub name: String,
    pub qualified_name: String,
    pub description: String,
}

impl From<&ToolState> for McpToolRecord {
    fn from(tool: &ToolState) -> Self {
        Self {
            name: tool
                .name
                .as_ref()
                .and_then(Value::as_str)
                .unwrap_or(&tool.qualified_name)
                .to_owned(),
            qualified_name: tool.qualified_name.clone(),
            description: tool.description.clone(),
        }
    }
}

/// The state of an MCP server as the shell sees it.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct McpServerStateRecord {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
    pub tools: Vec<McpToolRecord>,
}

impl From<&ServerState> for McpServerStateRecord {
    fn from(state: &ServerState) -> Self {
        Self {
            id: state.id.clone(),
            status: state.status.to_string(),
            error: state.error.clone(),
            tools: state.tools.iter().map(McpToolRecord::from).collect(),
        }
    }
}

/// The catalogue servers whose id, name or description contains `query`, ignoring case. A blank query lists them all.
#[uniffi::export]
pub fn mcp_catalogue(query: String) -> Vec<McpServerRecord> {
    search_catalogue(&query)
        .into_iter()
        .map(|entry| McpServerRecord {
            name: entry.name.unwrap_or_else(|| entry.id.clone()),
            id: entry.id,
            description: entry.description,
            caution: entry.caution.filter(|text| !text.is_empty()),
            remote: entry.remote.unwrap_or(false),
            docs: entry.docs.unwrap_or_default(),
        })
        .collect()
}

/// Manages running MCP servers: starts them, stops them, and offers their state to the shell.
#[derive(uniffi::Object)]
pub struct McpManager {
    servers: Arc<Mutex<Servers<ReqwestHttp, StdioLauncher>>>,
}

impl McpManager {
    /// Internal constructor for components or tests that supply their own server table.
    pub fn from_servers(servers: Arc<Mutex<Servers<ReqwestHttp, StdioLauncher>>>) -> Arc<Self> {
        Arc::new(Self { servers })
    }

    /// Access to the underlying servers table.
    pub(crate) fn servers(&self) -> Arc<Mutex<Servers<ReqwestHttp, StdioLauncher>>> {
        Arc::clone(&self.servers)
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl McpManager {
    /// Builds the manager for MCP servers. `node_path` is the node program to run stdio servers with
    /// (defaults to "node"), and `extensions_dir` is the folder where packages are installed.
    #[uniffi::constructor]
    pub fn new(
        node_path: Option<String>,
        extensions_dir: Option<String>,
    ) -> Result<Arc<Self>, CoreError> {
        let root = extensions_dir
            .filter(|dir| !dir.trim().is_empty())
            .map(PathBuf::from);
        let node_bin = node_path
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"));
        let npm_program = {
            let file = if node_bin.is_absolute() {
                let sibling_npm = if cfg!(windows) {
                    node_bin.with_file_name("npm.cmd")
                } else {
                    node_bin.with_file_name("npm")
                };
                if sibling_npm.exists() {
                    sibling_npm.to_string_lossy().into_owned()
                } else {
                    "npm".to_owned()
                }
            } else {
                "npm".to_owned()
            };
            NpmProgram {
                file,
                prefix_args: Vec::new(),
            }
        };
        let ports = Ports {
            vault: Arc::new(MemoryVault::default()),
            provisioner: Arc::new(NpmProvisioner::new(root, Some(npm_program))),
            clock: Arc::new(SystemClock),
        };
        let http = ReqwestHttp::new().map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?;
        let launcher = StdioLauncher::new(node_bin);
        let servers = Arc::new(Mutex::new(Servers::new(
            http,
            launcher,
            Arc::new(TracingLog),
            ports,
        )));
        Ok(Arc::new(Self { servers }))
    }

    /// Every running server, with its tools.
    pub async fn list(&self) -> Vec<McpServerStateRecord> {
        let servers = self.servers.lock().await;
        servers
            .list()
            .iter()
            .map(McpServerStateRecord::from)
            .collect()
    }

    /// Starts a server and completes its handshake.
    pub async fn start(
        &self,
        id: String,
        config: Option<McpServerConfigRecord>,
    ) -> McpServerStateRecord {
        let config = config.map(ServerConfig::from).unwrap_or_default();
        let mut servers = self.servers.lock().await;
        let state = servers.start(&id, &config).await;
        McpServerStateRecord::from(&state)
    }

    /// Stops a server, if it is running.
    pub async fn stop(&self, id: String) -> bool {
        let mut servers = self.servers.lock().await;
        servers.stop(&id).await
    }

    /// Stops a server and starts it again with the same config.
    pub async fn restart(
        &self,
        id: String,
        config: Option<McpServerConfigRecord>,
    ) -> McpServerStateRecord {
        let config = config.map(ServerConfig::from).unwrap_or_default();
        let mut servers = self.servers.lock().await;
        let state = servers.restart(&id, &config).await;
        McpServerStateRecord::from(&state)
    }

    /// Stops every server, for quitting.
    pub async fn stop_all(&self) {
        let mut servers = self.servers.lock().await;
        servers.stop_all().await;
    }

    /// Whether a server is running.
    pub async fn is_running(&self, id: String) -> bool {
        let servers = self.servers.lock().await;
        servers.is_running(&id)
    }
}
