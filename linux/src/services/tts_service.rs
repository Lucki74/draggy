use super::neural_voice::NeuralVoice;
use super::tts_consent::TtsConsentManager;
use std::rc::Rc;

pub struct TtsService {
    pub consent: Rc<TtsConsentManager>,
}

impl TtsService {
    pub fn new(consent: Rc<TtsConsentManager>) -> Self {
        Self { consent }
    }

    pub fn speak(&self, text: &str, provider: Option<&str>) {
        if let Some(p) = provider {
            if self.consent.has_consent(p) {
                // Cloud TTS dispatch
                return;
            }
        }
        NeuralVoice::speak(text);
    }
}
