use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Default, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
}

pub fn get_git_status(dir: &str) -> GitStatusResult {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(dir)
        .output();

    let mut res = GitStatusResult::default();
    if let Ok(o) = output {
        let text = String::from_utf8_lossy(&o.stdout);
        for line in text.lines() {
            if line.starts_with("??") {
                res.untracked.push(line[3..].trim().to_string());
            } else if line.len() >= 3 {
                res.modified.push(line[3..].trim().to_string());
            }
        }
    }
    res
}
