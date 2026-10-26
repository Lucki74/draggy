use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
pub struct TtsConsentManager {
    granted: Arc<Mutex<HashSet<String>>>,
}

impl TtsConsentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_consent(&self, provider: &str) -> bool {
        self.granted.lock().unwrap().contains(provider)
    }

    pub fn grant(&self, provider: &str) {
        self.granted.lock().unwrap().insert(provider.to_string());
    }

    pub fn revoke(&self, provider: &str) {
        self.granted.lock().unwrap().remove(provider);
    }
}
