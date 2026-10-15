//! Stateful and asynchronous behaviour of the engine, run against fakes: the network, the archive extractor and the
//! helper programs. Mirrors the parts of electron/binaryManager.test.js, engineUpdater.test.js and hardwareProbe.test.js
//! that need a file system, a clock or a process, without touching the network or starting a real program.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

use draggy_engine::binary_manager::find_llama_binary;
use draggy_engine::binary_manager::{
    BinaryError, Downloader, Extractor, SetupOutcome, Toolkit, download_engine,
    ensure_engine_ready, ms_from_iso,
};
use draggy_engine::command::{CommandOutput, CommandRunner, ProcessSpec};
use draggy_engine::cpu_topology::{CpuTopology, detect, mac_topology};
use draggy_engine::engine_updater::{UpdateStatus, check_for_update, probe_engine};
use draggy_engine::hardware_probe::{
    Bench, BenchContext, BenchError, BenchRun, BenchSummary, HardwareProbe, Progress,
};
use draggy_engine::platform::{Arch, Env, Files, Os, Platform};
use draggy_engine::vram_probe::{VideoHost, detect_video_memory_gb};
use draggy_tools::spawn::CancelToken;
use draggy_web::policy::UrlPolicy;

/// A process runner that answers from a table: the first entry whose key is in the command line wins.
struct ScriptedRunner {
    table: Vec<(&'static str, bool, &'static str)>,
    seen: Mutex<Vec<String>>,
}

impl ScriptedRunner {
    fn new(table: Vec<(&'static str, bool, &'static str)>) -> Self {
        Self {
            table,
            seen: Mutex::new(Vec::new()),
        }
    }
}

impl CommandRunner for ScriptedRunner {
    async fn run(&self, spec: ProcessSpec) -> Option<CommandOutput> {
        let line = format!("{} {}", spec.program.display(), spec.args.join(" "));
        self.seen
            .lock()
            .map(|mut seen| seen.push(line.clone()))
            .ok();
        let (_, success, stdout) = self.table.iter().find(|(key, _, _)| line.contains(key))?;
        Some(CommandOutput {
            success: *success,
            stdout: (*stdout).to_owned(),
            stderr: String::new(),
        })
    }
}

/// A network that serves one release list and writes a fixed body for every download.
struct FakeNet {
    releases: String,
    body: Vec<u8>,
    downloads: AtomicUsize,
}

impl FakeNet {
    fn new(releases: &str, body: &[u8]) -> Self {
        Self {
            releases: releases.to_owned(),
            body: body.to_vec(),
            downloads: AtomicUsize::new(0),
        }
    }
}

impl Downloader for FakeNet {
    async fn get_text(&self, _url: &str, _accept: Option<&str>) -> Result<String, BinaryError> {
        if self.releases.is_empty() {
            return Err(BinaryError::Transfer("offline".to_owned()));
        }
        Ok(self.releases.clone())
    }

    async fn download(
        &self,
        _url: &str,
        dest: &Path,
        on_bytes: &(dyn Fn(u64) + Sync),
    ) -> Result<(), BinaryError> {
        self.downloads.fetch_add(1, Ordering::Relaxed);
        fs::write(dest, &self.body)?;
        on_bytes(self.body.len() as u64);
        Ok(())
    }
}

/// An extractor that unpacks the engine's files: the server and one GPU backend.
struct FakeExtract {
    files: Vec<&'static str>,
}

impl Extractor for FakeExtract {
    async fn extract(&self, _archive: &Path, dest: &Path) -> Result<(), BinaryError> {
        for file in &self.files {
            fs::write(dest.join(file), "x")?;
        }
        Ok(())
    }
}

fn linux() -> Platform {
    Platform::new(
        Os::Linux,
        Arch::X64,
        Env::new([("PATH", ""), ("DRAGGY_FS_ROOT", "/nonexistent-draggy-root")]),
    )
}

