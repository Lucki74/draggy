use super::cloud_tts_provider::CloudTtsProvider;

pub struct ElevenLabsTts;

impl CloudTtsProvider for ElevenLabsTts {
    fn id(&self) -> &str {
        "elevenlabs"
    }
    fn name(&self) -> &str {
        "ElevenLabs"
    }
}
