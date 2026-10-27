use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_sec: u64,
}

pub fn list_directory<P: AsRef<Path>>(dir: P) -> io::Result<Vec<FileTreeEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata()?;
        let is_dir = meta.is_dir();
        let size = meta.len();
        let modified_sec = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(FileTreeEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_directory: is_dir,
            size,
            modified_sec,
        });
    }

    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            b.is_directory.cmp(&a.is_directory)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

pub fn create_file<P: AsRef<Path>>(parent: P, name: &str, content: &str) -> io::Result<PathBuf> {
    let target = parent.as_ref().join(name);
    fs::write(&target, content)?;
    Ok(target)
}

pub fn create_directory<P: AsRef<Path>>(parent: P, name: &str) -> io::Result<PathBuf> {
    let target = parent.as_ref().join(name);
    fs::create_dir_all(&target)?;
    Ok(target)
}

pub fn rename_item<P: AsRef<Path>>(path: P, new_name: &str) -> io::Result<PathBuf> {
    let old_path = path.as_ref();
    let new_path = old_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(new_name);
    fs::rename(old_path, &new_path)?;
    Ok(new_path)
}

pub fn delete_item<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = path.as_ref();
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_directory_returns_entries() {
        let entries = list_directory(".").unwrap();
        assert!(!entries.is_empty());
    }
}
