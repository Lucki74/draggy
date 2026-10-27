use super::cloud_tts_provider::CloudTtsProvider;

pub struct AzureTts;

impl CloudTtsProvider for AzureTts {
    fn id(&self) -> &str {
        "azure"
    }
    fn name(&self) -> &str {
        "Azure Neural TTS"
    }
}
