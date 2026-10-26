use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub id: String,
    pub prompt: String,
    pub path: String,
}

#[derive(Default, Clone)]
pub struct ImageEngine {
    pub is_generating: Arc<Mutex<bool>>,
    pub history: Arc<Mutex<Vec<GeneratedImage>>>,
}

impl ImageEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn generate(&self, prompt: &str) -> GeneratedImage {
        *self.is_generating.lock().unwrap() = true;

        let img = GeneratedImage {
            id: format!(
                "img-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ),
            prompt: prompt.to_string(),
            path: "/tmp/generated.png".to_string(),
        };

        self.history.lock().unwrap().insert(0, img.clone());
        *self.is_generating.lock().unwrap() = false;
        img
    }
}
