use super::locale_detector::detect_system_locale;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct OnboardingStore {
    pub current_step: Arc<Mutex<usize>>,
    pub locale: Arc<Mutex<String>>,
}

impl Default for OnboardingStore {
    fn default() -> Self {
        Self {
            current_step: Arc::new(Mutex::new(0)),
            locale: Arc::new(Mutex::new(detect_system_locale())),
        }
    }
}

impl OnboardingStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn next(&self) {
        *self.current_step.lock().unwrap() += 1;
    }
}
