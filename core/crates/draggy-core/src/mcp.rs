//! The MCP servers Draggy offers, for the shell's server list. Starting and calling them is not part of this module.

use draggy_mcp::catalogue::search_catalogue;

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
