use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
pub struct McpAuthTokenStore {
    tokens: Arc<Mutex<HashMap<String, String>>>,
}

impl McpAuthTokenStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn store(&self, server_id: &str, token: &str) {
        self.tokens
            .lock()
            .unwrap()
            .insert(server_id.to_string(), token.to_string());
    }

    pub fn get(&self, server_id: &str) -> Option<String> {
        self.tokens.lock().unwrap().get(server_id).cloned()
    }
}
