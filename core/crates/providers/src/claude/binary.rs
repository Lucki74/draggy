//! The pinned Claude Code binary, downloaded on first sign-in since its licence grants no redistribution, and checked
//! against digests shipped in the app rather than the release's own manifest.

use std::path::Path;

use crate::account::supervisor::RuntimeUnavailable;
use crate::install_fs::{Download, FileView, InstallFs, Progress, SingleFlight, stream_to_file};

pub const VERSION: &str = "2.1.284";
const RELEASE: &str = "https://downloads.claude.ai/claude-code-releases/2.1.284";

/// Each build's digest and size, from the release's manifest.
pub const ASSETS: [(&str, &str, u64); 8] = [
    (
        "win32-x64",
        "0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d",
        246_480_032,
    ),
    (
        "win32-arm64",
        "8a968e1500576eea43d04d7cffd40cf39b1c83e5b443522bafe0e92e50d6a389",
        234_005_152,
    ),
    (
        "darwin-x64",
        "79441b868935a11ed0630b2ee59327eda9f6a93bb8d470bd6633c03df76d2135",
        235_010_944,
    ),
    (
        "darwin-arm64",
        "50a14c2f50f56668380fdda490167f1d3630d5cc18fb8aed3073c2c7ea7314fe",
        226_563_088,
    ),
    (
        "linux-x64",
        "5cd90aabd83f8a15136c35aa37bb1d92b348993573316643dc3fe4e04afbf88f",
        243_059_896,
    ),
    (
        "linux-arm64",
        "3dd0f96d7ada463152d20300186f6cfc6ab94b57e218f49e3ac86db42ac695a6",
        242_409_464,
    ),
    (
        "linux-x64-musl",
        "1c5e4d7431c1e70c45efdce69ea74c2c9a2ad309f16555f7dc563f4743d978a0",
        236_810_328,
    ),
    (
        "linux-arm64-musl",
        "d8bce5724ecd1e6930ddf5f4cef7cebb0cd3e50b4f5d5158b30a53f81824f982",
        234_764_096,
    ),
];

/// One build to download: where it comes from, and what its bytes must hash to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// The build for a platform and architecture. A glibc build does not start on musl, which reports no glibc version.
pub fn asset_for(platform: &str, arch: &str, musl: bool) -> Option<Asset> {
    asset_in(&ASSETS, platform, arch, musl)
}

fn asset_in(table: &[(&str, &str, u64)], platform: &str, arch: &str, musl: bool) -> Option<Asset> {
    let suffix = if platform == "linux" && musl {
        "-musl"
    } else {
        ""
    };
    let target = format!("{platform}-{arch}{suffix}");
    let (_, sha256, size) = table.iter().find(|(name, _, _)| *name == target)?;
    let name = if platform == "win32" {
        "claude.exe"
    } else {
        "claude"
    };
    Some(Asset {
        name: name.to_owned(),
        url: format!("{RELEASE}/{target}/{name}"),
        sha256: (*sha256).to_owned(),
        size: *size,
    })
}

/// The folder one pin installs into.
pub fn install_dir(app_data: &str) -> String {
    Path::new(app_data)
        .join("claude")
        .join("bin")
        .join(VERSION)
        .to_string_lossy()
        .into_owned()
}

fn executable_in(dir: &str, files: &dyn FileView) -> Option<String> {
    ["claude.exe", "claude"]
        .iter()
        .map(|name| Path::new(dir).join(name).to_string_lossy().into_owned())
        .find(|file| files.exists(file))
}

/// The installed executable for this pin, or None.
pub fn installed_binary(app_data: &str, files: &dyn FileView) -> Option<String> {
    executable_in(&install_dir(app_data), files)
}

/// An earlier pin's binary, still able to say who is signed in until the new one has downloaded.
pub fn previous_binary(app_data: &str, files: &dyn FileView) -> Option<String> {
    let bin = Path::new(app_data)
        .join("claude")
        .join("bin")
        .to_string_lossy()
        .into_owned();
    let dirs = files.list(&bin)?;
    dirs.iter()
        .filter(|name| name.as_str() != VERSION && !name.ends_with(".part"))
        .find_map(|dir| executable_in(&Path::new(&bin).join(dir).to_string_lossy(), files))
}

