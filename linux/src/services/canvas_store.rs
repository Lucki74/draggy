use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CanvasNote {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub text: String,
}

#[derive(Default, Clone)]
pub struct CanvasStore {
    pub notes: Arc<Mutex<Vec<CanvasNote>>>,
}

impl CanvasStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_note(&self, x: f64, y: f64, text: &str) {
        let note = CanvasNote {
            id: format!(
                "note-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ),
            x,
            y,
            text: text.to_string(),
        };
        self.notes.lock().unwrap().push(note);
    }
}
