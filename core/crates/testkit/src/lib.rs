//! Loads the golden fixtures in `shared/fixtures/<area>/*.json`, the same files the vitest runners read.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// `shared/fixtures`, found from this crate's own location so tests work from any directory.
pub fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../shared/fixtures")
}

/// One fixture file, parsed. Panics with the path when it is missing or malformed, which fails the test.
pub fn load(area: &str, file: &str) -> Value {
    let path = fixtures_root().join(area).join(file);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("bad JSON in {}: {e}", path.display()))
}

/// The `cases` array of a fixture file: each entry has `name`, `input` and `expected`.
pub fn cases(area: &str, file: &str) -> Vec<Value> {
    load(area, file)["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{area}/{file} has no `cases` array"))
        .clone()
}

/// Every `*.json` file name in an area, sorted, so a new fixture file is picked up without a code change.
pub fn files(area: &str) -> Vec<String> {
    let dir = fixtures_root().join(area);
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    names
}

/// A path as the fixtures write it: forward slashes and no drive letter, whatever platform produced it.
pub fn posix_path(path: &str) -> String {
    let slashed = path.replace(std::path::MAIN_SEPARATOR, "/");
    match slashed.as_bytes() {
        [drive, b':', ..] if cfg!(windows) && drive.is_ascii_alphabetic() => {
            slashed[2..].to_owned()
        }
        _ => slashed,
    }
}
