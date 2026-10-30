//! Which files of a Hugging Face repository an MLX model needs, and the format tag an installed model carries.

use crate::huggingface::RepoFile;

/// The weight format of an installed model. A record written before the field existed is GGUF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFormat {
    Gguf,
    Mlx,
}

impl ModelFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gguf => "gguf",
            Self::Mlx => "mlx",
        }
    }

    /// Reads a stored value. A missing or unknown value is GGUF, which migrates old records without a rewrite.
    pub fn from_stored(value: Option<&str>) -> Self {
        match value {
            Some("mlx") => Self::Mlx,
            _ => Self::Gguf,
        }
    }
}

/// The files `mlx_lm` loads: config, tokenizer, chat template and every safetensors part with its index.
/// Returns None when the repository has no weights or no config, so it is not an MLX model.
pub fn select_mlx_files(files: &[RepoFile]) -> Option<(Vec<RepoFile>, u64)> {
    let wanted = |path: &str| {
        if path.contains('/') {
            return false;
        }
        let lower = path.to_lowercase();
        lower.ends_with(".safetensors")
            || lower == "model.safetensors.index.json"
            || lower == "config.json"
            || lower == "generation_config.json"
            || lower.starts_with("tokenizer")
            || lower == "special_tokens_map.json"
            || lower == "added_tokens.json"
            || lower == "vocab.json"
            || lower == "merges.txt"
            || lower.starts_with("chat_template")
            || lower.ends_with(".tiktoken")
    };
    let picked: Vec<RepoFile> = files.iter().filter(|f| wanted(&f.path)).cloned().collect();
    let has = |f: &dyn Fn(&str) -> bool| picked.iter().any(|file| f(&file.path.to_lowercase()));
    if !has(&|p| p.ends_with(".safetensors")) || !has(&|p| p == "config.json") {
        return None;
    }
    let bytes = picked.iter().fold(0_u64, |t, f| t.saturating_add(f.size));
    Some((picked, bytes))
}

/// One file of an MLX download: where it comes from, where it lands under the model folder, and its size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlxDownload {
    pub url: String,
    pub relative_path: String,
    pub size: u64,
}

/// The downloads for an MLX repository, `repo` being `owner/name`. The model folder is the repo name, so two repos never
/// share files. None when the repository is not an MLX model or `repo` is not a plain `owner/name`.
pub fn mlx_download_plan(repo: &str, files: &[RepoFile]) -> Option<(String, Vec<MlxDownload>)> {
    let (owner, name) = repo.split_once('/')?;
    let plain = |part: &str| !part.is_empty() && !part.contains("..") && part.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b));
    if !plain(owner) || !plain(name) {
        return None;
    }
    let (picked, _) = select_mlx_files(files)?;
    let downloads = picked
        .into_iter()
        .map(|file| MlxDownload {
            url: crate::huggingface::hub_url(repo, &file.path),
            relative_path: file.path,
            size: file.size,
        })
        .collect();
    Some((name.to_owned(), downloads))
}

/// The format of an installed model from the file names in its folder: weights in safetensors beside a `config.json`
/// are MLX, anything else is GGUF. This is what sets the record's format when a folder is listed.
pub fn format_of_names(names: &[&str]) -> ModelFormat {
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mlx = lower.iter().any(|n| n.ends_with(".safetensors")) && lower.iter().any(|n| n == "config.json");
    if mlx && !lower.iter().any(|n| n.ends_with(".gguf")) {
        ModelFormat::Mlx
    } else {
        ModelFormat::Gguf
    }
}

/// An MLX model folder on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledMlx {
    pub name: String,
    pub path: std::path::PathBuf,
    pub bytes: u64,
}

