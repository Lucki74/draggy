//! Background update service for Linux: checks releases, verifies hashes, and installs via pkexec.

use std::path::Path;
use std::process::Command;

use gtk::gio;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleasePayload {
    pub version: String,
    pub download_url: String,
}

/// Detects whether Debian or RPM package format is preferred on the host system.
fn detect_package_format() -> &'static str {
    if Path::new("/etc/debian_version").exists() || Path::new("/usr/bin/apt").exists() {
        "deb"
    } else if Path::new("/etc/redhat-release").exists()
        || Path::new("/etc/fedora-release").exists()
        || Path::new("/usr/bin/dnf").exists()
    {
        "rpm"
    } else {
        "deb"
    }
}

/// Checks whether the pkexec binary exists on the system.
fn has_pkexec() -> bool {
    Path::new("/usr/bin/pkexec").exists()
        || Path::new("/bin/pkexec").exists()
        || Command::new("which")
            .arg("pkexec")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

pub struct AppUpdater;

impl AppUpdater {
    /// Checks for available updates unless running inside a Flatpak container.
    pub async fn check_for_updates(
        current_build: u32,
    ) -> Result<Option<draggy_core::update::UpdateRecord>, String> {
        if std::env::var_os("FLATPAK_ID").is_some() {
            return Ok(None);
        }
        let checker = draggy_core::update::UpdateChecker::new(
            "Lucki74/draggy".to_string(),
            Some("b-".to_string()),
        )
        .map_err(|e| e.to_string())?;

        let format = detect_package_format();
        checker
            .check_for_platform(current_build, true, Some(format.to_string()))
            .await
            .map_err(|e| e.to_string())
    }

    /// Downloads and verifies an update asset into the specified directory.
    pub async fn download_update(
        update: &draggy_core::update::UpdateRecord,
        dest_dir: &str,
    ) -> Result<String, String> {
        let checker = draggy_core::update::UpdateChecker::new(
            "Lucki74/draggy".to_string(),
            Some("b-".to_string()),
        )
        .map_err(|e| e.to_string())?;

        checker
            .download_update(update.clone(), dest_dir.to_string(), None)
            .await
            .map_err(|e| e.to_string())
    }

    /// Installs the package using pkexec or opens the release URL if pkexec is missing.
    pub fn install_and_restart(
        update: &draggy_core::update::UpdateRecord,
        package_path: &str,
    ) -> Result<(), String> {
        if !has_pkexec() {
            let _ =
                gio::AppInfo::launch_default_for_uri(&update.url, None::<&gio::AppLaunchContext>);
            return Ok(());
        }

        let is_deb = package_path.ends_with(".deb");
        let (cmd, args) = if is_deb {
            ("apt", vec!["install", "-y", package_path])
        } else {
            ("dnf", vec!["install", "-y", package_path])
        };

        let mut child = Command::new("pkexec")
            .arg(cmd)
            .args(&args)
            .spawn()
            .map_err(|e| format!("failed to spawn pkexec: {e}"))?;

        let status = child
            .wait()
            .map_err(|e| format!("pkexec wait failed: {e}"))?;
        if !status.success() {
            return Err(format!("installer exited with status {status}"));
        }

        if let Ok(exe) = std::env::current_exe() {
            let _ = Command::new(exe).spawn();
        } else {
            let _ = Command::new("/usr/bin/draggy").spawn();
        }
        std::process::exit(0);
    }
}
