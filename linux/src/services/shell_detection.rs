use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

pub fn default_shell() -> ShellInfo {
    let path = env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("bash")
        .to_string();
    ShellInfo {
        id: name.clone(),
        name,
        path,
        is_default: true,
    }
}

pub fn available_shells() -> Vec<ShellInfo> {
    let default = default_shell();
    let mut shells = Vec::new();

    if let Ok(contents) = fs::read_to_string("/etc/shells") {
        for line in contents.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if Path::new(trimmed).exists() {
                let name = Path::new(trimmed)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(trimmed)
                    .to_string();
                let is_default = trimmed == default.path;
                shells.push(ShellInfo {
                    id: trimmed.to_string(),
                    name,
                    path: trimmed.to_string(),
                    is_default,
                });
            }
        }
    }

    if shells.is_empty() {
        shells.push(default);
    }
    shells
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_shell_not_empty() {
        let shell = default_shell();
        assert!(!shell.name.is_empty());
        assert!(!shell.path.is_empty());
    }

    #[test]
    fn test_available_shells_has_at_least_one() {
        let shells = available_shells();
        assert!(!shells.is_empty());
    }
}
