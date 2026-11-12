//! Installs and checks the stable-diffusion engine binary, one runner folder per GPU backend. Port of
//! electron/sdBinaryManager.cjs.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use draggy_engine::binary_manager::{Downloader, Extractor};
use draggy_engine::platform::{Arch, Os};
use draggy_engine::sd_runner::{self, SdArchive};
use draggy_tools::spawn::hidden_command;
use serde_json::{Value, json};

use super::colibri::download_verified;
use super::host_platform;
use super::locked;
use super::sd::{self, SmokeFailure};

const REPO: &str = "leejet/stable-diffusion.cpp";
const LABEL: &str = "Image engine";
const SMOKE_TIMEOUT: Duration = Duration::from_secs(10);
const SEARCH_DEPTH: u8 = 3;

/// Where the engine for `release` keeps its runner folders.
pub fn engine_root(user_data: &Path, release: &str) -> PathBuf {
    user_data.join("bin").join("sd").join(release)
}

/// The folder one runner installs into.
pub fn runner_dir(user_data: &Path, runner: &str) -> PathBuf {
    engine_root(user_data, sd_runner::release_for(Os::Windows)).join(runner)
}

/// Whether the NVIDIA driver is present, the same check the Electron side makes.
pub fn has_nvidia_driver() -> bool {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    Path::new(&root)
        .join("System32")
        .join("nvcuda.dll")
        .exists()
}

/// The first file called `name` within `depth` folders of `dir`, checking a folder's files before its folders.
pub fn find_server_in(dir: &Path, name: &str, depth: u8) -> Option<PathBuf> {
    let mut subdirs = Vec::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_file() && entry.file_name() == name {
            return Some(entry.path());
        }
        if kind.is_dir() && depth > 0 {
            subdirs.push(entry.path());
        }
    }
    subdirs
        .iter()
        .find_map(|sub| find_server_in(sub, name, depth - 1))
}

/// An engine binary found on this machine: where it is, its runner and where it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundBinary {
    pub path: PathBuf,
    pub runner: String,
    /// `app` for a managed install, `path` for a binary on PATH.
    pub source: &'static str,
}

/// The installed engine binary: the preferred runner, then the other installed runners, then one on PATH.
pub fn find_sd_binary(user_data: &Path, preferred: Option<&str>) -> Option<FoundBinary> {
    let root = engine_root(user_data, sd_runner::release_for(Os::Windows));
    let names: Vec<String> = fs::read_dir(&root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let managed = sd::order_runners(names, preferred)
        .into_iter()
        .find_map(|runner| {
            let server = find_server_in(&root.join(&runner), sd::server_name(true), SEARCH_DEPTH)?;
            Some(FoundBinary {
                path: server,
                runner,
                source: "app",
            })
        });
    managed.or_else(|| {
        let path_value = std::env::var_os("PATH")?;
        find_on_path(sd::server_name(true), &path_value).map(|path| FoundBinary {
            path,
            runner: "external".into(),
            source: "path",
        })
    })
}

/// The first file called `name` in the folders of a PATH value, in PATH order.
pub fn find_on_path(name: &str, path_value: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_value)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// The free video memory of the first NVIDIA GPU in GB, from nvidia-smi. None when it cannot be asked.
pub async fn free_vram_gb() -> Option<f64> {
    let args = ["--query-gpu=memory.free", "--format=csv,noheader,nounits"];
    let output = tokio::time::timeout(
        Duration::from_secs(4),
        hidden_command("nvidia-smi", &args, |_| {}).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_free_mib(&String::from_utf8_lossy(&output.stdout))
}

/// The first line of `memory.free` in MiB, as GB. Negative or unreadable values give None.
pub fn parse_free_mib(text: &str) -> Option<f64> {
    let mib: i64 = text.lines().next()?.trim().parse().ok()?;
    (mib >= 0).then(|| mib as f64 / 1024.0)
}

#[cfg(test)]
mod lookup_tests {
    use super::*;

    #[test]
    fn free_vram_parses_first_gpu_in_gb() {
        assert_eq!(parse_free_mib("2048\n1024\n"), Some(2.0));
        assert_eq!(parse_free_mib("-1\n"), None);
        assert_eq!(parse_free_mib("n/a\n"), None);
    }

    #[test]
    fn path_lookup_takes_the_first_folder_with_the_file() {
        let dir = std::env::temp_dir().join(format!("sd-path-{}", std::process::id()));
        let empty = dir.join("empty");
        let with = dir.join("with");
        fs::create_dir_all(&empty).unwrap();
        fs::create_dir_all(&with).unwrap();
        fs::write(with.join("sd-server.exe"), b"x").unwrap();
        let path = std::env::join_paths([&empty, &with]).unwrap();
        assert_eq!(
            find_on_path("sd-server.exe", &path),
            Some(with.join("sd-server.exe"))
        );
        assert_eq!(find_on_path("missing.exe", &path), None);
        let _ = fs::remove_dir_all(&dir);
    }
}

/// The `kind` word the renderer reads for a failed smoke test.
pub fn smoke_kind(failure: SmokeFailure) -> &'static str {
    match failure {
        SmokeFailure::Timeout => "timeout",
        SmokeFailure::MissingLibrary => "missing-library",
        SmokeFailure::UnsupportedCpu => "unsupported-cpu",
        SmokeFailure::MissingBinary => "missing-binary",
        SmokeFailure::Failed => "failed",
    }
}

/// Runs `sd-server --version` hidden, with a ten second limit. Only a clean exit with printed output passes.
pub async fn smoke(binary: &Path) -> Result<(), SmokeFailure> {
    let dir = binary.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut command = hidden_command(binary, &["--version"], |c| {
        c.current_dir(&dir);
    });
    match tokio::time::timeout(SMOKE_TIMEOUT, command.output()).await {
        Err(_) => sd::classify_smoke(None, true, false, ""),
        Ok(Err(error)) => {
            sd::classify_smoke(None, false, error.kind() == io::ErrorKind::NotFound, "")
        }
        Ok(Ok(output)) => sd::classify_smoke(
            output.status.code().map(|code| code as u32),
            false,
            false,
            &String::from_utf8_lossy(&output.stdout),
        ),
    }
}

/// The outcome of one setup run. A failed run still names the runner it tried.
#[derive(Debug, Clone, PartialEq)]
pub enum Setup {
    Ready {
        runner: String,
        binary: PathBuf,
    },
    Failed {
        runner: Option<String>,
        kind: String,
        error: String,
    },
}

impl Setup {
    /// The `sd:setup-engine` result.
    pub fn to_value(&self) -> Value {
        match self {
            Setup::Ready { runner, .. } => {
                json!({ "success": true, "runner": runner, "kind": null, "error": null })
            }
            Setup::Failed {
                runner,
                kind,
                error,
            } => json!({ "success": false, "runner": runner, "kind": kind, "error": error }),
        }
    }
}

/// The runners to try in order: the best one for this machine, then Vulkan, then the CPU. Each is listed once,
/// and only where an archive is published.
pub fn runner_plan(os: Os, arch: Arch, vram_gb: f64, nvidia: bool) -> Vec<&'static str> {
    let preferred = sd_runner::default_runner(os, arch, vram_gb, nvidia, false);
    let mut plan: Vec<&'static str> = Vec::new();
    for runner in preferred.into_iter().chain(["vulkan", "cpu"]) {
        if !plan.contains(&runner) && sd_runner::archives_for(os, arch, runner).is_some() {
            plan.push(runner);
        }
    }
    plan
}

