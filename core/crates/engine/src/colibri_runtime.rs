//! The colibri runtime on Linux x86_64 and macOS arm64: which archive to fetch, how it is checked, how the gateway is
//! launched and what its output lines mean. Port of the launch side of electron/colibriProcess.cjs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::binary_manager::{BinaryError, Downloader, Extractor};
use crate::platform::{Arch, Os};

pub const RELEASE: &str = "v2.0.0";
const BASE_URL: &str = "https://github.com/colibri-ai/colibri/releases/download";

/// One colibri archive with its published sha256.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColibriArchive {
    pub name: &'static str,
    pub sha256: &'static str,
}

/// The archive for this system, or None where none is published (Windows keeps its own installer).
pub fn archive_for(os: Os, arch: Arch) -> Option<ColibriArchive> {
    match (os, arch) {
        (Os::Linux, Arch::X64) => Some(ColibriArchive {
            name: "colibri-v2.0.0-linux-x86_64.tar.gz",
            sha256: "aef2c1e7d5cbad3d27cc90d8432775acdc315ec51f6d7a67a2f13a936f9978ce",
        }),
        (Os::MacOs, Arch::Arm64) => Some(ColibriArchive {
            name: "colibri-v2.0.0-macos-arm64.tar.gz",
            sha256: "faa0841b20b7efe3b3bbd537360a42bb8beeaa5031bfff3813ecb01367edf851",
        }),
        _ => None,
    }
}

pub fn archive_url(archive: &ColibriArchive) -> String {
    format!("{BASE_URL}/{RELEASE}/{}", archive.name)
}

/// Parses a `SHA256SUMS.txt` body (`<hex>  <name>` per line) into name -> digest.
pub fn parse_sums(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let (digest, name) = line.trim().split_once(char::is_whitespace)?;
            let name = name.trim().trim_start_matches('*');
            (digest.len() == 64
                && digest.bytes().all(|b| b.is_ascii_hexdigit())
                && !name.is_empty())
            .then(|| (name.to_owned(), digest.to_ascii_lowercase()))
        })
        .collect()
}

/// Downloads the archive, checks it against the pinned digest and the published sums, and unpacks it into `dest`.
/// A digest that disagrees with either source stops the install before anything is unpacked.
pub async fn install<D: Downloader, X: Extractor>(
    downloader: &D,
    extractor: &X,
    archive: &ColibriArchive,
    scratch: &Path,
    dest: &Path,
) -> Result<(), BinaryError> {
    let sums = downloader
        .get_text(&format!("{BASE_URL}/{RELEASE}/SHA256SUMS.txt"), None)
        .await?;
    if let Some(published) = parse_sums(&sums).get(archive.name) {
        if published != archive.sha256 {
            return Err(BinaryError::Checksum(archive.name.to_owned()));
        }
    }
    std::fs::create_dir_all(scratch)?;
    let file = scratch.join(archive.name);
    downloader
        .download(&archive_url(archive), &file, &|_| {})
        .await?;
    if hex::encode(Sha256::digest(std::fs::read(&file)?)) != archive.sha256 {
        let _ = std::fs::remove_file(&file);
        return Err(BinaryError::Checksum(archive.name.to_owned()));
    }
    std::fs::create_dir_all(dest)?;
    extractor.extract(&file, dest).await?;
    let _ = std::fs::remove_file(&file);
    Ok(())
}

/// The private Python the Linux colibri archive needs, since that archive bundles none. Pinned to one python-build-standalone
/// build; the owner still has to confirm the choice (see docs/research/START.md).
pub fn linux_python(arch: Arch) -> Option<ColibriArchive> {
    (arch == Arch::X64).then_some(ColibriArchive {
        name: "cpython-3.12.16+20261026-x86_64-unknown-linux-gnu-install_only.tar.gz",
        sha256: "6a79e922e50006b601f29e688407659da1c2b86ebcd4e9c7254cf234be8b89de",
    })
}

pub fn linux_python_url(archive: &ColibriArchive) -> String {
    format!(
        "https://github.com/astral-sh/python-build-standalone/releases/download/20261026/{}",
        archive.name.replace('+', "%2B")
    )
}

/// What the gateway's output means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayEvent {
    LoadFail { kind: String, detail: String },
    Listening,
    Blocked,
    Line,
}

