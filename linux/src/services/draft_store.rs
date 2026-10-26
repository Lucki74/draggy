use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub title: String,
    pub content: String,
}

#[derive(Default, Clone)]
pub struct DraftStore {
    pub drafts: Arc<Mutex<Vec<Draft>>>,
    pub active_id: Arc<Mutex<Option<String>>>,
}

impl DraftStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_draft(&self, title: &str, content: &str) -> Draft {
        let draft = Draft {
            id: format!("draft-{}", uuid_simple()),
            title: title.to_string(),
            content: content.to_string(),
        };
        self.drafts.lock().unwrap().insert(0, draft.clone());
        *self.active_id.lock().unwrap() = Some(draft.id.clone());
        draft
    }

    pub fn update_active(&self, content: &str) {
        if let Some(ref id) = *self.active_id.lock().unwrap() {
            if let Some(d) = self.drafts.lock().unwrap().iter_mut().find(|d| &d.id == id) {
                d.content = content.to_string();
            }
        }
    }
}

fn uuid_simple() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
