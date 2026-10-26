pub struct VadDetector {
    threshold: f32,
}

impl Default for VadDetector {
    fn default() -> Self {
        Self { threshold: 0.015 }
    }
}

impl VadDetector {
    pub fn new(threshold: f32) -> Self {
        Self { threshold }
    }

    pub fn is_speech(&self, buffer: &[f32]) -> bool {
        if buffer.is_empty() {
            return false;
        }
        let sum_sq: f32 = buffer.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / buffer.len() as f32).sqrt();
        rms > self.threshold
    }
}
