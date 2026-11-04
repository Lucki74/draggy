//! Runs a real bubblewrap with the shared sandbox argument builder. Skips when `bwrap` is not installed, so hosts
//! without it stay green. Lives under tests/ because spawn_guard keeps process APIs out of src/.

#![cfg(target_os = "linux")]

use draggy_tools::sandbox::{SandboxSpec, bubblewrap_args, scrub_env};
use std::process::Command;

#[test]
fn bubblewrap_runs_a_command_with_scrubbed_env_and_no_network() {
    let available = Command::new("bwrap")
        .arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);
    if !available {
        eprintln!("skipped: bwrap is not installed");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let project = dir.path().to_path_buf();
    let spec = SandboxSpec {
        project: project.clone(),
        cwd: project.clone(),
        read_only: Vec::new(),
        read_write: vec![project.clone()],
        network: false,
        env: scrub_env(vec![
            ("PATH".into(), "/usr/bin:/bin".into()),
            ("GITHUB_TOKEN".into(), "secret".into()),
        ]),
        command: vec![
            "/bin/sh".into(),
            "-c".into(),
            "printf '%s' \"${GITHUB_TOKEN-unset}\"; echo; printf ok > ./inside.txt && cat ./inside.txt".into(),
        ],
    };
    let out = Command::new("bwrap")
        .args(bubblewrap_args(&spec))
        .env_clear()
        .output()
        .expect("bwrap runs");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&out.stdout), "unset\nok");
}