/// Installs the best runner for this machine. A build that will not run here falls back to the next one.
pub async fn ensure_engine<D: Downloader, X: Extractor>(
    user_data: &Path,
    net: &D,
    extractor: &X,
    vram_gb: f64,
    progress: &(dyn Fn(Value) + Sync),
) -> Setup {
    let host = host_platform();
    let nvidia = has_nvidia_driver();
    let plan = runner_plan(host.os, host.arch, vram_gb, nvidia);
    let mut last = Setup::Failed {
        runner: None,
        kind: "unsupported-platform".into(),
        error: "No image engine is published for this system".into(),
    };
    for runner in plan {
        last = install_runner(user_data, net, extractor, runner, progress).await;
        match &last {
            Setup::Ready { .. } => return last,
            Setup::Failed { kind, .. } if kind == "download-failed" => return last,
            Setup::Failed { .. } => {}
        }
    }
    last
}

/// Byte counter for the install: adds what each fetch reports, emitting at most every 100 ms and always the last.
fn reporter(total: u64, progress: &(dyn Fn(Value) + Sync)) -> impl Fn(u64) + Sync + '_ {
    let state = Mutex::new((0_u64, None::<Instant>));
    move |bytes| {
        let mut guard = locked(&state);
        guard.0 += bytes;
        let now = Instant::now();
        let due = guard
            .1
            .is_none_or(|last| now.duration_since(last) >= Duration::from_millis(100))
            || guard.0 >= total;
        if !due {
            return;
        }
        guard.1 = Some(now);
        let completed = guard.0;
        drop(guard);
        let percent = if total > 0 {
            (completed as f64 / total as f64 * 1000.0).round() / 10.0
        } else {
            0.0
        };
        progress(json!({
            "phase": "downloading",
            "percent": percent,
            "completed": completed,
            "total": total,
            "label": LABEL,
        }));
    }
}

fn download_url(name: &str) -> String {
    format!(
        "https://github.com/{REPO}/releases/download/{}/{name}",
        sd_runner::release_for(Os::Windows)
    )
}

/// Refuses an unpacked tree that holds a link, since a link could point outside the engine folder.
fn refuse_links(dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("The image engine archive holds a link".into());
        }
        if kind.is_dir() {
            refuse_links(&entry.path())?;
        }
    }
    Ok(())
}

