pub struct NeuralVoice;

impl NeuralVoice {
    pub fn speak(text: &str) {
        // Dispatch to system speech synthesizer or piper / local tts
        // The text is spoken, never logged.
        if let Err(error) = std::process::Command::new("spd-say").arg(text).spawn() {
            tracing::warn!(target: "linux.chat", kind = ?error.kind(), "speech synthesizer could not start");
        }
    }
}
