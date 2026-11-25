//! Finds the indexable files under a folder and reads their text, as the library's walk did.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use draggy_documents::office_files::{DOCUMENT_TEXT_LIMIT, extract_text};

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DEPTH: usize = 12;
const OFFICE_EXTENSIONS: &[&str] = &[".docx", ".pptx", ".xlsx", ".pdf"];
const TEXT_EXTENSIONS: &[&str] = &[
    ".txt",
    ".md",
    ".markdown",
    ".rst",
    ".log",
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".tex",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".vue",
    ".svelte",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".h",
    ".cpp",
    ".cc",
    ".hpp",
    ".cs",
    ".php",
    ".lua",
    ".r",
    ".pl",
    ".dart",
    ".scala",
    ".sh",
    ".sql",
    ".graphql",
];
const SKIP_DIRECTORIES: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    "out",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
    ".cache",
    "vendor",
    "Library",
    "AppData",
    "$RECYCLE.BIN",
    "System Volume Information",
];

/// A file the walk kept: its path, modified time in milliseconds, and size in bytes.
#[derive(Debug, Clone)]
pub struct FileInfo {
    pub path: PathBuf,
    pub mtime: i64,
    pub size: u64,
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn is_office(path: &Path) -> bool {
    OFFICE_EXTENSIONS.contains(&extension(path).as_str())
}

pub fn eligible(path: &Path) -> bool {
    let ext = extension(path);
    TEXT_EXTENSIONS.contains(&ext.as_str()) || OFFICE_EXTENSIONS.contains(&ext.as_str())
}

/// Every eligible file under the root, skipping hidden entries, build folders and very large files.
pub fn walk(root: &Path) -> Vec<FileInfo> {
    let mut found = Vec::new();
    walk_into(root, &mut found, 0);
    found
}

fn walk_into(dir: &Path, found: &mut Vec<FileInfo>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && name != ".env" {
            continue;
        }
        let full = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if !SKIP_DIRECTORIES.contains(&name.as_str()) {
                walk_into(&full, found, depth + 1);
            }
            continue;
        }
        if !kind.is_file() || !eligible(&full) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let size = meta.len();
        if size == 0 || size > MAX_FILE_BYTES {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_millis() as i64);
        found.push(FileInfo {
            path: full,
            mtime,
            size,
        });
    }
}

/// The text of a file, cut to the document limit. Office files go through their own readers.
pub fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let text = if is_office(path) {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        extract_text(&name, &bytes).map_err(|error| error.to_string())?
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(text.chars().take(DOCUMENT_TEXT_LIMIT).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_extensions_are_eligible() {
        assert!(eligible(Path::new("notes.MD")));
        assert!(eligible(Path::new("report.docx")));
        assert!(!eligible(Path::new("photo.png")));
    }

    #[test]
    fn hidden_and_build_folders_are_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("node_modules")).expect("mkdir");
        fs::create_dir_all(dir.path().join("docs")).expect("mkdir");
        fs::write(dir.path().join("node_modules").join("a.md"), "x").expect("write");
        fs::write(dir.path().join(".hidden.md"), "x").expect("write");
        fs::write(dir.path().join("docs").join("b.md"), "hello world").expect("write");
        let found = walk(dir.path());
        assert_eq!(found.len(), 1);
        assert!(found[0].path.ends_with("b.md"));
        assert_eq!(read_text(&found[0].path).expect("read"), "hello world");
    }
}
