//! The steps of a model load as the shells show them, each with a number measured from the running engine.
//!
//! Nothing here is estimated: the disk step carries no number, the RAM step is the share of the model file the engine
//! process holds in memory, and the reading step is the prompt progress the server prints, with the speed worked out
//! from the tokens it reports between two lines.

/// Which step of a load the engine is in.
#[derive(uniffi::Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadStageKind {
    /// The engine has started and is getting the model file from disk. No number.
    Disk,
    /// The model is loading into RAM; `percent` is how much of the file is resident.
    Ram,
    /// The context window is being raised and the model reloads; `percent` is as for `Ram`.
    Extending,
    /// The first prompt is being read; `percent` and `tokens_per_second` come from the server.
    Reading,
    /// The weights are placed and the server is setting up its slots. No number.
    Readying,
}

/// One step of a load.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct LoadStageRecord {
    pub kind: LoadStageKind,
    /// The model file's name.
    pub model: String,
    /// Whole percent, in steps of 3. None when the step has no measured number.
    pub percent: Option<u32>,
    pub tokens_per_second: Option<f64>,
}

/// Implemented by the shell. Called from the load's own thread, once per step change.
#[uniffi::export(with_foreign)]
pub trait LoadObserver: Send + Sync {
    fn on_stage(&self, stage: LoadStageRecord);
}

const STEP: u32 = 3;

fn round_down(percent: f64) -> u32 {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let whole = percent.clamp(0.0, 100.0) as u32;
    whole / STEP * STEP
}

/// The number after `key` in `line`, such as `n_tokens = 512`.
fn number_after(line: &str, key: &str) -> Option<f64> {
    let rest = line.split(key).nth(1)?.trim_start();
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

/// Follows one load. Feed it the server's lines and the resident size; it returns a record when a step or its
/// percent changed.
#[derive(Debug)]
pub struct LoadTracker {
    model: String,
    model_bytes: u64,
    ram_kind: LoadStageKind,
    current: Option<LoadStageKind>,
    last_percent: Option<u32>,
    last_prompt: Option<(u64, u64)>,
    speed: Option<f64>,
}

impl LoadTracker {
    pub fn new(model: String, model_bytes: u64, extending: bool) -> Self {
        Self {
            model,
            model_bytes,
            ram_kind: if extending {
                LoadStageKind::Extending
            } else {
                LoadStageKind::Ram
            },
            current: None,
            last_percent: None,
            last_prompt: None,
            speed: None,
        }
    }

    fn record(&self, kind: LoadStageKind, percent: Option<u32>) -> LoadStageRecord {
        LoadStageRecord {
            kind,
            model: self.model.clone(),
            percent,
            tokens_per_second: if kind == LoadStageKind::Reading {
                self.speed
            } else {
                None
            },
        }
    }

    fn step(&mut self, kind: LoadStageKind, percent: Option<u32>) -> Option<LoadStageRecord> {
        if self.current == Some(kind)
            && self.last_percent == percent
            && kind != LoadStageKind::Reading
        {
            return None;
        }
        self.current = Some(kind);
        self.last_percent = percent;
        Some(self.record(kind, percent))
    }

    /// The engine process exists.
    pub fn spawned(&mut self) -> Option<LoadStageRecord> {
        self.step(LoadStageKind::Disk, None)
    }

    /// The bytes of the process the system holds in RAM. Only counts while the weights are loading.
    pub fn resident(&mut self, bytes: u64) -> Option<LoadStageRecord> {
        if matches!(
            self.current,
            Some(LoadStageKind::Readying | LoadStageKind::Reading)
        ) || self.model_bytes == 0
        {
            return None;
        }
        #[allow(clippy::cast_precision_loss)]
        let percent = round_down(bytes as f64 * 100.0 / self.model_bytes as f64).min(99);
        if percent < STEP {
            return None;
        }
        // The share only grows while loading, so a dip from a trim is not shown.
        if self.current == Some(self.ram_kind)
            && self.last_percent.is_some_and(|last| percent <= last)
        {
            return None;
        }
        self.step(self.ram_kind, Some(percent))
    }

    /// One line of the server's output, with the time it arrived in milliseconds.
    pub fn line(&mut self, line: &str, now_ms: u64) -> Option<LoadStageRecord> {
        if line.contains("initializing, n_slots") {
            return self.step(LoadStageKind::Readying, None);
        }
        if line.contains("prompt processing progress") {
            let progress = number_after(line, "progress =")?;
            let tokens = number_after(line, "n_tokens =")?;
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let tokens = tokens as u64;
            if let Some((before, at)) = self.last_prompt
                && tokens > before
                && now_ms > at
            {
                #[allow(clippy::cast_precision_loss)]
                let rate = (tokens - before) as f64 * 1000.0 / (now_ms - at) as f64;
                self.speed = Some(rate);
            }
            self.last_prompt = Some((tokens, now_ms));
            let percent = round_down(progress * 100.0);
            if self.current == Some(LoadStageKind::Reading) && self.last_percent == Some(percent) {
                return None;
            }
            return self.step(LoadStageKind::Reading, Some(percent));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracker() -> LoadTracker {
        LoadTracker::new("m.gguf".to_owned(), 1000, false)
    }

    #[test]
    fn a_spawn_starts_at_disk_with_no_number() {
        let record = tracker().spawned().unwrap();
        assert_eq!(record.kind, LoadStageKind::Disk);
        assert_eq!(record.percent, None);
    }

    #[test]
    fn ram_reports_the_resident_share_in_steps_of_three() {
        let mut t = tracker();
        t.spawned();
        assert!(t.resident(20).is_none());
        let record = t.resident(500).unwrap();
        assert_eq!(
            (record.kind, record.percent),
            (LoadStageKind::Ram, Some(48))
        );
        assert!(t.resident(501).is_none());
        assert_eq!(t.resident(2000).unwrap().percent, Some(99));
    }

    #[test]
    fn a_larger_window_names_the_step_extending() {
        let mut t = LoadTracker::new("m.gguf".to_owned(), 1000, true);
        t.spawned();
        assert_eq!(t.resident(300).unwrap().kind, LoadStageKind::Extending);
    }

    #[test]
    fn readying_stops_the_ram_steps() {
        let mut t = tracker();
        t.spawned();
        let record = t
            .line("srv    load_model: initializing, n_slots = 1", 0)
            .unwrap();
        assert_eq!(record.kind, LoadStageKind::Readying);
        assert!(t.resident(900).is_none());
    }

    #[test]
    fn reading_carries_the_percent_and_a_measured_speed() {
        let mut t = tracker();
        let first = t
            .line("slot update_slots: id  0 | task 0 | prompt processing progress, n_tokens = 512, batch.n_tokens = 512, progress = 0.250000", 1000)
            .unwrap();
        assert_eq!((first.percent, first.tokens_per_second), (Some(24), None));
        let second = t
            .line("slot update_slots: id  0 | task 0 | prompt processing progress, n_tokens = 1536, batch.n_tokens = 1024, progress = 0.750000", 2000)
            .unwrap();
        assert_eq!(second.percent, Some(75));
        assert_eq!(second.tokens_per_second, Some(1024.0));
    }

    #[test]
    fn unrelated_lines_say_nothing() {
        assert!(
            tracker()
                .line("load_tensors: offloaded 33/33 layers to GPU", 0)
                .is_none()
        );
    }
}
