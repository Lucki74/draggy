use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitInfo {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

pub fn git_diff<P: AsRef<Path>>(dir: P) -> String {
    let output = Command::new("git")
        .arg("diff")
        .current_dir(dir)
        .output();

    output.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
}

pub fn git_log<P: AsRef<Path>>(dir: P, max: usize) -> Vec<GitCommitInfo> {
    let output = Command::new("git")
        .args(["log", "-n", &max.to_string(), "--pretty=format:%h|%an|%ad|%s", "--date=short"])
        .current_dir(dir)
        .output();

    let mut commits = Vec::new();
    if let Ok(o) = output {
        let text = String::from_utf8_lossy(&o.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 4 {
                commits.push(GitCommitInfo {
                    hash: parts[0].to_string(),
                    author: parts[1].to_string(),
                    date: parts[2].to_string(),
                    message: parts[3].to_string(),
                });
            }
        }
    }
    commits
}
