use super::mcp_auth_token_store::McpAuthTokenStore;
use std::rc::Rc;

pub struct McpAuthManager {
    pub store: Rc<McpAuthTokenStore>,
}

impl McpAuthManager {
    pub fn new(store: Rc<McpAuthTokenStore>) -> Self {
        Self { store }
    }

    pub fn complete_oauth(&self, server_id: &str, token: &str) {
        // The token itself is never logged.
        tracing::info!(target: "linux.servers", server = server_id, "MCP sign-in completed");
        self.store.store(server_id, token);
    }
}