fn windows_with(local: &Path, path: &str) -> Platform {
    Platform::new(
        Os::Windows,
        Arch::X64,
        Env::new([
            ("LOCALAPPDATA", local.to_string_lossy().into_owned()),
            ("PATH", path.to_owned()),
        ]),
    )
}

fn write(file: &Path, text: &str) {
    fs::create_dir_all(file.parent().unwrap_or(file)).expect("create folder");
    fs::write(file, text).expect("write file");
}

fn release(tag: &str, age_days: i64, now: i64, assets: &[&str]) -> String {
    let published = chrono_like(now - age_days * 24 * 3600 * 1000);
    let list: Vec<String> = assets
        .iter()
        .map(|name| format!(r#"{{"name":"{name}","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/{name}","size":3}}"#))
        .collect();
    format!(
        r#"{{"tag_name":"{tag}","draft":false,"published_at":"{published}","assets":[{}]}}"#,
        list.join(",")
    )
}

/// A release list with one entry, as a JSON array.
fn releases(entries: &[String]) -> String {
    format!("[{}]", entries.join(","))
}

/// The UTC time of a millisecond count in the format GitHub uses.
fn chrono_like(ms: i64) -> String {
    draggy_engine::binary_manager::iso_from_ms(ms)
}

/// Runs a closure with the toolkit built from the fakes and a fixed clock.
fn toolkit<'a>(
    runner: &'a ScriptedRunner,
    net: &'a FakeNet,
    extract: &'a FakeExtract,
    policy: &'a Mutex<UrlPolicy>,
    clock: &'a (dyn Fn() -> i64 + Sync),
) -> Toolkit<'a, ScriptedRunner, FakeNet, FakeExtract> {
    Toolkit {
        runner,
        downloader: net,
        extractor: extract,
        policy,
        clock,
    }
}

fn now() -> i64 {
    ms_from_iso("2026-09-24T12:00:00Z").unwrap_or(0)
}

fn no_progress(_: draggy_engine::binary_manager::DownloadProgress) {}

