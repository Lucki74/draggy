//! The models folder: which GGUF files are on disk, what each says about itself, and deleting a model with its companions.
//! Port of electron/modelStorage.cjs (listGgufModels and deleteGgufModel). Downloads are in download.rs.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use tracing::{debug, info, warn};

use crate::draft_model::{draft_companion_name, is_companion_draft};
use crate::gguf::{capabilities_from_template, read_chat_template, read_header};
use crate::mmproj::{Projectors, companion_name, is_companion_file};
use crate::shards::{basename, parse_shard, shard_names};

/// One model on disk. A split model is listed once, under its first part, with the size of every part.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelEntry {
    pub filename: String,
    pub size: u64,
    pub path: PathBuf,
    pub architecture: String,
    pub context_length: Option<f64>,
    pub block_count: Option<f64>,
    pub file_type: Option<f64>,
    pub capabilities: Vec<String>,
}

/// Capabilities read from each file's chat template, keyed by path, size and modification time, so a listing reads
/// each template once. The caller owns it; a fresh value starts empty.
#[derive(Debug, Default)]
pub struct CapabilityCache {
    entries: HashMap<(PathBuf, u64, u128), Vec<String>>,
}

/// A header number the reference reads as absent when it is zero or missing.
fn present(value: Option<f64>) -> Option<f64> {
    value.filter(|number| !number.is_nan() && *number != 0.0)
}

fn modified_ms(meta: &fs::Metadata) -> u128 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_millis())
}

fn capabilities_of(path: &Path, meta: &fs::Metadata, cache: &mut CapabilityCache) -> Vec<String> {
    let key = (path.to_path_buf(), meta.len(), modified_ms(meta));
    if let Some(found) = cache.entries.get(&key) {
        return found.clone();
    }
    let template = File::open(path)
        .ok()
        .and_then(|mut file| read_chat_template(&mut file).ok())
        .flatten();
    let capabilities: Vec<String> = capabilities_from_template(template.as_deref())
        .into_iter()
        .map(str::to_owned)
        .collect();
    cache.entries.insert(key, capabilities.clone());
    capabilities
}

fn describe(
    models_dir: &Path,
    file: &str,
    shard: bool,
    present_names: &HashSet<&str>,
    projectors: &Projectors,
    cache: &mut CapabilityCache,
) -> io::Result<ModelEntry> {
    let path = models_dir.join(file);
    let meta = fs::metadata(&path)?;
    let size = if shard {
        let mut total = 0;
        for name in shard_names(file) {
            if present_names.contains(name.as_str()) {
                total += fs::metadata(models_dir.join(&name))?.len();
            }
        }
        total
    } else {
        meta.len()
    };
    let header = File::open(&path)
        .ok()
        .and_then(|mut file| read_header(&mut file).ok());
    let mut capabilities = capabilities_of(&path, &meta, cache);
    // The template cannot say whether images can be read; a projector beside the model can.
    if projectors.find_companion(models_dir, file).is_some() {
        capabilities.push("vision".to_owned());
    }
    let architecture = header
        .as_ref()
        .map(|header| header.architecture.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    Ok(ModelEntry {
        filename: file.to_owned(),
        size,
        path,
        architecture,
        context_length: header
            .as_ref()
            .and_then(|header| present(header.context_length)),
        block_count: header
            .as_ref()
            .and_then(|header| present(header.block_count)),
        file_type: header.as_ref().and_then(|header| present(header.file_type)),
        capabilities,
    })
}

/// Lists the GGUF models in a folder. Projectors and drafts are read through their model, so they are not listed.
/// A missing folder lists as empty; a file that cannot be read is skipped with a warning.
pub fn list_gguf_models(
    models_dir: &Path,
    projectors: &Projectors,
    cache: &mut CapabilityCache,
) -> io::Result<Vec<ModelEntry>> {
    debug!(target: "engine.models", dir = %basename_of(models_dir), "scan started");
    if !models_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files: Vec<String> = fs::read_dir(models_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    files.sort();
    let present_names: HashSet<&str> = files.iter().map(String::as_str).collect();

    let mut models = Vec::new();
    for file in &files {
        if !file.to_lowercase().ends_with(".gguf")
            || is_companion_file(file)
            || is_companion_draft(file)
        {
            continue;
        }
        let shard = parse_shard(file);
        // The later parts are read through the first, so they are one model, not several.
        let first_present = shard_names(file)
            .first()
            .is_some_and(|first| present_names.contains(first.as_str()));
        if shard.as_ref().is_some_and(|shard| shard.index > 1) && first_present {
            continue;
        }
        match describe(
            models_dir,
            file,
            shard.is_some(),
            &present_names,
            projectors,
            cache,
        ) {
            Ok(entry) => {
                debug!(target: "engine.models", file = %file, arch = %entry.architecture, bytes = entry.size, "model found");
                models.push(entry);
            }
            Err(err) => {
                warn!(target: "engine.models", file = %file, code = ?err.kind(), "model file unreadable");
            }
        }
    }
    info!(target: "engine.models", count = models.len(), dir = %basename_of(models_dir), "models listed");
    Ok(models)
}

/// Deletes a GGUF model with every part of it when it is split, and its projector and draft. The name is reduced to its
/// basename first, so a path cannot reach outside the folder. Returns false when no such model is there.
pub fn delete_gguf_model(models_dir: &Path, filename: &str) -> io::Result<bool> {
    let safe = basename(filename);
    let target = models_dir.join(safe);
    info!(target: "engine.models", file = %safe, "model delete requested");
    if !target.exists() {
        warn!(target: "engine.models", file = %safe, "model delete target missing");
        return Ok(false);
    }
    let mut doomed: Vec<String> = shard_names(safe);
    doomed.push(companion_name(safe));
    doomed.push(draft_companion_name(safe));
    for name in doomed {
        remove_if_present(&models_dir.join(name))?;
    }
    info!(target: "engine.models", file = %safe, "model deleted");
    Ok(true)
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn basename_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_and_missing_header_numbers_are_absent() {
        assert_eq!(present(Some(0.0)), None);
        assert_eq!(present(None), None);
        assert_eq!(present(Some(4096.0)), Some(4096.0));
    }
}
