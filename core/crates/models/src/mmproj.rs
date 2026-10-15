//! Vision projector files that sit beside a model. Port of electron/mmproj.cjs.
//! The reference keeps refusals in module state; here the caller owns a `Projectors`, so each owner starts empty.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tracing::warn;

use crate::shards::{basename, parse_shard, strip_suffix_ci};

const SUFFIX: &str = "-mmproj.gguf";

/// Where a vision model's projector lives: beside it, named after it, so two repositories' `mmproj-F16.gguf` never collide.
/// A split model's part counter is left out.
pub fn companion_name(filename: &str) -> String {
    let base = basename(filename);
    let stem = match parse_shard(base) {
        Some(shard) => shard.stem,
        None => strip_suffix_ci(base, ".gguf").unwrap_or(base).to_owned(),
    };
    format!("{stem}{SUFFIX}")
}

/// Projectors are read through their model, so they are never listed as models of their own.
pub fn is_companion_file(name: &str) -> bool {
    name.to_ascii_lowercase().contains("mmproj")
}

/// A file identified by its path, size and modification time, so downloading it again is a new file.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Stamp {
    Stat {
        path: PathBuf,
        size: u64,
        mtime: Option<SystemTime>,
    },
    Path(PathBuf),
}

pub(crate) fn stamp_of(file: &Path) -> Stamp {
    match fs::metadata(file) {
        Ok(meta) => Stamp::Stat {
            path: file.to_path_buf(),
            size: meta.len(),
            mtime: meta.modified().ok(),
        },
        Err(_) => Stamp::Path(file.to_path_buf()),
    }
}

/// Projectors the engine has refused, keyed by stamp.
#[derive(Debug, Default)]
pub struct Projectors {
    refused: Vec<Stamp>,
}

impl Projectors {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remembers that the engine could not load this projector, so the model stops claiming to read images.
    pub fn mark_refused(&mut self, file: &Path) {
        let stamp = stamp_of(file);
        if !self.refused.contains(&stamp) {
            self.refused.push(stamp);
        }
        warn!(target: "engine.vision", file = %basename_of(file), "projector refused by engine");
    }

    /// The projector beside this model, or None when there is none or the engine refused it.
    pub fn find_companion(&self, models_dir: &Path, filename: &str) -> Option<PathBuf> {
        let candidate = models_dir.join(companion_name(filename));
        (candidate.exists() && !self.is_refused(&candidate)).then_some(candidate)
    }

    /// Whether this model has a projector the engine already turned down.
    pub fn was_refused(&self, models_dir: &Path, filename: &str) -> bool {
        let candidate = models_dir.join(companion_name(filename));
        candidate.exists() && self.is_refused(&candidate)
    }

    fn is_refused(&self, file: &Path) -> bool {
        self.refused.contains(&stamp_of(file))
    }
}

pub(crate) fn basename_of(file: &Path) -> String {
    file.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_projector_is_named_after_its_model() {
        assert_eq!(
            companion_name("gemma-4-12b-it-Q4_K_M.gguf"),
            "gemma-4-12b-it-Q4_K_M-mmproj.gguf"
        );
    }
}
