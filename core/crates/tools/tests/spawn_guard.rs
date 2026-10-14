//! Keeps process spawning in one file: only `core/crates/tools/src/spawn.rs` may name the process APIs. This is the
//! core-side twin of electron/spawning.test.js, which keeps every child behind platform.spawnHidden.

use std::fs;
use std::path::{Path, PathBuf};

const FORBIDDEN: [&str; 3] = ["std::process", "tokio::process", "Command::new"];

#[test]
fn only_spawn_rs_names_the_process_apis() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let allowed = Path::new("tools").join("src").join("spawn.rs");

    let mut scanned = Vec::new();
    let mut offenders = Vec::new();
    for dir in crate_dirs(&crates) {
        for root in [dir.join("src"), dir.join("examples")] {
            for file in rust_files(&root) {
                let relative = file.strip_prefix(&crates).unwrap_or(&file).to_path_buf();
                if relative == allowed {
                    scanned.push(relative);
                    continue;
                }
                scanned.push(relative.clone());
                offenders.extend(violations(&file, &relative));
            }
        }
    }

    assert!(
        scanned.iter().any(|path| path == &allowed),
        "the guard did not reach {}, so it proves nothing",
        allowed.display()
    );
    assert!(
        offenders.is_empty(),
        "process APIs outside {}; start processes through draggy_tools::spawn:\n{}",
        allowed.display(),
        offenders.join("\n")
    );
}

/// Every crate directory under `crates`, sorted so failures print in a stable order.
fn crate_dirs(crates: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(crates)
        .expect("core/crates is readable")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

/// Every `.rs` file under `root`, or none when the folder does not exist.
fn rust_files(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// `file:line: text` for each line of `file` that names a process API.
fn violations(file: &Path, relative: &Path) -> Vec<String> {
    let text = fs::read_to_string(file).unwrap_or_default();
    text.lines()
        .enumerate()
        .filter(|(_, line)| FORBIDDEN.iter().any(|word| line.contains(word)))
        .map(|(index, line)| format!("  {}:{}: {}", relative.display(), index + 1, line.trim()))
        .collect()
}
