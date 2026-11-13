//! Finds the npm that installs MCP servers: beside the app, then in each PATH folder that holds npx.
//! The npm script runs under the node program, so no shell shim is ever started.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use draggy_mcp::provision::NpmProgram;

const NPX_NAMES: [&str; 3] = ["npx.cmd", "npx.exe", "npx"];

/// The npm CLI script for the first candidate folder that has one, run by `node`. None when npm is missing.
pub fn resolve_npm(node: &Path, path_var: &OsStr, exe_dir: Option<&Path>) -> Option<NpmProgram> {
    let mut dirs: Vec<PathBuf> = exe_dir.map(Path::to_path_buf).into_iter().collect();
    for dir in std::env::split_paths(path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let has_npx = if cfg!(windows) {
            NPX_NAMES.as_slice()
        } else {
            &NPX_NAMES[2..]
        }
        .iter()
        .any(|name| dir.join(name).is_file());
        if has_npx {
            dirs.push(dir);
        }
    }
    dirs.iter()
        .map(|dir| {
            dir.join("node_modules")
                .join("npm")
                .join("bin")
                .join("npm-cli.js")
        })
        .find(|cli| cli.is_file())
        .map(|cli| NpmProgram {
            file: node.to_string_lossy().into_owned(),
            prefix_args: vec![cli.to_string_lossy().into_owned()],
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = tempfile::tempdir().expect("tempdir").keep().join(name);
        std::fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn npm_in(dir: &Path) {
        let cli = dir.join("node_modules").join("npm").join("bin");
        std::fs::create_dir_all(&cli).expect("cli dir");
        std::fs::write(cli.join("npm-cli.js"), "").expect("cli");
    }

    #[test]
    fn npm_beside_the_app_wins_over_path() {
        let app = scratch("app");
        let node_root = scratch("node");
        npm_in(&app);
        npm_in(&node_root);
        std::fs::write(node_root.join(NPX_NAMES[2]), "").expect("npx");
        let path = std::env::join_paths([node_root.clone()]).expect("path");
        let found = resolve_npm(Path::new("node.exe"), &path, Some(&app)).expect("npm");
        assert_eq!(found.file, "node.exe");
        assert!(found.prefix_args[0].starts_with(&*app.to_string_lossy()));
    }

    #[test]
    fn npm_comes_from_a_path_folder_with_npx() {
        let node_root = scratch("node2");
        let bare = scratch("bare");
        npm_in(&node_root);
        std::fs::write(node_root.join(NPX_NAMES[2]), "").expect("npx");
        npm_in(&bare);
        let path = std::env::join_paths([bare.clone(), node_root.clone()]).expect("path");
        let found = resolve_npm(Path::new("node.exe"), &path, None).expect("npm");
        assert!(found.prefix_args[0].starts_with(&*node_root.to_string_lossy()));
    }

    #[test]
    fn no_npx_means_no_npm() {
        let bare = scratch("none");
        npm_in(&bare);
        let path = std::env::join_paths([bare.clone()]).expect("path");
        assert!(resolve_npm(Path::new("node.exe"), &path, None).is_none());
    }
}