pub fn parse_gateway_line(line: &str) -> GatewayEvent {
    for marker in ["engine load failed: kind=", "LOAD_FAIL kind="] {
        let found = if marker.starts_with("LOAD") {
            line.strip_prefix(marker)
        } else {
            line.find(marker).map(|at| &line[at + marker.len()..])
        };
        if let Some(rest) = found {
            let kind: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if !kind.is_empty() {
                let detail = rest[kind.len()..].trim().to_owned();
                return GatewayEvent::LoadFail { kind, detail };
            }
        }
    }
    let lower = line.to_ascii_lowercase();
    if lower.contains("openai-compatible api listening on") {
        GatewayEvent::Listening
    } else if lower.contains("application control policy") || lower.contains("blocked this file") {
        GatewayEvent::Blocked
    } else {
        GatewayEvent::Line
    }
}

/// The command line for one start. Never a shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

pub fn build_launch(
    python: &Path,
    script: &Path,
    model_dir: &Path,
    port: u16,
    kv_slots: u32,
) -> Launch {
    Launch {
        program: python.to_owned(),
        args: vec![
            "-u".into(),
            script.display().to_string(),
            "--model".into(),
            model_dir.display().to_string(),
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
            "--kv-slots".into(),
            kv_slots.to_string(),
        ],
        cwd: script.parent().map(Path::to_owned).unwrap_or_default(),
    }
}

/// The health URL on loopback only.
pub fn health_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/health")
}

/// The supervisor plan for one colibri start, ready when `/health` answers.
pub fn spawn_plan(launch: Launch, port: u16, model: &str) -> crate::supervisor::SpawnPlan {
    crate::supervisor::SpawnPlan {
        program: launch.program,
        args: launch.args,
        cwd: Some(launch.cwd),
        env: vec![
            ("PYTHONUTF8".into(), "1".into()),
            ("PYTHONUNBUFFERED".into(), "1".into()),
        ],
        port,
        ready_path: "/health",
        model: model.to_owned(),
        timeout: std::time::Duration::from_secs(900),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archives_exist_on_linux_x64_and_mac_arm64_only() {
        assert!(archive_for(Os::Linux, Arch::X64).is_some());
        assert!(archive_for(Os::MacOs, Arch::Arm64).is_some());
        assert!(archive_for(Os::Linux, Arch::Arm64).is_none());
        assert!(archive_for(Os::Windows, Arch::X64).is_none());
        for archive in [Os::Linux, Os::MacOs].map(|os| {
            archive_for(
                os,
                if os == Os::Linux {
                    Arch::X64
                } else {
                    Arch::Arm64
                },
            )
            .unwrap()
        }) {
            assert_eq!(archive.sha256.len(), 64);
            assert!(archive_url(&archive).starts_with("https://"));
        }
    }

    #[test]
    fn sums_parse_by_name() {
        let text = format!(
            "{}  a.tar.gz\n{} *b.tar.gz\nnot a line\n",
            "A".repeat(64),
            "b".repeat(64)
        );
        let sums = parse_sums(&text);
        assert_eq!(sums["a.tar.gz"], "a".repeat(64));
        assert_eq!(sums["b.tar.gz"], "b".repeat(64));
        assert_eq!(sums.len(), 2);
    }

    #[test]
    fn gateway_lines() {
        assert_eq!(
            parse_gateway_line("x engine load failed: kind=nomem need 9 GB"),
            GatewayEvent::LoadFail {
                kind: "nomem".into(),
                detail: "need 9 GB".into()
            }
        );
        assert_eq!(
            parse_gateway_line("LOAD_FAIL kind=oom"),
            GatewayEvent::LoadFail {
                kind: "oom".into(),
                detail: String::new()
            }
        );
        assert_eq!(
            parse_gateway_line("OpenAI-compatible API listening on 127.0.0.1:8000"),
            GatewayEvent::Listening
        );
        assert_eq!(
            parse_gateway_line("blocked by Application Control policy"),
            GatewayEvent::Blocked
        );
        assert_eq!(parse_gateway_line("loading"), GatewayEvent::Line);
    }

    #[test]
    fn the_linux_python_is_pinned_for_x64_only() {
        let py = linux_python(Arch::X64).unwrap();
        assert_eq!(py.sha256.len(), 64);
        assert!(linux_python_url(&py).contains("%2B20261026"));
        assert!(linux_python(Arch::Arm64).is_none());
    }

    #[test]
    fn launch_binds_loopback() {
        let launch = build_launch(
            Path::new("/py"),
            Path::new("/rt/gw.py"),
            Path::new("/m"),
            8000,
            1,
        );
        assert_eq!(launch.args[0], "-u");
        let at = launch.args.iter().position(|a| a == "--host").unwrap();
        assert_eq!(launch.args[at + 1], "127.0.0.1");
        assert_eq!(launch.cwd, Path::new("/rt"));
        assert_eq!(health_url(8000), "http://127.0.0.1:8000/health");
    }
}
