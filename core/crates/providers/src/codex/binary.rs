//! The pinned Codex app-server, downloaded on first sign-in and checked against digests shipped in the app. A `codex`
//! on PATH is ignored: it is usually an npm shim, and of whatever version the user has.

use std::path::Path;

use crate::account::supervisor::RuntimeUnavailable;
use crate::install_fs::{Download, FileView, InstallFs, Progress, SingleFlight, stream_to_file};

pub const VERSION: &str = "0.157.1";
const RELEASE: &str = "https://github.com/openai/codex/releases/download/rust-v0.157.1";

/// Each release archive's name, digest and size, from the release's own metadata.
pub const ASSETS: [(&str, &str, &str, u64); 6] = [
    (
        "win32-x64",
        "x86_64-pc-windows-msvc.exe.zip",
        "85ca951a6859757fe425407c4afe3ee1c59f3d35f739cdbd3be109393493048c",
        79_967_102,
    ),
    (
        "win32-arm64",
        "aarch64-pc-windows-msvc.exe.zip",
        "6c63db9e1b7f8f1395235c818a606e85348fe2c82c52d9eb67926d7adabe2cdb",
        73_709_402,
    ),
    (
        "darwin-x64",
        "x86_64-apple-darwin.tar.gz",
        "21bbe629d147e3ef965550a4a248aaab29c21336ec8b21df65177c7c459d2646",
        79_136_797,
    ),
    (
        "darwin-arm64",
        "aarch64-apple-darwin.tar.gz",
        "a427487e775e3053feacb9dee699439e36e1dac2fe9516fa5c22e922fcc70d60",
        72_664_357,
    ),
    (
        "linux-x64",
        "x86_64-unknown-linux-musl.tar.gz",
        "4bccc8c9f59dbbc473ce602ec9ef332e9e763d04ef4e1a3c206bfb9f132e7234",
        83_275_904,
    ),
    (
        "linux-arm64",
        "aarch64-unknown-linux-musl.tar.gz",
        "c9bd7ae2864a11f324eb99dfd6a3260865894739c2014024805baabd0f4659d3",
        77_526_660,
    ),
];

/// One archive to download: where from, what its bytes must hash to, and how big it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// The archive for a platform and architecture, or None where there is no build.
pub fn asset_for(platform: &str, arch: &str) -> Option<Asset> {
    asset_in(&ASSETS, platform, arch)
}

fn asset_in(table: &[(&str, &str, &str, u64)], platform: &str, arch: &str) -> Option<Asset> {
    let key = format!("{platform}-{arch}");
    let (_, target, sha256, size) = table.iter().find(|(name, _, _, _)| *name == key)?;
    let name = format!("codex-app-server-{target}");
    Some(Asset {
        url: format!("{RELEASE}/{name}"),
        name,
        sha256: (*sha256).to_owned(),
        size: *size,
    })
}

/// The folder one pin installs into.
pub fn install_dir(app_data: &str) -> String {
    Path::new(app_data)
        .join("codex")
        .join("bin")
        .join(VERSION)
        .to_string_lossy()
        .into_owned()
}

/// The installed executable, or None. The archive holds one file named after the target, whatever the OS.
pub fn installed_binary(app_data: &str, files: &dyn FileView) -> Option<String> {
    let dir = install_dir(app_data);
    let names = files.list(&dir)?;
    names
        .iter()
        .find(|name| name.starts_with("codex-app-server") && !is_archive_or_part(name))
        .map(|name| Path::new(&dir).join(name).to_string_lossy().into_owned())
}

fn is_archive_or_part(name: &str) -> bool {
    name.ends_with(".zip") || name.ends_with(".tar.gz") || name.ends_with(".part")
}

/// Unpacks an archive file into a folder. The shell backs this with the engine installer's extractor, which reads the
/// archive from disk.
pub trait Unpack {
    fn unpack(&mut self, archive: &str, dir: &str, fs: &mut dyn InstallFs) -> Result<(), String>;
}

