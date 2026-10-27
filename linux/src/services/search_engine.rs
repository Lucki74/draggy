use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub line_number: usize,
    pub snippet: String,
}

pub fn search_in_directory<P: AsRef<Path>>(
    root: P,
    query: &str,
    max_results: usize,
) -> Vec<SearchResult> {
    if query.trim().is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    let ignored = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "dist-electron",
        ".build",
    ];

    let mut stack = vec![root.as_ref().to_path_buf()];

    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                if file_name.starts_with('.') || ignored.contains(&file_name.as_str()) {
                    continue;
                }

                if path.is_dir() {
                    stack.push(path);
                } else if path.is_file() {
                    if let Ok(meta) = path.metadata() {
                        if meta.len() > 1_500_000 {
                            continue;
                        }
                    }

                    if let Ok(content) = fs::read_to_string(&path) {
                        for (idx, line) in content.lines().enumerate() {
                            if line.to_lowercase().contains(&query_lower) {
                                results.push(SearchResult {
                                    file_path: path.to_string_lossy().to_string(),
                                    file_name: file_name.clone(),
                                    line_number: idx + 1,
                                    snippet: line.trim().to_string(),
                                });

                                if results.len() >= max_results {
                                    return results;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_finds_result() {
        let res = search_in_directory(".", "Cargo", 5);
        assert!(!res.is_empty());
    }
}
