//! What the engine knows about its host: the OS, the CPU architecture, the environment variables it reads, and the
//! file system and process seams its probes use. Port of the parts of electron/platform.cjs the engine needs.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// `process.platform`, reduced to the three the app ships on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Linux,
}

/// `os.arch()`, reduced to the two release archives are named for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X64,
    Arm64,
}

/// The environment variables the engine reads. A missing variable reads as the empty string, as `process.env.X || ""` does.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Env {
    vars: BTreeMap<String, String>,
}

impl Env {
    pub fn new<I, K, V>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        Self {
            vars: pairs
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        }
    }

    /// The variable's value, or "" when it is unset.
    pub fn get(&self, key: &str) -> &str {
        self.vars.get(key).map_or("", String::as_str)
    }

    /// The variable's value, or `default` when it is unset or empty, as `process.env.X || default` reads.
    pub fn or<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        match self.get(key) {
            "" => default,
            value => value,
        }
    }

    /// Every variable, in name order.
    pub fn entries(&self) -> impl Iterator<Item = (&str, &str)> {
        self.vars.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

/// The host the engine runs on: its OS, architecture and environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Platform {
    pub os: Os,
    pub arch: Arch,
    pub env: Env,
}

impl Platform {
    pub fn new(os: Os, arch: Arch, env: Env) -> Self {
        Self { os, arch, env }
    }

    /// The name the llama.cpp server binary has on this OS.
    pub fn server_name(&self) -> &'static str {
        if self.os == Os::Windows {
            "llama-server.exe"
        } else {
            "llama-server"
        }
    }

    /// The separator between entries of PATH and LD_LIBRARY_PATH.
    pub fn delimiter(&self) -> char {
        if self.os == Os::Windows { ';' } else { ':' }
    }

    /// Where the engine lives inside the app's data folder.
    pub fn engine_dir(&self, user_data: &Path) -> PathBuf {
        user_data.join("bin").join("llama")
    }
}

/// The reads the engine's probes make: sysfs, the drive list and the GPU folders. Real code uses [`DiskFiles`];
/// tests use a map.
pub trait Files: Sync {
    /// The file's text, or None when it cannot be read.
    fn read_text(&self, path: &Path) -> Option<String>;
    /// The names inside a folder, or None when it cannot be listed.
    fn list_dir(&self, path: &Path) -> Option<Vec<String>>;
    fn exists(&self, path: &Path) -> bool;
}

/// [`Files`] over the real file system.
#[derive(Debug, Clone, Copy, Default)]
pub struct DiskFiles;

impl Files for DiskFiles {
    fn read_text(&self, path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    fn list_dir(&self, path: &Path) -> Option<Vec<String>> {
        let entries = fs::read_dir(path).ok()?;
        Some(
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .collect(),
        )
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_reads_missing_variables_as_empty() {
        let env = Env::new([("PATH", "/bin")]);
        assert_eq!(env.get("PATH"), "/bin");
        assert_eq!(env.get("HOME"), "");
        assert_eq!(env.or("HOME", "/root"), "/root");
    }

    #[test]
    fn delimiter_and_server_name_follow_the_os() {
        let win = Platform::new(Os::Windows, Arch::X64, Env::default());
        assert_eq!(win.delimiter(), ';');
        assert_eq!(win.server_name(), "llama-server.exe");
        let linux = Platform::new(Os::Linux, Arch::X64, Env::default());
        assert_eq!(linux.delimiter(), ':');
        assert_eq!(linux.server_name(), "llama-server");
    }
}