/// Resolves to the app-server, downloading and verifying it first if needed. Callers at once share one install.
#[allow(clippy::too_many_arguments)]
pub fn ensure(
    flight: &SingleFlight<Result<String, RuntimeUnavailable>>,
    app_data: &str,
    platform: &str,
    arch: &str,
    download: &mut dyn Download,
    unpack: &mut dyn Unpack,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<String, RuntimeUnavailable> {
    if let Some(existing) = installed_binary(app_data, fs) {
        return Ok(existing);
    }
    flight.run(app_data, || {
        install(app_data, platform, arch, download, unpack, fs, on_progress)
    })
}

/// Downloads, verifies, unpacks and installs the pinned app-server. A digest that differs leaves nothing to run.
pub fn install(
    app_data: &str,
    platform: &str,
    arch: &str,
    download: &mut dyn Download,
    unpack: &mut dyn Unpack,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<String, RuntimeUnavailable> {
    install_with(
        &ASSETS,
        app_data,
        platform,
        arch,
        download,
        unpack,
        fs,
        on_progress,
    )
}

/// `install`, with the release table given: the shipped table is `ASSETS`, and a test brings its own digests.
#[allow(clippy::too_many_arguments)]
pub fn install_with(
    table: &[(&str, &str, &str, u64)],
    app_data: &str,
    platform: &str,
    arch: &str,
    download: &mut dyn Download,
    unpack: &mut dyn Unpack,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<String, RuntimeUnavailable> {
    if let Some(existing) = installed_binary(app_data, fs) {
        return Ok(existing);
    }
    let Some(asset) = asset_in(table, platform, arch) else {
        return Err(RuntimeUnavailable(format!(
            "Codex has no build for {platform} {arch}"
        )));
    };
    let dir = install_dir(app_data);
    let staging = format!("{dir}.part");
    fs.remove_tree(&staging);
    fs.make_dir(&staging);
    let archive = Path::new(&staging)
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
    if let Err(error) = stream_to_file(&mut *body, &archive, asset.size, fs, on_progress) {
        fs.remove_tree(&staging);
        return Err(RuntimeUnavailable(error.message));
    }
    // Checked here as well as in the download, so a change there can never let an unchecked binary run.
    if fs.sha256(&archive).as_deref() != Some(asset.sha256.as_str()) {
        fs.remove_tree(&staging);
        return Err(RuntimeUnavailable(format!(
            "Checksum mismatch for {}",
            asset.name
        )));
    }
    unpack
        .unpack(&archive, &staging, fs)
        .map_err(RuntimeUnavailable)?;
    fs.remove_tree(&archive);
    fs.remove_tree(&dir);
    fs.rename(&staging, &dir).map_err(RuntimeUnavailable)?;
    let binary = installed_binary(app_data, fs)
        .ok_or_else(|| RuntimeUnavailable("The Codex archive held no app-server".to_owned()))?;
    if platform != "win32" {
        fs.set_executable(&binary);
    }
    Ok(binary)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::thread;

    use super::*;
    use crate::install_fs::memory::{ChunkedDownload, MemFs};
    use crate::install_fs::sha256_hex;

    /// Writes one app-server file into the folder, as the release archive holds it.
    struct Unpacker;

    impl Unpack for Unpacker {
        fn unpack(
            &mut self,
            _archive: &str,
            dir: &str,
            fs: &mut dyn InstallFs,
        ) -> Result<(), String> {
            fs.write_file(
                &format!("{dir}/codex-app-server-x86_64-unknown-linux-musl"),
                b"app",
            );
            Ok(())
        }
    }

    struct Empty;

    impl Unpack for Empty {
        fn unpack(
            &mut self,
            _archive: &str,
            _dir: &str,
            _fs: &mut dyn InstallFs,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    const APP: &str = "/data/Draggy";
    const TARGET: &str = "x86_64-unknown-linux-musl.tar.gz";

    #[test]
    fn names_the_release_archive_for_each_platform() {
        let linux = asset_for("linux", "x64").expect("linux x64 has a build");
        assert_eq!(
            linux.name,
            "codex-app-server-x86_64-unknown-linux-musl.tar.gz"
        );
        assert_eq!(linux.url, format!("{RELEASE}/codex-app-server-{TARGET}"));
        assert!(asset_for("win32", "x64").is_some_and(|a| a.name.ends_with(".exe.zip")));
        assert!(asset_for("freebsd", "x64").is_none());
    }

    #[test]
    fn finds_the_app_server_and_never_an_archive() {
        let mut fs = MemFs::default();
        fs.make_dir(&install_dir(APP));
        fs.write_file(
            &format!("{}/codex-app-server-x.tar.gz", install_dir(APP)),
            b"archive",
        );
        assert_eq!(installed_binary(APP, &fs), None);
        fs.write_file(&format!("{}/codex-app-server-x", install_dir(APP)), b"app");
        assert_eq!(
            installed_binary(APP, &fs),
            Some(format!("{}/codex-app-server-x", install_dir(APP)))
        );
    }

    #[test]
    fn downloads_verifies_unpacks_and_installs_once() {
        let archive = b"release archive".to_vec();
        let sha = sha256_hex(&archive);
        let table = [("linux-x64", TARGET, sha.as_str(), 15_u64)];
        let mut fs = MemFs::default();
        let mut download = ChunkedDownload {
            chunks: vec![archive],
            ..ChunkedDownload::default()
        };
        let binary = install_with(
            &table,
            APP,
            "linux",
            "x64",
            &mut download,
            &mut Unpacker,
            &mut fs,
            &mut |_| {},
        );
        let expected = format!(
            "{}/codex-app-server-x86_64-unknown-linux-musl",
            install_dir(APP)
        );
        assert_eq!(binary, Ok(expected.clone()));
        assert!(fs.executable.contains(&expected));
        assert!(!fs.has_tree(&format!("{}.part", install_dir(APP))));

        let again = install_with(
            &table,
            APP,
            "linux",
            "x64",
            &mut download,
            &mut Unpacker,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(again, Ok(expected));
        assert_eq!(
            download.opened, 1,
            "an installed pin is not downloaded again"
        );
    }

    #[test]
    fn refuses_an_archive_whose_digest_differs() {
        let table = [("linux-x64", TARGET, "0", 3_u64)];
        let mut fs = MemFs::default();
        let mut download = ChunkedDownload {
            chunks: vec![b"other".to_vec()],
            ..ChunkedDownload::default()
        };
        let result = install_with(
            &table,
            APP,
            "linux",
            "x64",
            &mut download,
            &mut Unpacker,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(
            result,
            Err(RuntimeUnavailable(
                "Checksum mismatch for codex-app-server-x86_64-unknown-linux-musl.tar.gz"
                    .to_owned()
            ))
        );
        assert!(!fs.has_tree(&install_dir(APP)));
    }

    #[test]
    fn says_so_when_the_archive_holds_no_app_server() {
        let archive = b"empty".to_vec();
        let sha = sha256_hex(&archive);
        let table = [("linux-x64", TARGET, sha.as_str(), 5_u64)];
        let mut fs = MemFs::default();
        let mut download = ChunkedDownload {
            chunks: vec![archive],
            ..ChunkedDownload::default()
        };
        let result = install_with(
            &table,
            APP,
            "linux",
            "x64",
            &mut download,
            &mut Empty,
            &mut fs,
            &mut |_| {},
        );
        assert_eq!(
            result,
            Err(RuntimeUnavailable(
                "The Codex archive held no app-server".to_owned()
            ))
        );
    }

    #[test]
    fn a_second_caller_waits_for_the_install_already_running() {
        let archive = b"release archive".to_vec();
        let sha = sha256_hex(&archive);
        let flight: Arc<SingleFlight<Result<String, RuntimeUnavailable>>> =
            Arc::new(SingleFlight::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let leader = {
            let flight = Arc::clone(&flight);
            thread::spawn(move || {
                let mut fs = MemFs::default();
                let mut download = ChunkedDownload {
                    chunks: vec![archive],
                    ..ChunkedDownload::default()
                };
                let table = [("linux-x64", TARGET, sha.as_str(), 15_u64)];
                flight.run(APP, || {
                    let _ = started_tx.send(());
                    let _ = release_rx.recv();
                    install_with(
                        &table,
                        APP,
                        "linux",
                        "x64",
                        &mut download,
                        &mut Unpacker,
                        &mut fs,
                        &mut |_| {},
                    )
                })
            })
        };
        started_rx.recv().expect("the leader started");
        let follower = {
            let flight = Arc::clone(&flight);
            thread::spawn(move || flight.run(APP, || unreachable!("the follower never installs")))
        };
        while flight.waiters(APP) == 0 {
            thread::yield_now();
        }
        release_tx.send(()).expect("the leader is waiting");
        let expected = format!(
            "{}/codex-app-server-x86_64-unknown-linux-musl",
            install_dir(APP)
        );
        assert_eq!(leader.join().expect("leader joins"), Ok(expected.clone()));
        assert_eq!(follower.join().expect("follower joins"), Ok(expected));
    }
}
