//! Draft models that sit beside a main model and speed it up. Port of electron/draftModel.cjs.
//! As with projectors, the reference's module state is a `Drafts` value the caller owns.

use std::path::{Path, PathBuf};

use tracing::{debug, info};

use crate::mmproj::{Stamp, basename_of, stamp_of};
use crate::shards::{basename, parse_shard, strip_suffix_ci};

const SUFFIX: &str = "-draft.gguf";

/// Where a model's companion draft lives: beside it, named after it, with a split model's part counter left out.
pub fn draft_companion_name(filename: &str) -> String {
    let base = basename(filename);
    let stem = match parse_shard(base) {
        Some(shard) => shard.stem,
        None => strip_suffix_ci(base, ".gguf").unwrap_or(base).to_owned(),
    };
    format!("{stem}{SUFFIX}")
}

/// Draft files are read through their parent model, so they are never listed as models of their own.
pub fn is_companion_draft(name: &str) -> bool {
    strip_suffix_ci(name, "-draft.gguf").is_some()
}

/// Drafts the engine has refused, and which draft each model is running with now.
#[derive(Debug, Default)]
pub struct Drafts {
    refused: Vec<Stamp>,
    /// Model path to the draft it runs with, so a log line marks the change and not every lookup.
    chosen: Vec<(PathBuf, PathBuf)>,
}

impl Drafts {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remembers that the engine could not load this draft, so the model falls back without it.
    pub fn mark_refused(&mut self, file: &Path) {
        let stamp = stamp_of(file);
        if !self.refused.contains(&stamp) {
            self.refused.push(stamp);
        }
        if let Some(at) = self.chosen.iter().position(|(_, draft)| draft == file) {
            let (model, _) = self.chosen.remove(at);
            info!(target: "engine.draft", model = %basename_of(&model), "draft marked refused");
            return;
        }
        info!(target: "engine.draft", draft = %basename_of(file), "draft marked refused");
    }

    /// The companion draft beside this model, or None when absent or refused. Logs only when the choice changes.
    pub fn find_companion_draft(&mut self, models_dir: &Path, filename: &str) -> Option<PathBuf> {
        let candidate = models_dir.join(draft_companion_name(filename));
        let draft = (candidate.exists() && !self.is_refused(&candidate)).then_some(candidate);
        let key = models_dir.join(filename);
        let previous = self
            .chosen
            .iter()
            .find(|(model, _)| *model == key)
            .map(|(_, draft)| draft.clone());
        if draft != previous {
            self.chosen.retain(|(model, _)| *model != key);
            if let Some(chosen) = &draft {
                self.chosen.push((key.clone(), chosen.clone()));
            }
            let message = if draft.is_some() {
                "draft chosen"
            } else {
                "draft cleared"
            };
            debug!(target: "engine.draft", model = %basename_of(&key), "{message}");
        }
        draft
    }

    /// Whether this model has a companion draft the engine already turned down.
    pub fn was_refused(&self, models_dir: &Path, filename: &str) -> bool {
        let candidate = models_dir.join(draft_companion_name(filename));
        candidate.exists() && self.is_refused(&candidate)
    }

    fn is_refused(&self, file: &Path) -> bool {
        self.refused.contains(&stamp_of(file))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draft_is_named_after_its_model() {
        assert_eq!(
            draft_companion_name("qwen-7b-Q4_K_M.gguf"),
            "qwen-7b-Q4_K_M-draft.gguf"
        );
    }
}