#[tokio::test]
async fn an_engine_already_inside_is_ready_without_a_download() {
    let root = tempfile::tempdir().expect("temp dir");
    let platform = windows_with(root.path(), "");
    let llama = platform.engine_dir(root.path());
    write(&llama.join("llama-server.exe"), "x");
    fs::create_dir_all(llama.join("vulkan")).expect("vulkan folder");

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let outcome = ensure_engine_ready(&kit, &platform, root.path(), 4.0, false, &no_progress).await;

    assert_eq!(
        outcome,
        SetupOutcome::Ready {
            binary_path: llama.join("llama-server.exe"),
            runner_type: "vulkan",
        }
    );
    assert_eq!(net.downloads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn a_local_ollama_install_is_adopted_into_the_app_folder() {
    let local = tempfile::tempdir().expect("temp dir");
    let ollama = local
        .path()
        .join("Programs")
        .join("Ollama")
        .join("lib")
        .join("ollama");
    for file in [
        "llama-server.exe",
        "ggml-base.dll",
        "libc++.dll",
        "libomp.dll",
        "libunwind.dll",
        "libwinpthread-1.dll",
        "unrelated.txt",
    ] {
        write(&ollama.join(file), "x");
    }
    write(&ollama.join("cuda_v12").join("ggml-cuda.dll"), "x");
    write(&ollama.join("vulkan").join("ggml-vulkan.dll"), "x");
    let platform = windows_with(local.path(), "");
    let user_data = tempfile::tempdir().expect("temp dir");
    let llama = platform.engine_dir(user_data.path());

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let outcome =
        ensure_engine_ready(&kit, &platform, user_data.path(), 8.0, true, &no_progress).await;

    assert!(
        matches!(
            outcome,
            SetupOutcome::Ready {
                runner_type: "cuda",
                ..
            }
        ),
        "got {outcome:?}"
    );
    assert!(llama.join("ggml-base.dll").exists());
    assert!(llama.join("libc++.dll").exists());
    assert!(llama.join("cuda_v12").join("ggml-cuda.dll").exists());
    assert!(!llama.join("unrelated.txt").exists());
    assert!(!PathBuf::from(format!("{}.staging", llama.display())).exists());
    assert_eq!(net.downloads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn a_lonely_server_is_not_adopted_and_an_offline_download_fails_cleanly() {
    let local = tempfile::tempdir().expect("temp dir");
    let lonely = tempfile::tempdir().expect("temp dir");
    write(&lonely.path().join("llama-server.exe"), "x");
    let platform = windows_with(local.path(), &lonely.path().to_string_lossy());
    let user_data = tempfile::tempdir().expect("temp dir");

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let outcome =
        ensure_engine_ready(&kit, &platform, user_data.path(), 0.0, false, &no_progress).await;

    assert!(
        matches!(outcome, SetupOutcome::NotReady { .. }),
        "got {outcome:?}"
    );
    assert!(
        !platform
            .engine_dir(user_data.path())
            .join("llama-server.exe")
            .exists()
    );
}

#[tokio::test]
async fn a_release_is_downloaded_checked_and_unpacked_when_nothing_is_local() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    let llama = platform.engine_dir(user_data.path());
    let listing = releases(&[release(
        "b500",
        10,
        now(),
        &["llama-b500-bin-ubuntu-x64.tar.gz"],
    )]);

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new(&listing, b"abc");
    let extract = FakeExtract {
        files: vec!["llama-server"],
    };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let outcome =
        ensure_engine_ready(&kit, &platform, user_data.path(), 0.0, false, &no_progress).await;

    assert_eq!(
        outcome,
        SetupOutcome::Ready {
            binary_path: llama.join("llama-server"),
            runner_type: "cpu",
        }
    );
    let meta = draggy_engine::binary_manager::read_engine_meta(&llama);
    assert_eq!(meta.get("tag").and_then(|v| v.as_str()), Some("b500"));
    assert_eq!(meta.get("variant").and_then(|v| v.as_str()), Some("cpu"));
}

#[tokio::test]
async fn a_checksum_that_does_not_match_stops_the_download() {
    let stage = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    let asset = format!(
        r#"{{"name":"llama-b1-bin-ubuntu-x64.tar.gz","browser_download_url":"https://github.com/a/b","digest":"sha256:{}","size":3}}"#,
        "0".repeat(64)
    );
    let entry: draggy_engine::binary_manager::Release = serde_json::from_str(&format!(
        r#"{{"tag_name":"b1","draft":false,"assets":[{asset}]}}"#
    ))
    .expect("release");

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"abc");
    let extract = FakeExtract {
        files: vec!["llama-server"],
    };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let profile = draggy_engine::binary_manager::GpuProfile {
        vram_gb: 0.0,
        nvidia: false,
        cuda13: false,
    };
    let result = download_engine(
        &kit,
        &platform,
        stage.path(),
        profile,
        Some(&entry),
        &no_progress,
    )
    .await;

    assert!(
        matches!(result, Err(BinaryError::Checksum(ref name)) if name == "llama-b1-bin-ubuntu-x64.tar.gz"),
        "got {result:?}"
    );
}

#[tokio::test]
async fn a_download_from_an_untrusted_address_is_refused_before_it_starts() {
    let stage = tempfile::tempdir().expect("temp dir");
    let entry: draggy_engine::binary_manager::Release = serde_json::from_str(
        r#"{"tag_name":"b1","draft":false,"assets":[{"name":"llama-b1-bin-ubuntu-x64.tar.gz","browser_download_url":"http://192.168.1.2/a.tar.gz","size":3}]}"#,
    )
    .expect("release");
    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"abc");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let profile = draggy_engine::binary_manager::GpuProfile {
        vram_gb: 0.0,
        nvidia: false,
        cuda13: false,
    };
    let result = download_engine(
        &kit,
        &linux(),
        stage.path(),
        profile,
        Some(&entry),
        &no_progress,
    )
    .await;

    assert!(
        matches!(result, Err(BinaryError::UrlRefused)),
        "got {result:?}"
    );
    assert_eq!(net.downloads.load(Ordering::Relaxed), 0);
}

/// An installed engine at build 100 on Linux, with its vulkan runner.
fn installed_engine(platform: &Platform, user_data: &Path, meta: &str) -> PathBuf {
    let llama = platform.engine_dir(user_data);
    write(&llama.join("llama-server"), "x");
    write(&llama.join("libggml-vulkan.so"), "x");
    write(&llama.join("engine.json"), meta);
    llama
}

fn update_kit<'a>(
    runner: &'a ScriptedRunner,
    net: &'a FakeNet,
    extract: &'a FakeExtract,
    policy: &'a Mutex<UrlPolicy>,
    clock: &'a (dyn Fn() -> i64 + Sync),
) -> Toolkit<'a, ScriptedRunner, FakeNet, FakeExtract> {
    toolkit(runner, net, extract, policy, clock)
}

