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
        self.store.store(server_id, token);
    }
}
