pub struct AudioDenoiser;

impl AudioDenoiser {
    pub fn denoise(samples: &[f32]) -> Vec<f32> {
        if samples.len() < 2 {
            return samples.to_vec();
        }
        let alpha = 0.95f32;
        let mut out = vec![0.0f32; samples.len()];
        out[0] = samples[0];
        for i in 1..samples.len() {
            out[i] = alpha * (out[i - 1] + samples[i] - samples[i - 1]);
        }
        out
    }
}