const STARTS: &[(&str, bool, &str)] = &[(
    "--version",
    true,
    "version: 0.25.1 (build 200, commit abc)\n",
)];

#[tokio::test]
async fn an_update_stages_the_newest_settled_build_and_waits_between_checks() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    let llama = installed_engine(
        &platform,
        user_data.path(),
        r#"{"tag":"b100","variant":"vulkan"}"#,
    );
    let listing = releases(&[
        release(
            "b300",
            1,
            now(),
            &["llama-b300-bin-ubuntu-vulkan-x64.tar.gz"],
        ),
        release(
            "b200",
            4,
            now(),
            &["llama-b200-bin-ubuntu-vulkan-x64.tar.gz"],
        ),
        release(
            "b150",
            9,
            now(),
            &["llama-b150-bin-ubuntu-vulkan-x64.tar.gz"],
        ),
    ]);
    let runner = ScriptedRunner::new(STARTS.to_vec());
    let net = FakeNet::new(&listing, b"abc");
    let extract = FakeExtract {
        files: vec!["llama-server", "libggml-vulkan.so"],
    };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = update_kit(&runner, &net, &extract, &policy, &clock);

    let status =
        check_for_update(&kit, &platform, user_data.path(), 8.0, false, false, now()).await;
    assert_eq!(
        status.ok(),
        Some(UpdateStatus::Staged {
            tag: "b200".to_owned(),
            variant: "vulkan".to_owned()
        })
    );
    let pending = draggy_engine::binary_manager::read_engine_meta(&PathBuf::from(format!(
        "{}.pending",
        llama.display()
    )));
    assert_eq!(
        pending.get("previousTag").and_then(|v| v.as_str()),
        Some("b100")
    );

    let again = check_for_update(&kit, &platform, user_data.path(), 8.0, false, true, now()).await;
    assert_eq!(again.ok(), Some(UpdateStatus::Pending));
    let fresh = check_for_update(&kit, &platform, user_data.path(), 8.0, false, false, now()).await;
    assert_eq!(fresh.ok(), Some(UpdateStatus::Pending));
}

