pub struct VoiceEnhancer;

impl VoiceEnhancer {
    pub fn enhance(samples: &[f32], gain: f32) -> Vec<f32> {
        samples
            .iter()
            .map(|&s| (s * gain).clamp(-1.0, 1.0))
            .collect()
    }
}
