use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub id: String,
    pub prompt: String,
    pub path: String,
    /// The tracked picture this one started from, when a reference was given.
    #[serde(default)]
    pub reference: Option<String>,
    /// True when a reference was given but the engine could not use it, so the picture came from the prompt alone.
    #[serde(default)]
    pub reference_dropped: bool,
}

/// The default strength of a reference: low, so a small detail changes and the rest stays.
pub const DEFAULT_REFERENCE_STRENGTH: f64 = 0.35;

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
        self.generate_with_reference(prompt, None, None)
    }

    /// The stub engine cannot sample from a picture, so it records the reference and marks it dropped. A real
    /// engine replaces this and uses `strength`, which defaults to `DEFAULT_REFERENCE_STRENGTH`.
    pub fn generate_with_reference(&self, prompt: &str, reference: Option<&str>, _strength: Option<f64>) -> GeneratedImage {
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
            reference: reference.map(str::to_string),
            reference_dropped: reference.is_some(),
        };

        self.history.lock().unwrap().insert(0, img.clone());
        *self.is_generating.lock().unwrap() = false;
        img
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_is_recorded_and_marked_dropped() {
        let engine = ImageEngine::new();
        let image = engine.generate_with_reference("a red fox", Some("img_1"), None);
        assert_eq!(image.reference.as_deref(), Some("img_1"));
        assert!(image.reference_dropped);
    }

    #[test]
    fn text_only_has_no_reference() {
        let image = ImageEngine::new().generate("a red fox");
        assert!(image.reference.is_none() && !image.reference_dropped);
    }
}