#[tokio::test]
async fn a_recent_check_is_not_repeated_unless_forced() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    installed_engine(
        &platform,
        user_data.path(),
        r#"{"tag":"b100","variant":"vulkan"}"#,
    );
    let listing = releases(&[release(
        "b100",
        5,
        now(),
        &["llama-b100-bin-ubuntu-vulkan-x64.tar.gz"],
    )]);
    let runner = ScriptedRunner::new(STARTS.to_vec());
    let net = FakeNet::new(&listing, b"abc");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = update_kit(&runner, &net, &extract, &policy, &clock);

    assert_eq!(
        check_for_update(&kit, &platform, user_data.path(), 8.0, false, false, now())
            .await
            .ok(),
        Some(UpdateStatus::Current {
            tag: Some("b100".to_owned())
        })
    );
    assert_eq!(
        check_for_update(&kit, &platform, user_data.path(), 8.0, false, false, now())
            .await
            .ok(),
        Some(UpdateStatus::Recent)
    );
    assert_eq!(net.downloads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn a_build_that_will_not_start_is_never_staged_and_is_remembered() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    let llama = installed_engine(
        &platform,
        user_data.path(),
        r#"{"tag":"b100","variant":"vulkan"}"#,
    );
    let listing = releases(&[release(
        "b200",
        4,
        now(),
        &["llama-b200-bin-ubuntu-vulkan-x64.tar.gz"],
    )]);
    // The staged server is the only one under the staging folder, so only it fails.
    let runner = ScriptedRunner::new(vec![
        ("update-staging", false, ""),
        (
            "--version",
            true,
            "version: 0.25.1 (build 100, commit abc)\n",
        ),
    ]);
    let net = FakeNet::new(&listing, b"abc");
    let extract = FakeExtract {
        files: vec!["llama-server", "libggml-vulkan.so"],
    };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = update_kit(&runner, &net, &extract, &policy, &clock);

    let status =
        check_for_update(&kit, &platform, user_data.path(), 8.0, false, false, now()).await;
    assert!(
        matches!(status, Ok(UpdateStatus::Failed { ref error }) if error.contains("does not start")),
        "got {status:?}"
    );
    assert!(!PathBuf::from(format!("{}.pending", llama.display())).exists());
    let meta = draggy_engine::binary_manager::read_engine_meta(&llama);
    assert_eq!(
        meta.get("failedTags")
            .and_then(|v| v.as_array())
            .map(Vec::len),
        Some(1)
    );

    let again = check_for_update(&kit, &platform, user_data.path(), 8.0, false, true, now()).await;
    assert_eq!(again.ok(), Some(UpdateStatus::Current { tag: None }));
}

#[tokio::test]
async fn a_faster_build_for_the_gpu_is_staged_at_the_same_version() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    installed_engine(
        &platform,
        user_data.path(),
        r#"{"tag":"b100","variant":"cuda-12.8"}"#,
    );
    let entry = format!(
        r#"{{"tag_name":"b100","draft":false,"published_at":"{}","assets":[{{"name":"llama-b100-bin-ubuntu-cuda-13.4-x64.tar.gz","browser_download_url":"https://github.com/a/b","size":3}},{{"name":"cudart-llama-b100-bin-ubuntu-cuda-13.4-x64.tar.gz","browser_download_url":"https://github.com/a/c","size":3}}]}}"#,
        chrono_like(now() - 5 * 24 * 3600 * 1000)
    );
    let listing = releases(&[entry]);
    let runner = ScriptedRunner::new(vec![
        ("nvidia-smi", true, "10.0, 580.10\n"),
        (
            "--version",
            true,
            "version: 0.25.1 (build 100, commit abc)\n",
        ),
    ]);
    let net = FakeNet::new(&listing, b"abc");
    let extract = FakeExtract {
        files: vec!["llama-server", "libggml-cuda.so"],
    };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = update_kit(&runner, &net, &extract, &policy, &clock);

    let status =
        check_for_update(&kit, &platform, user_data.path(), 16.0, true, false, now()).await;
    assert_eq!(
        status.ok(),
        Some(UpdateStatus::Staged {
            tag: "b100".to_owned(),
            variant: "cuda-13.4".to_owned()
        })
    );
}

#[tokio::test]
async fn an_update_check_without_an_engine_does_nothing() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let platform = linux();
    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = update_kit(&runner, &net, &extract, &policy, &clock);
    assert_eq!(
        check_for_update(&kit, &platform, user_data.path(), 0.0, false, false, now())
            .await
            .ok(),
        Some(UpdateStatus::NoEngine)
    );
}

#[tokio::test]
async fn the_version_probe_reads_the_build_and_reports_a_crash() {
    let runner = ScriptedRunner::new(vec![
        (
            "ok-engine",
            true,
            "version: 0.25.1 (build 42, commit abc)\n",
        ),
        ("bad-engine", false, ""),
    ]);
    let good = probe_engine(&runner, Path::new("/x/ok-engine"), &[]).await;
    assert!(good.ok);
    assert_eq!(good.build, 42);
    let bad = probe_engine(&runner, Path::new("/x/bad-engine"), &[]).await;
    assert!(!bad.ok);
    assert_eq!(bad.build, 0);
}