/// Lists the MLX model folders directly under `models_dir`. A folder counts when `format_of_names` says MLX. A missing
/// folder lists as empty.
pub fn list_mlx_models(models_dir: &std::path::Path) -> Vec<InstalledMlx> {
    let Ok(read) = std::fs::read_dir(models_dir) else {
        return Vec::new();
    };
    let mut out: Vec<InstalledMlx> = read
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| {
            let files: Vec<(String, u64)> = std::fs::read_dir(entry.path())
                .ok()?
                .filter_map(Result::ok)
                .filter_map(|f| Some((f.file_name().to_string_lossy().into_owned(), f.metadata().ok()?.len())))
                .collect();
            let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
            (format_of_names(&names) == ModelFormat::Mlx).then(|| InstalledMlx {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path(),
                bytes: files.iter().map(|(_, b)| b).sum(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64) -> RepoFile {
        RepoFile { path: path.to_owned(), size }
    }

    #[test]
    fn a_stored_format_defaults_to_gguf() {
        assert_eq!(ModelFormat::from_stored(None), ModelFormat::Gguf);
        assert_eq!(ModelFormat::from_stored(Some("")), ModelFormat::Gguf);
        assert_eq!(ModelFormat::from_stored(Some("mlx")), ModelFormat::Mlx);
        assert_eq!(ModelFormat::Mlx.as_str(), "mlx");
    }

    #[test]
    fn mlx_files_are_selected_with_their_size() {
        let files = [
            file("config.json", 1),
            file("model-00001-of-00002.safetensors", 100),
            file("model-00002-of-00002.safetensors", 50),
            file("model.safetensors.index.json", 2),
            file("tokenizer.json", 4),
            file("README.md", 9),
            file("original/consolidated.00.pth", 999),
        ];
        let (picked, bytes) = select_mlx_files(&files).unwrap();
        assert_eq!(picked.len(), 5);
        assert_eq!(bytes, 157);
        assert!(!picked.iter().any(|f| f.path == "README.md"));
    }

    #[test]
    fn the_download_plan_stays_inside_the_model_folder() {
        let files = [file("config.json", 1), file("model.safetensors", 5)];
        let (folder, plan) = mlx_download_plan("mlx-community/Qwen-4bit", &files).unwrap();
        assert_eq!(folder, "Qwen-4bit");
        assert_eq!(plan.len(), 2);
        assert!(plan[0].url.starts_with("https://huggingface.co/mlx-community/Qwen-4bit/resolve/main/"));
        assert!(mlx_download_plan("../x/y", &files).is_none());
        assert!(mlx_download_plan("noslash", &files).is_none());
        assert!(mlx_download_plan("a/b", &[file("m.gguf", 1)]).is_none());
    }

    #[test]
    fn a_folder_listing_sets_the_format() {
        assert_eq!(format_of_names(&["config.json", "model.safetensors"]), ModelFormat::Mlx);
        assert_eq!(format_of_names(&["m-Q4.gguf"]), ModelFormat::Gguf);
        assert_eq!(format_of_names(&["model.safetensors"]), ModelFormat::Gguf);
        assert_eq!(format_of_names(&["config.json", "a.safetensors", "a.gguf"]), ModelFormat::Gguf);
    }

    #[test]
    fn mlx_folders_are_listed_and_gguf_files_are_not() {
        let dir = std::env::temp_dir().join(format!("draggy-mlx-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let m = dir.join("Qwen-4bit");
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("config.json"), b"{}").unwrap();
        std::fs::write(m.join("model.safetensors"), [0u8; 10]).unwrap();
        std::fs::write(dir.join("x.gguf"), b"g").unwrap();
        let found = list_mlx_models(&dir);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Qwen-4bit");
        assert_eq!(found[0].bytes, 12);
        assert!(list_mlx_models(&dir.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_gguf_repo_is_not_mlx() {
        assert!(select_mlx_files(&[file("m-Q4_K_M.gguf", 10), file("config.json", 1)]).is_none());
        assert!(select_mlx_files(&[file("model.safetensors", 10)]).is_none());
    }
}
