use std::path::{Path, PathBuf};

pub struct SearchIndexer;

impl SearchIndexer {
    pub fn list_indexable_files<P: AsRef<Path>>(root: P) -> Vec<PathBuf> {
        let mut files = Vec::new();
        let mut stack = vec![root.as_ref().to_path_buf()];

        while let Some(dir) = stack.pop() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || name == "target" || name == "node_modules" {
                        continue;
                    }
                    if path.is_dir() {
                        stack.push(path);
                    } else if path.is_file() {
                        files.push(path);
                    }
                }
            }
        }
        files
    }
}