struct FakeBenchWriter;

impl Bench for FakeBenchWriter {
    fn write_temp(&self, _file: &Path, _size: u64, cancel: &CancelToken) -> Result<(), BenchError> {
        // Waits for the cancel, as a long write does.
        while !cancel.is_cancelled() {
            thread::sleep(Duration::from_millis(5));
        }
        Err(BenchError::Cancelled)
    }

    fn measure(
        &self,
        _file: &Path,
        _size: u64,
        _cancel: &CancelToken,
        _ctx: &BenchContext<'_>,
    ) -> Result<BenchSummary, BenchError> {
        Err(BenchError::Cancelled)
    }
}

struct Registry;

impl CommandRunner for Registry {
    async fn run(&self, spec: ProcessSpec) -> Option<CommandOutput> {
        let key = spec.args.get(1).cloned().unwrap_or_default();
        let stdout = if key.ends_with("MountedDevices") {
            "    \\DosDevices\\D:    REG_BINARY    0102030405060708090a\n".to_owned()
        } else if key.ends_with("disk\\Enum") {
            "    0    REG_SZ    SCSI\\Disk&Ven_NVMe&Prod_SAMSUNG_MZVL21T0\\4&abc\n".to_owned()
        } else {
            "    VerifiedAndReputablePolicyState    REG_DWORD    0x1\n".to_owned()
        };
        Some(CommandOutput {
            success: true,
            stdout,
            stderr: String::new(),
        })
    }
}

#[test]
fn a_second_benchmark_is_refused_while_one_runs_and_a_cancel_stops_the_first() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let runner = Registry;
    let volumes = |_: &str| {
        Some(draggy_engine::hardware_probe::Space {
            size_bytes: 1 << 40,
            free_bytes: 1 << 40,
        })
    };
    let probe = HardwareProbe::new(
        Os::Windows,
        "C:\\Users\\me",
        PathBuf::from("reg.exe"),
        user_data.path(),
        &runner,
        &volumes,
    );
    let writer = FakeBenchWriter;

    thread::scope(|scope| {
        let first = scope.spawn(|| {
            let clock = || 0.0_f64;
            let random = || 0.5;
            let progress = |_: Progress| {};
            let ctx = BenchContext {
                now: &clock,
                random: &random,
                progress: &progress,
            };
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(probe.run_benchmark(&writer, "D:\\", 1.0, "first", &ctx))
        });
        // Give the first run time to reach its long write.
        thread::sleep(Duration::from_millis(150));
        let clock = || 0.0_f64;
        let random = || 0.5;
        let progress = |_: Progress| {};
        let ctx = BenchContext {
            now: &clock,
            random: &random,
            progress: &progress,
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let second = runtime.block_on(probe.run_benchmark(&writer, "D:\\", 1.0, "second", &ctx));
        assert_eq!(second, BenchRun::Refused("busy"));
        assert!(probe.cancel_benchmark());
        assert_eq!(first.join().ok(), Some(BenchRun::Cancelled));
    });
    assert!(!probe.cancel_benchmark());
}

#[test]
fn an_expired_or_unknown_benchmark_is_not_listed() {
    let user_data = tempfile::tempdir().expect("temp dir");
    fs::write(
        user_data.path().join("disk-bench.json"),
        r#"{"volume:D":{"at":1000}}"#,
    )
    .expect("cache");
    let runner = Registry;
    let volumes = |_: &str| None;
    let probe = HardwareProbe::new(
        Os::Windows,
        "C:\\",
        PathBuf::from("reg.exe"),
        user_data.path(),
        &runner,
        &volumes,
    );
    assert!(probe.benchmarks(1000.0).contains_key("volume:D"));
    assert!(
        probe
            .benchmarks(1000.0 + 30.0 * 24.0 * 3600.0 * 1000.0 + 1.0)
            .is_empty()
    );
}

