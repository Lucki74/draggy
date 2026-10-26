use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Default, Clone)]
pub struct ExtensionStore {
    pub enabled_skills: Arc<Mutex<HashSet<String>>>,
    pub remote_servers: Arc<Mutex<Vec<RemoteServer>>>,
}

impl ExtensionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn toggle_skill(&self, skill_id: &str) {
        let mut set = self.enabled_skills.lock().unwrap();
        if set.contains(skill_id) {
            set.remove(skill_id);
        } else {
            set.insert(skill_id.to_string());
        }
    }

    pub fn add_server(&self, name: &str, url: &str) {
        let server = RemoteServer {
            id: format!(
                "srv-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ),
            name: name.to_string(),
            url: url.to_string(),
        };
        self.remote_servers.lock().unwrap().push(server);
    }
}
