//! Cuts 16-bit mono PCM into 40 ms frames, the size the player expects. A trailing odd byte waits for the next
//! chunk, so a sample is never split.

pub const SAMPLE_RATE: u32 = 24_000;
/// 40 ms of 16-bit mono.
pub const FRAME_BYTES: usize = (SAMPLE_RATE as usize / 1000) * 40 * 2;

#[derive(Default)]
pub struct Framer {
    pending: Vec<u8>,
    frames: usize,
}

impl Framer {
    /// Adds bytes and hands each whole frame to `emit`.
    pub fn push(&mut self, bytes: &[u8], mut emit: impl FnMut(Vec<i16>)) {
        self.pending.extend_from_slice(bytes);
        while self.pending.len() >= FRAME_BYTES {
            let frame: Vec<u8> = self.pending.drain(..FRAME_BYTES).collect();
            self.frames += 1;
            emit(samples(&frame));
        }
    }

    /// Flushes what is left, dropping an odd trailing byte. Returns the frame count.
    pub fn end(mut self, mut emit: impl FnMut(Vec<i16>)) -> usize {
        let whole = self.pending.len() - self.pending.len() % 2;
        if whole > 0 {
            self.frames += 1;
            emit(samples(&self.pending[..whole]));
        }
        self.frames
    }
}

fn samples(bytes: &[u8]) -> Vec<i16> {
    bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes(*pair))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_whole_frames_and_flushes_the_rest_at_the_end() {
        let mut framer = Framer::default();
        let mut sizes = Vec::new();
        framer.push(&vec![0u8; FRAME_BYTES * 2 + 6], |pcm| sizes.push(pcm.len()));
        assert_eq!(sizes, vec![FRAME_BYTES / 2, FRAME_BYTES / 2]);
        let total = framer.end(|pcm| sizes.push(pcm.len()));
        assert_eq!(total, 3);
        assert_eq!(sizes.last(), Some(&3));
    }

    #[test]
    fn a_split_sample_waits_for_its_second_byte() {
        let mut framer = Framer::default();
        let mut seen = Vec::new();
        framer.push(&[0x01], |pcm| seen.push(pcm));
        framer.push(&vec![0u8; FRAME_BYTES - 1], |pcm| seen.push(pcm));
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0][0], 1);
    }

    #[test]
    fn samples_are_little_endian() {
        let mut framer = Framer::default();
        let mut seen = Vec::new();
        framer.push(&[0xFF, 0x7F], |pcm| seen.push(pcm));
        assert_eq!(framer.end(|pcm| seen.push(pcm)), 1);
        assert_eq!(seen, vec![vec![32767]]);
    }
}