struct Files2(HashMap<String, String>);

impl Files2 {
    /// A path is the same entry whichever separator the platform wrote it with.
    fn find(&self, path: &Path) -> Option<&String> {
        let slashed = |p: &str| p.replace(std::path::MAIN_SEPARATOR, "/");
        let wanted = slashed(&path.to_string_lossy());
        self.0
            .iter()
            .find_map(|(key, value)| (slashed(key) == wanted).then_some(value))
    }
}

impl Files for Files2 {
    fn read_text(&self, path: &Path) -> Option<String> {
        self.find(path).cloned()
    }

    fn list_dir(&self, path: &Path) -> Option<Vec<String>> {
        if path == Path::new("/sys/class/drm") {
            return Some(vec!["card0".to_owned(), "renderD128".to_owned()]);
        }
        None
    }

    fn exists(&self, path: &Path) -> bool {
        self.find(path).is_some()
    }
}

#[tokio::test]
async fn video_memory_asks_nvidia_smi_first_then_the_platform() {
    let host = VideoHost {
        os: Os::Linux,
        arch: Arch::X64,
        total_memory_bytes: 0,
        system_root: PathBuf::from("/"),
    };
    let nvidia = ScriptedRunner::new(vec![("nvidia-smi", true, "8192\n")]);
    let no_files = Files2(HashMap::new());
    assert_eq!(detect_video_memory_gb(&host, &nvidia, &no_files).await, 8.0);

    let amd = Files2(HashMap::from([(
        "/sys/class/drm/card0/device/mem_info_vram_total".to_owned(),
        "17179869184\n".to_owned(),
    )]));
    let nothing = ScriptedRunner::new(vec![]);
    assert_eq!(detect_video_memory_gb(&host, &nothing, &amd).await, 16.0);

    let rocm = ScriptedRunner::new(vec![(
        "rocm-smi",
        true,
        "GPU[0] : VRAM Total (B): 8589934592\n",
    )]);
    assert_eq!(detect_video_memory_gb(&host, &rocm, &no_files).await, 8.0);
}

#[tokio::test]
async fn video_memory_on_windows_reads_the_display_class_when_nvidia_is_absent() {
    let host = VideoHost {
        os: Os::Windows,
        arch: Arch::X64,
        total_memory_bytes: 0,
        system_root: PathBuf::from("C:\\Windows"),
    };
    let runner = ScriptedRunner::new(vec![(
        "reg.exe",
        true,
        "    HardwareInformation.qwMemorySize    REG_QWORD    0x200000000\n",
    )]);
    assert_eq!(
        detect_video_memory_gb(&host, &runner, &Files2(HashMap::new())).await,
        8.0
    );
}

#[tokio::test]
async fn an_apple_silicon_mac_budgets_from_the_wired_limit() {
    let host = VideoHost {
        os: Os::MacOs,
        arch: Arch::Arm64,
        total_memory_bytes: 16 * 1024 * 1024 * 1024,
        system_root: PathBuf::from("/"),
    };
    let runner = ScriptedRunner::new(vec![("iogpu.wired_limit_mb", true, "12288\n")]);
    assert_eq!(
        detect_video_memory_gb(&host, &runner, &Files2(HashMap::new())).await,
        12.0
    );
    let unset = ScriptedRunner::new(vec![]);
    let budget = detect_video_memory_gb(&host, &unset, &Files2(HashMap::new())).await;
    assert!((budget - 10.72).abs() < 1e-9);
}

#[tokio::test]
async fn cpu_topology_reads_mac_counts_and_falls_back_on_linux_without_sysfs() {
    let mac = ScriptedRunner::new(vec![
        ("hw.physicalcpu", true, "8\n"),
        ("hw.logicalcpu", true, "8\n"),
        ("hw.perflevel0.physicalcpu", true, "4\n"),
    ]);
    assert_eq!(
        mac_topology(&mac).await,
        Some(CpuTopology {
            logical: 8,
            physical: 8,
            performance: 4
        })
    );
    let fallback = detect(
        Os::Linux,
        &ScriptedRunner::new(vec![]),
        &Files2(HashMap::new()),
        "",
        12,
    )
    .await;
    assert_eq!(
        fallback,
        CpuTopology {
            logical: 12,
            physical: 6,
            performance: 6
        }
    );
}

