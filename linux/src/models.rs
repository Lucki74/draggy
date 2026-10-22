//! Text and paths for the Models page, kept apart from the widgets so they can be tested without a display.

use std::path::PathBuf;

use draggy_core::{LoadStageKind, LoadStageRecord};

/// The line shown while a model loads. Every number in it was measured; a step with none shows none.
pub fn stage_text(stage: &LoadStageRecord) -> String {
    let model = &stage.model;
    match (stage.kind, stage.percent) {
        (LoadStageKind::Disk, _) => format!("Getting {model} from disk..."),
        (LoadStageKind::Ram, Some(percent)) => format!("Loading {model} into RAM {percent}%..."),
        (LoadStageKind::Ram, None) => format!("Loading {model} into RAM..."),
        (LoadStageKind::Extending, Some(percent)) => format!("Extending context {percent}%..."),
        (LoadStageKind::Extending, None) => "Extending context...".to_owned(),
        (LoadStageKind::Reading, percent) => {
            let percent = percent.unwrap_or(0);
            match stage.tokens_per_second {
                Some(rate) => format!("Reading {percent}% ({rate:.0} tok/s)..."),
                None => format!("Reading {percent}%..."),
            }
        }
        (LoadStageKind::Readying, _) => format!("{model} is readying..."),
    }
}

/// A byte count as GB or MB, such as "4.7 GB".
pub fn size_label(bytes: u64) -> String {
    #[allow(clippy::cast_precision_loss)]
    let gb = bytes as f64 / 1_073_741_824.0;
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        #[allow(clippy::cast_precision_loss)]
        let mb = bytes as f64 / 1_048_576.0;
        format!("{mb:.0} MB")
    }
}

/// The time left in a download, such as "2 min left". None while it is unknown.
pub fn remaining_label(seconds: Option<u64>) -> Option<String> {
    let seconds = seconds?;
    Some(if seconds < 90 {
        format!("{seconds} s left")
    } else {
        format!("{} min left", seconds.div_ceil(60))
    })
}

/// Where the app keeps its data: the engine program and the models.
pub fn data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })?;
    Some(base.join("draggy"))
}

/// The folder that holds installed skills.
pub fn skills_dir() -> Option<PathBuf> {
    data_dir().map(|dir| dir.join("skills"))
}

/// The folder that holds downloaded model files.
pub fn models_dir() -> Option<PathBuf> {
    data_dir().map(|dir| dir.join("models"))
}

/// GPU memory in GiB the engine may use. Linux has no single figure for it, so the launch is sized for the CPU.
pub const GPU_MEMORY_GB: f64 = 0.0;

/// Installed RAM in bytes, read from the kernel. Zero when it cannot be read.
pub fn total_ram_bytes() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|text| {
            let line = text.lines().find(|line| line.starts_with("MemTotal:"))?;
            let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
            Some(kib * 1024)
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(kind: LoadStageKind, percent: Option<u32>, rate: Option<f64>) -> LoadStageRecord {
        LoadStageRecord {
            kind,
            model: "qwen.gguf".to_owned(),
            percent,
            tokens_per_second: rate,
        }
    }

    #[test]
    fn each_step_reads_as_the_app_words_it() {
        assert_eq!(
            stage_text(&stage(LoadStageKind::Disk, None, None)),
            "Getting qwen.gguf from disk..."
        );
        assert_eq!(
            stage_text(&stage(LoadStageKind::Ram, Some(42), None)),
            "Loading qwen.gguf into RAM 42%..."
        );
        assert_eq!(
            stage_text(&stage(LoadStageKind::Reading, Some(30), Some(812.4))),
            "Reading 30% (812 tok/s)..."
        );
        assert_eq!(
            stage_text(&stage(LoadStageKind::Readying, None, None)),
            "qwen.gguf is readying..."
        );
        assert_eq!(
            stage_text(&stage(LoadStageKind::Extending, Some(15), None)),
            "Extending context 15%..."
        );
    }

    #[test]
    fn the_first_reading_step_has_no_speed_to_show() {
        assert_eq!(
            stage_text(&stage(LoadStageKind::Reading, Some(3), None)),
            "Reading 3%..."
        );
    }

    #[test]
    fn sizes_and_times_are_short() {
        assert_eq!(size_label(5_046_586_573), "4.7 GB");
        assert_eq!(size_label(734_003_200), "700 MB");
        assert_eq!(remaining_label(Some(45)).as_deref(), Some("45 s left"));
        assert_eq!(remaining_label(Some(100)).as_deref(), Some("2 min left"));
        assert_eq!(remaining_label(None), None);
    }
}