/// Resolves to the executable, downloading and verifying it first if needed. Callers at once share one install: a
/// listing and a sign-in would otherwise empty each other's staging folder.
#[allow(clippy::too_many_arguments)]
pub fn ensure(
    flight: &SingleFlight<Result<Option<String>, RuntimeUnavailable>>,
    table: &[(&str, &str, u64)],
    app_data: &str,
    platform: &str,
    arch: &str,
    musl: bool,
    download: &mut dyn Download,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<Option<String>, RuntimeUnavailable> {
    if let Some(existing) = installed_binary(app_data, fs) {
        return Ok(Some(existing));
    }
    flight.run(app_data, || {
        install_with(
            table,
            app_data,
            platform,
            arch,
            musl,
            download,
            fs,
            on_progress,
        )
    })
}

/// Downloads, verifies and installs one pin, replacing the folders of the others. A digest that differs leaves
/// nothing behind to run.
pub fn install(
    app_data: &str,
    platform: &str,
    arch: &str,
    musl: bool,
    download: &mut dyn Download,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<Option<String>, RuntimeUnavailable> {
    install_with(
        &ASSETS,
        app_data,
        platform,
        arch,
        musl,
        download,
        fs,
        on_progress,
    )
}

/// `install`, with the pin table given: the shipped table is `ASSETS`, and a test brings its own digests.
#[allow(clippy::too_many_arguments)]
pub fn install_with(
    table: &[(&str, &str, u64)],
    app_data: &str,
    platform: &str,
    arch: &str,
    musl: bool,
    download: &mut dyn Download,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<Option<String>, RuntimeUnavailable> {
    let Some(asset) = asset_in(table, platform, arch, musl) else {
        return Err(RuntimeUnavailable(format!(
            "Claude Code has no build for {platform} {arch}"
        )));
    };
    let dir = install_dir(app_data);
    let staging = format!("{dir}.part");
    fs.remove_tree(&staging);
    fs.make_dir(&staging);
    let file = Path::new(&staging)
        .join(&asset.name)
        .to_string_lossy()
        .into_owned();
    // The raw download error carries no code, as the reference rejects with it unchanged.
    let mut body = match download.open(&asset.url) {
        Ok(body) => body,
        Err(error) => {
            fs.remove_tree(&staging);
            return Err(RuntimeUnavailable(error.message));
        }
    };
    if let Err(error) = stream_to_file(&mut *body, &file, asset.size, fs, on_progress) {
        fs.remove_tree(&staging);
        return Err(RuntimeUnavailable(error.message));
    }
    if fs.sha256(&file).as_deref() != Some(asset.sha256.as_str()) {
        fs.remove_tree(&staging);
        return Err(RuntimeUnavailable(format!(
            "Checksum mismatch for {}",
            asset.name
        )));
    }
    if platform != "win32" {
        fs.set_executable(&file);
    }
    fs.remove_tree(&dir);
    fs.rename(&staging, &dir).map_err(RuntimeUnavailable)?;
    let parent = Path::new(&dir)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    for old in fs.list(&parent).unwrap_or_default() {
        if old != VERSION {
            fs.remove_tree(&Path::new(&parent).join(&old).to_string_lossy());
        }
    }
    Ok(installed_binary(app_data, fs))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::thread;

    use super::*;
    use crate::install_fs::Progress;
    use crate::install_fs::SingleFlight;
    use crate::install_fs::memory::{ChunkedDownload, MemFs, joined};
    use crate::install_fs::sha256_hex;

    const APP: &str = "/data/Draggy";

    #[test]
    fn pins_one_digest_per_platform_with_musl_only_on_linux() {
        let glibc = asset_for("linux", "x64", false).expect("linux x64 has a build");
        assert_eq!(
            glibc.sha256,
            "5cd90aabd83f8a15136c35aa37bb1d92b348993573316643dc3fe4e04afbf88f"
        );
        let musl = asset_for("linux", "x64", true).expect("musl build");
        assert_eq!(
            musl.sha256,
            "1c5e4d7431c1e70c45efdce69ea74c2c9a2ad309f16555f7dc563f4743d978a0"
        );
        assert_eq!(
            asset_for("win32", "x64", true).map(|a| a.sha256),
            asset_for("win32", "x64", false).map(|a| a.sha256)
        );
        assert_eq!(
            asset_for("win32", "x64", false).map(|a| a.name),
            Some("claude.exe".to_owned())
        );
        assert!(
            asset_for("darwin", "arm64", false)
                .is_some_and(|a| a.url.ends_with("/darwin-arm64/claude"))
        );
        assert!(asset_for("freebsd", "x64", false).is_none());
    }

    #[test]
    fn installs_once_reports_progress_per_chunk_and_removes_the_pin_it_replaces() {
        let bytes = b"claude binary".to_vec();
        let sha = sha256_hex(&bytes);
        let table = [("linux-x64", sha.as_str(), 13_u64)];
        let mut fs = MemFs::default();
        fs.make_dir(&format!("{APP}/claude/bin/2.1.200"));
        fs.write_file(&format!("{APP}/claude/bin/2.1.200/claude"), b"old");
        let mut download = ChunkedDownload {
            chunks: vec![bytes[..5].to_vec(), bytes[5..].to_vec()],
            ..ChunkedDownload::default()
        };
        let mut seen: Vec<Progress> = Vec::new();
        let mut progress = |p: Progress| seen.push(p);
        let installed = install_with(
            &table,
            APP,
            "linux",
            "x64",
            false,
            &mut download,
            &mut fs,
            &mut progress,
        );
        let binary = joined(&install_dir(APP), &["claude"]);
        assert_eq!(installed, Ok(Some(binary.clone())));
        assert_eq!(download.opened, 1);
        assert_eq!(
            seen,
            vec![
                Progress {
                    completed: 5,
                    total: 13,
                    percent: 38.5
                },
                Progress {
                    completed: 13,
                    total: 13,
                    percent: 100.0
                },
            ]
        );
        assert!(fs.is_executable(&binary));
        assert!(!fs.has_tree(&format!("{APP}/claude/bin/2.1.200")));
        assert!(!fs.has_tree(&format!("{}.part", install_dir(APP))));
    }

    #[test]
    fn refuses_a_digest_that_differs_and_leaves_nothing_to_run() {
        let table = [("linux-x64", "0", 3_u64)];
        let mut fs = MemFs::default();
        let mut download = ChunkedDownload {
            chunks: vec![b"bad".to_vec()],
            ..ChunkedDownload::default()
        };
        let result = install_with(
            &table,
            APP,
            "linux",
            "x64",
            false,
            &mut download,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(
            result,
            Err(RuntimeUnavailable(
                "Checksum mismatch for claude".to_owned()
            ))
        );
        assert!(!fs.has_tree(&install_dir(APP)));
        assert!(installed_binary(APP, &fs).is_none());
    }

    #[test]
    fn a_refused_download_says_what_the_transport_said_and_on_a_platform_with_no_build() {
        let table = [("linux-x64", "0", 3_u64)];
        let mut fs = MemFs::default();
        let mut offline = ChunkedDownload {
            refuse: Some("offline".to_owned()),
            ..ChunkedDownload::default()
        };
        let failed = install_with(
            &table,
            APP,
            "linux",
            "x64",
            false,
            &mut offline,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(failed, Err(RuntimeUnavailable("offline".to_owned())));
        assert!(!fs.has_tree(&format!("{}.part", install_dir(APP))));
        let none = install_with(
            &[],
            APP,
            "freebsd",
            "x64",
            false,
            &mut offline,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(
            none,
            Err(RuntimeUnavailable(
                "Claude Code has no build for freebsd x64".to_owned()
            ))
        );
    }

    #[test]
    fn callers_at_once_share_one_download() {
        let bytes = b"claude binary".to_vec();
        let sha = sha256_hex(&bytes);
        let table = [("linux-x64", sha.as_str(), 13_u64)];
        let flight = SingleFlight::default();
        let mut fs = MemFs::default();
        let mut download = ChunkedDownload {
            chunks: vec![bytes],
            ..ChunkedDownload::default()
        };
        let first = ensure(
            &flight,
            &table,
            APP,
            "linux",
            "x64",
            false,
            &mut download,
            &mut fs,
            &mut |_| {},
        );
        let second = ensure(
            &flight,
            &table,
            APP,
            "linux",
            "x64",
            false,
            &mut download,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(first, Ok(Some(joined(&install_dir(APP), &["claude"]))));
        assert_eq!(second, first);
        assert_eq!(download.opened, 1);
    }

    #[test]
    fn a_second_caller_waits_for_the_first_answer_instead_of_downloading() {
        let flight: Arc<SingleFlight<u32>> = Arc::new(SingleFlight::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let leader = {
            let flight = Arc::clone(&flight);
            thread::spawn(move || {
                flight.run("app", move || {
                    let _ = started_tx.send(());
                    let _ = release_rx.recv();
                    7
                })
            })
        };
        started_rx.recv().expect("the leader started");
        let follower = {
            let flight = Arc::clone(&flight);
            thread::spawn(move || flight.run("app", || unreachable!("the follower never works")))
        };
        while flight.waiters("app") == 0 {
            thread::yield_now();
        }
        release_tx.send(()).expect("the leader is waiting");
        assert_eq!(leader.join().expect("leader joins"), 7);
        assert_eq!(follower.join().expect("follower joins"), 7);
    }

    #[test]
    fn an_earlier_pin_answers_for_its_user_until_the_new_one_is_installed() {
        let mut fs = MemFs::default();
        fs.make_dir(&format!("{APP}/claude/bin/2.1.200"));
        fs.write_file(&format!("{APP}/claude/bin/2.1.200/claude"), b"old");
        fs.make_dir(&format!("{APP}/claude/bin/2.1.300.part"));
        assert_eq!(
            previous_binary(APP, &fs),
            Some(joined(APP, &["claude", "bin", "2.1.200", "claude"]))
        );
        assert_eq!(installed_binary(APP, &fs), None);
        fs.make_dir(&install_dir(APP));
        fs.write_file(&format!("{}/claude", install_dir(APP)), b"new");
        assert_eq!(
            installed_binary(APP, &fs),
            Some(joined(&install_dir(APP), &["claude"]))
        );
    }
}