#[tokio::test]
async fn the_system_tar_unpacks_a_real_archive() {
    use draggy_engine::binary_manager::TarExtractor;
    use draggy_engine::command::ProcessRunner;

    let work = tempfile::tempdir().expect("temp dir");
    let source = work.path().join("src");
    write(&source.join("llama-server"), "server");
    let archive = work.path().join("engine.tar.gz");
    let runner = ProcessRunner;
    let made = runner
        .run(ProcessSpec::new(
            "tar",
            &[
                "-czf",
                &archive.to_string_lossy(),
                "-C",
                &source.to_string_lossy(),
                "llama-server",
            ],
            Duration::from_secs(60),
        ))
        .await;
    if !made.is_some_and(|output| output.success) {
        // Without a tar on this machine there is nothing to check.
        return;
    }
    let dest = work.path().join("out");
    let platform = linux();
    let extractor = TarExtractor::for_platform(&runner, &platform);
    extractor.extract(&archive, &dest).await.expect("extract");
    assert_eq!(
        fs::read_to_string(dest.join("llama-server")).expect("unpacked server"),
        "server"
    );
}

#[tokio::test]
async fn an_ollama_install_without_an_nvidia_driver_is_adopted_and_runs_vulkan() {
    let local = tempfile::tempdir().expect("temp dir");
    let ollama = local
        .path()
        .join("Programs")
        .join("Ollama")
        .join("lib")
        .join("ollama");
    write(&ollama.join("llama-server.exe"), "x");
    write(&ollama.join("ggml-base.dll"), "x");
    write(&ollama.join("cuda_v12").join("ggml-cuda.dll"), "x");
    write(&ollama.join("vulkan").join("ggml-vulkan.dll"), "x");
    let platform = windows_with(local.path(), "");
    let user_data = tempfile::tempdir().expect("temp dir");

    let runner = ScriptedRunner::new(vec![]);
    let net = FakeNet::new("", b"");
    let extract = FakeExtract { files: vec![] };
    let policy = Mutex::new(UrlPolicy::new());
    let clock = || now();
    let kit = toolkit(&runner, &net, &extract, &policy, &clock);
    let outcome =
        ensure_engine_ready(&kit, &platform, user_data.path(), 8.0, false, &no_progress).await;

    assert!(
        matches!(
            outcome,
            SetupOutcome::Ready {
                runner_type: "vulkan",
                ..
            }
        ),
        "got {outcome:?}"
    );
    let llama = platform.engine_dir(user_data.path());
    assert!(llama.join("vulkan").join("ggml-vulkan.dll").exists());
    assert_eq!(net.downloads.load(Ordering::Relaxed), 0);
}

#[test]
fn the_engine_in_user_data_is_found_and_nothing_else_is_invented() {
    let user_data = tempfile::tempdir().expect("temp dir");
    let empty = tempfile::tempdir().expect("temp dir");
    let platform = windows_with(empty.path(), "");
    let llama = platform.engine_dir(user_data.path());
    write(&llama.join("llama-server.exe"), "x");
    assert_eq!(
        find_llama_binary(&platform, Some(user_data.path())),
        Some(llama.join("llama-server.exe"))
    );

    let nothing = tempfile::tempdir().expect("temp dir");
    let folder = nothing.path().to_string_lossy().into_owned();
    let bare = Platform::new(
        Os::Windows,
        Arch::X64,
        Env::new([
            ("LOCALAPPDATA", folder.as_str()),
            ("ProgramFiles", folder.as_str()),
            ("ProgramFiles(x86)", folder.as_str()),
            ("PATH", ""),
        ]),
    );
    assert_eq!(find_llama_binary(&bare, Some(nothing.path())), None);
}
