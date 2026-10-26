use std::process::Command;

pub struct ProjectGitActions;

impl ProjectGitActions {
    pub fn stage(dir: &str, file: &str) -> bool {
        Command::new("git")
            .args(["add", file])
            .current_dir(dir)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    pub fn commit(dir: &str, msg: &str) -> bool {
        Command::new("git")
            .args(["commit", "-m", msg])
            .current_dir(dir)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}