/// Copies a folder tree over `to`, replacing files that exist.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Downloads, checks and unpacks one runner into a staging folder, then moves it into place and smoke-tests it.
pub async fn install_runner<D: Downloader, X: Extractor>(
    user_data: &Path,
    net: &D,
    extractor: &X,
    runner: &str,
    progress: &(dyn Fn(Value) + Sync),
) -> Setup {
    let failed = |kind: &str, error: String| Setup::Failed {
        runner: Some(runner.to_owned()),
        kind: kind.into(),
        error,
    };
    let Some(assets) = sd_runner::archives_for(Os::Windows, Arch::X64, runner) else {
        return failed(
            "unsupported-platform",
            "No image engine is published for this system".into(),
        );
    };
    let target = runner_dir(user_data, runner);
    let installed = match find_server_in(&target, sd::server_name(true), SEARCH_DEPTH) {
        Some(existing) => smoke(&existing).await.is_ok().then_some(existing),
        None => None,
    };
    if let Some(binary) = installed {
        return Setup::Ready {
            runner: runner.to_owned(),
            binary,
        };
    }

    let archives: Vec<SdArchive> = [Some(assets.main), assets.extra]
        .into_iter()
        .flatten()
        .collect();
    let total: u64 = archives.iter().map(|a| a.size).sum();
    let bytes = reporter(total, progress);
    let stage = target.with_file_name(format!("{runner}.staging"));
    let _ = fs::remove_dir_all(&stage);
    let staged: Result<PathBuf, String> = async {
        fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
        let out = stage.join("engine");
        for (index, archive) in archives.iter().enumerate() {
            let file = stage.join(archive.name);
            download_verified(
                net,
                &download_url(archive.name),
                &file,
                archive.sha256,
                &bytes,
            )
            .await?;
            let unpacked = stage.join(format!("x{index}"));
            extractor
                .extract(&file, &unpacked)
                .await
                .map_err(|e| e.to_string())?;
            refuse_links(&unpacked)?;
            // The runtime archive has no server; its libraries go beside the one from the main archive.
            let folder = find_server_in(&unpacked, sd::server_name(true), SEARCH_DEPTH)
                .and_then(|server| server.parent().map(Path::to_path_buf))
                .unwrap_or_else(|| unpacked.clone());
            copy_tree(&folder, &out).map_err(|e| e.to_string())?;
        }
        progress(json!({
            "phase": "extracting",
            "percent": 100,
            "completed": total,
            "total": total,
            "label": LABEL,
        }));
        if find_server_in(&out, sd::server_name(true), SEARCH_DEPTH).is_none() {
            return Err("The image engine archive has no sd-server".into());
        }
        let _ = fs::remove_dir_all(&target);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&out, &target).map_err(|e| e.to_string())?;
        Ok(target.clone())
    }
    .await;
    let _ = fs::remove_dir_all(&stage);
    if let Err(message) = staged {
        return failed("download-failed", message);
    }

    let Some(binary) = find_server_in(&target, sd::server_name(true), SEARCH_DEPTH) else {
        return failed(
            "download-failed",
            "The image engine archive has no sd-server".into(),
        );
    };
    match smoke(&binary).await {
        Ok(()) => Setup::Ready {
            runner: runner.to_owned(),
            binary,
        },
        Err(failure) => {
            let kind = smoke_kind(failure);
            failed(kind, format!("The image engine would not run ({kind})"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_starts_with_best_runner_and_lists_each_once() {
        let plan = runner_plan(Os::Windows, Arch::X64, 8.0, true);
        assert_eq!(plan.first(), Some(&"cuda"));
        assert!(plan.contains(&"vulkan") && plan.contains(&"cpu"));
        let mut unique = plan.clone();
        unique.dedup();
        assert_eq!(unique.len(), plan.len());
    }

    #[test]
    fn smoke_kinds_match_the_renderer_words() {
        assert_eq!(smoke_kind(SmokeFailure::Timeout), "timeout");
        assert_eq!(smoke_kind(SmokeFailure::MissingLibrary), "missing-library");
        assert_eq!(smoke_kind(SmokeFailure::UnsupportedCpu), "unsupported-cpu");
        assert_eq!(smoke_kind(SmokeFailure::MissingBinary), "missing-binary");
        assert_eq!(smoke_kind(SmokeFailure::Failed), "failed");
    }

    #[test]
    fn setup_result_shape() {
        let ready = Setup::Ready {
            runner: "cpu".into(),
            binary: PathBuf::from("x"),
        };
        assert_eq!(ready.to_value()["success"], json!(true));
        let failed = Setup::Failed {
            runner: Some("cuda".into()),
            kind: "timeout".into(),
            error: "The image engine would not run (timeout)".into(),
        };
        assert_eq!(failed.to_value()["kind"], json!("timeout"));
        assert_eq!(failed.to_value()["success"], json!(false));
    }
}
