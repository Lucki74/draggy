pub struct NeuralVoice;

impl NeuralVoice {
    pub fn speak(text: &str) {
        // Dispatch to system speech synthesizer or piper / local tts
        let _ = std::process::Command::new("spd-say").arg(text).spawn();
    }
}
