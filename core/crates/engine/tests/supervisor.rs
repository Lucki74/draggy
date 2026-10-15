//! Runs the supervisor against a shell script standing in for llama-server, started through `draggy_tools::spawn`.
//! Health and time are faked so the wait is deterministic; the tests need a POSIX shell and are ignored on Windows.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use draggy_engine::binary_manager::EngineEnvironment;
use draggy_engine::command::ProcessRunner;
use draggy_engine::cpu_topology::CpuTopology;
use draggy_engine::llama_args::Speculation;
use draggy_engine::llama_health::{Clock, HealthProbe};
use draggy_engine::llama_process::{FailureKind, Host, LlamaSupervisor, StartRequest};
use draggy_engine::platform::Os;
use serde_json::Value;

const GIB: u64 = 1024 * 1024 * 1024;

/// Answers healthy while `marker` exists, which the stand-in server creates once it is up. Serves `served` as its model.
struct MarkerProbe {
    marker: PathBuf,
    served: Option<String>,
}

impl HealthProbe for MarkerProbe {
    async fn healthy(&self, _port: u16, _timeout: Duration) -> bool {
        self.marker.exists()
    }

    async fn served_model(&self, _port: u16, _timeout: Duration) -> Option<String> {
        self.served.clone()
    }
}

/// Moves only when asked to sleep, and really waits a few milliseconds so the child process gets time to run.
#[derive(Default)]
struct FakeClock {
    now: AtomicU64,
}

impl Clock for FakeClock {
    fn elapsed_ms(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }

    async fn sleep(&self, duration: Duration) {
        self.now
            .fetch_add(duration.as_millis() as u64, Ordering::SeqCst);
        tokio::time::sleep(duration.min(Duration::from_millis(5))).await;
    }
}

type Supervisor = LlamaSupervisor<MarkerProbe, FakeClock, ProcessRunner>;

/// The help text a stand-in answers `--help` with: enough flags to be believed, plus the ones the test names.
#[cfg(unix)]
fn help_block(extra: &[&str]) -> String {
    let mut block = String::from(
        "if [ \"$1\" = \"--help\" ]; then\n  i=0\n  while [ $i -lt 30 ]; do echo \"--flag-$i\"; i=$((i+1)); done\n  echo --spec-default\n  echo --cache-ram\n",
    );
    for flag in extra {
        block.push_str(&format!("  echo {flag}\n"));
    }
    block.push_str("  exit 0\nfi\n");
    block
}

/// Writes the stand-in server into `dir`. `DIR` in the body is replaced by the folder's path.
#[cfg(unix)]
fn server(dir: &Path, extra_flags: &[&str], body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = dir.join("llama-server");
    let text = format!(
        "#!/bin/sh\n{}{}\n",
        help_block(extra_flags),
        body.replace("DIR", &dir.to_string_lossy())
    );
    fs::write(&path, text).expect("stand-in server");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
    path
}

#[cfg(not(unix))]
fn server(dir: &Path, _extra_flags: &[&str], _body: &str) -> PathBuf {
    dir.join("llama-server")
}

fn host() -> Host {
    let path = std::env::var("PATH").unwrap_or_default();
    Host {
        os: Os::Linux,
        topology: CpuTopology {
            logical: 8,
            physical: 4,
            performance: 4,
        },
        total_ram_bytes: 64 * GIB,
        inherited_env: vec![("PATH".to_owned(), path)],
    }
}

fn supervisor(marker: PathBuf, served: Option<&str>) -> Supervisor {
    LlamaSupervisor::new(
        MarkerProbe {
            marker,
            served: served.map(str::to_owned),
        },
        FakeClock::default(),
        ProcessRunner,
        host(),
    )
}

/// A start of `model` in `dir` on a 12 GB CUDA card, with the user-data folder the engine keeps its files in.
fn request(dir: &Path, binary: &Path, model: &str) -> StartRequest {
    fs::create_dir_all(dir.join("user")).expect("user data");
    let mut request = StartRequest::new(binary, dir.join(model));
    request.user_data = Some(dir.join("user"));
    request.vram_gb = 12.0;
    request.engine = Some(EngineEnvironment {
        env: vec![("LD_LIBRARY_PATH".to_owned(), "/engine".to_owned())],
        runner_dir: dir.to_path_buf(),
        runner_type: "cuda",
        binary_path: Some(binary.to_path_buf()),
    });
    request
}

fn lines(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

/// The argument after `flag`, when the flag is there.
fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let at = args.iter().position(|arg| arg == flag)?;
    args.get(at + 1).map(String::as_str)
}

/// Polls until the check gives a value, failing the test after ten seconds.
async fn eventually<T>(mut check: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(value) = check() {
            return value;
        }
        assert!(Instant::now() < deadline, "condition not reached in time");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn starts_the_server_with_the_reference_flags_and_reports_it_ready() {
    let dir = tempfile::tempdir().expect("temp dir");
    let up = dir.path().join("up");
    let binary = server(
        dir.path(),
        &[],
        "printf '%s\\n' \"$@\" > \"DIR/args.txt\"\nenv > \"DIR/env.txt\"\ntouch \"DIR/up\"\necho \"load_tensors: offloaded 20/33 layers to GPU\" >&2\nsleep 30",
    );
    let sup = supervisor(up, None);

    let started = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the server starts");
    assert_eq!(started.port, 11435);
    assert_eq!(started.context_size, Some(8192));
    assert!(!started.already_running && !started.projector_refused);

    let args = lines(&dir.path().join("args.txt"));
    assert_eq!(args[0], "-m");
    assert_eq!(
        value_after(&args, "-m"),
        Some(dir.path().join("seer.gguf").to_string_lossy().as_ref())
    );
    assert_eq!(value_after(&args, "--port"), Some("11435"));
    assert_eq!(value_after(&args, "-ctk"), Some("q8_0"));
    assert_eq!(value_after(&args, "-c"), Some("8192"));
    assert_eq!(value_after(&args, "-b"), Some("2048"));
    assert_eq!(value_after(&args, "-ub"), Some("2048"));
    assert_eq!(value_after(&args, "-t"), Some("4"));
    assert_eq!(value_after(&args, "-tb"), Some("4"));
    assert!(args.contains(&"--jinja".to_owned()));
    assert!(args.contains(&"--spec-default".to_owned()));
    assert!(args.contains(&"--cache-ram".to_owned()));
    // The build does not list --fit-target, so none is passed.
    assert!(!args.contains(&"--fit-target".to_owned()));

    let env = lines(&dir.path().join("env.txt"));
    assert!(env.contains(&"LLAMA_ARG_FLASH_ATTN=on".to_owned()));
    assert!(env.contains(&"LLAMA_ARG_CACHE_TYPE_K=q8_0".to_owned()));
    assert!(env.contains(&"LD_LIBRARY_PATH=/engine".to_owned()));

    let status = sup.status();
    assert!(status.running);
    assert_eq!(status.port, 11435);
    assert_eq!(status.context_size, 8192);
    assert_eq!(status.speculation, Speculation::Ngram);
    assert_eq!(status.base_url, "http://127.0.0.1:11435/v1");
    let offload = eventually(|| sup.status().offload).await;
    assert_eq!((offload.layers, offload.total), (20, 33));

    sup.stop().await;
    assert!(!sup.status().running);
    assert_eq!(sup.engine_crashes(), 0);
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_caller_that_names_no_window_keeps_the_running_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spawns = dir.path().join("spawns");
    let binary = server(
        dir.path(),
        &[],
        "echo spawn >> \"DIR/spawns\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let mut first = request(dir.path(), &binary, "chat.gguf");
    first.context = Some(32_768);
    let started = sup.start(first).await.expect("starts");
    assert_eq!(started.context_size, Some(32_768));

    let again = sup
        .start(request(dir.path(), &binary, "chat.gguf"))
        .await
        .expect("reused");
    assert!(again.already_running);
    assert_eq!(again.context_size, Some(32_768));
    assert_eq!(
        lines(&spawns).len(),
        1,
        "the running model is not started again"
    );
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_server_that_exits_while_loading_is_reported_with_its_cause() {
    let dir = tempfile::tempdir().expect("temp dir");
    let binary = server(
        dir.path(),
        &[],
        "echo \"error loading model: no such tensor\" >&2\nexit 1",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let failure = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect_err("the server does not come up");
    assert_eq!(failure.kind, FailureKind::StoppedLoading);
    assert!(failure.error.contains("exit code 1"), "{}", failure.error);
    assert!(
        failure.error.contains("no such tensor"),
        "{}",
        failure.error
    );
    assert_eq!(failure.params["code"], "1");
    assert!(failure.params["reason"].contains("no such tensor"));
    assert!(failure.params["log"].contains("no such tensor"));
    // The reference counts a crash while loading as an engine crash too, so the stat is one, not two.
    assert_eq!(sup.engine_crashes(), 1);
    assert!(!sup.status().running);
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_server_that_never_answers_is_stopped_at_the_load_deadline() {
    let dir = tempfile::tempdir().expect("temp dir");
    let binary = server(dir.path(), &[], "sleep 30");
    let sup = supervisor(dir.path().join("up"), None);

    let failure = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect_err("the load times out");
    assert_eq!(failure.kind, FailureKind::LoadTimeout);
    assert!(failure.error.contains("took too long to load"));
    assert!(!sup.status().running);
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_server_that_dies_after_loading_is_counted_as_a_crash() {
    let dir = tempfile::tempdir().expect("temp dir");
    let binary = server(dir.path(), &[], "touch \"DIR/up\"\nsleep 1\nexit 3");
    let sup = supervisor(dir.path().join("up"), None);

    sup.start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the server loads");
    eventually(|| (sup.engine_crashes() == 1).then_some(())).await;
    assert!(!sup.status().running);
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_projector_the_engine_refuses_is_dropped_and_the_model_starts_without_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("seer.gguf"), "x").expect("model");
    fs::write(dir.path().join("seer-mmproj.gguf"), "x").expect("projector");
    let binary = server(
        dir.path(),
        &[],
        "for a in \"$@\"; do\n  if [ \"$a\" = \"--mmproj\" ]; then\n    echo \"clip_init: failed to load multimodal projector\" >&2\n    exit 1\n  fi\ndone\nprintf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let started = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the model starts without its projector");
    assert!(started.projector_refused);
    assert!(!lines(&dir.path().join("args.txt")).contains(&"--mmproj".to_owned()));

    // Every later start says so again, so a screen that missed the first answer still learns of it.
    let again = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("already running");
    assert!(again.already_running && again.projector_refused);
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_draft_the_engine_refuses_is_dropped_and_recorded() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("seer.gguf"), "x").expect("model");
    fs::write(dir.path().join("seer-draft.gguf"), "x").expect("draft");
    let binary = server(
        dir.path(),
        &[
            "--model-draft",
            "--draft-max",
            "--draft-min",
            "--draft-p-min",
            "-ngld",
        ],
        "for a in \"$@\"; do\n  if [ \"$a\" = \"--model-draft\" ]; then\n    echo \"failed to load draft model: vocab mismatch\" >&2\n    exit 1\n  fi\ndone\nprintf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let started = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the model starts without its draft");
    assert!(!started.projector_refused);
    let args = lines(&dir.path().join("args.txt"));
    assert!(!args.contains(&"--model-draft".to_owned()));
    assert_eq!(sup.status().speculation, Speculation::Ngram);

    let stats =
        fs::read_to_string(dir.path().join("user").join("draft-stats.json")).expect("stats");
    assert!(stats.contains("\"refused\":true"), "{stats}");
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_second_request_for_a_model_that_is_loading_joins_the_first() {
    let dir = tempfile::tempdir().expect("temp dir");
    let binary = server(
        dir.path(),
        &[],
        "echo spawn >> \"DIR/spawns\"\necho \"error loading model: truncated\" >&2\nexit 1",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let (one, two) = tokio::join!(
        sup.start(request(dir.path(), &binary, "seer.gguf")),
        sup.start(request(dir.path(), &binary, "seer.gguf")),
    );
    assert_eq!(one, two);
    assert!(one.is_err());
    assert_eq!(lines(&dir.path().join("spawns")).len(), 1);
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn starting_another_model_stops_the_one_running() {
    let dir = tempfile::tempdir().expect("temp dir");
    let up = dir.path().join("up");
    let binary = server(
        dir.path(),
        &[],
        "printf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(up.clone(), None);

    sup.start(request(dir.path(), &binary, "first.gguf"))
        .await
        .expect("first starts");
    // Stopping frees the port, which the fake health check reads from the marker file.
    fs::remove_file(&up).expect("port freed");
    let second = sup
        .start(request(dir.path(), &binary, "second.gguf"))
        .await
        .expect("second starts");
    assert_eq!(second.port, 11435);
    assert_eq!(
        sup.status().model.as_deref(),
        Some(dir.path().join("second.gguf").as_path())
    );
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn stopping_takes_the_whole_process_group_with_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    let late = dir.path().join("late");
    let binary = server(
        dir.path(),
        &[],
        "touch \"DIR/up\"\n(sleep 4; touch \"DIR/late\") &\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    sup.start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("starts");
    sup.stop().await;
    tokio::time::sleep(Duration::from_millis(5000)).await;
    assert!(!late.exists(), "a child of the server outlived the stop");
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_port_held_by_another_model_is_refused_without_starting_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("up"), "x").expect("marker");
    let spawns = dir.path().join("spawns");
    let binary = server(dir.path(), &[], "echo spawn >> \"DIR/spawns\"\nsleep 30");
    let sup = supervisor(dir.path().join("up"), Some("C:\\models\\other.gguf"));

    let failure = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect_err("refused");
    assert_eq!(failure.kind, FailureKind::PortInUse);
    assert!(failure.error.contains("other.gguf"), "{}", failure.error);
    assert!(failure.error.contains("seer.gguf"), "{}", failure.error);
    assert!(!spawns.exists());
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_server_already_holding_the_model_is_adopted() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("up"), "x").expect("marker");
    let binary = server(dir.path(), &[], "exit 1");
    let sup = supervisor(dir.path().join("up"), Some("D:\\Models\\Seer.gguf"));

    let started = sup
        .start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("adopted");
    assert_eq!(started.context_size, None);
    assert!(
        !sup.status().running,
        "an adopted server is not ours to stop"
    );
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_start_that_another_model_replaces_is_abandoned_and_the_newer_one_runs() {
    let dir = tempfile::tempdir().expect("temp dir");
    // The first model never answers its health check; the second one does.
    let binary = server(
        dir.path(),
        &[],
        "case \"$*\" in\n  *first.gguf*) touch \"DIR/first-up\"; sleep 30 ;;\n  *) touch \"DIR/up\"; sleep 30 ;;\nesac",
    );
    let sup = supervisor(dir.path().join("up"), None);

    let first_start = {
        let sup = sup.clone();
        let first = request(dir.path(), &binary, "first.gguf");
        tokio::spawn(async move { sup.start(first).await })
    };
    // The first server is running and still loading, so the second start replaces a live process.
    eventually(|| dir.path().join("first-up").exists().then_some(())).await;
    let second = sup.start(request(dir.path(), &binary, "second.gguf")).await;
    let first = first_start.await.expect("the first start finishes");
    let first = first.expect_err("the replaced start fails");
    assert_eq!(first.kind, FailureKind::AnotherModel);
    assert!(second.is_ok(), "{second:?}");
    assert_eq!(
        sup.status().model.as_deref(),
        Some(dir.path().join("second.gguf").as_path())
    );
    assert_eq!(sup.engine_crashes(), 0, "a stop is not a crash");
    sup.stop().await;
}

#[cfg(unix)]
#[tokio::test]
async fn a_binary_that_exists_but_will_not_run_is_reported_with_the_system_reason() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("temp dir");
    let binary = dir.path().join("llama-server");
    fs::write(&binary, "not a program").expect("binary");
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o644)).expect("not executable");
    let sup = supervisor(dir.path().join("up"), None);

    let failure = sup
        .start(StartRequest::new(&binary, dir.path().join("seer.gguf")))
        .await
        .expect_err("the binary does not start");
    assert_eq!(failure.kind, FailureKind::StoppedLoading);
    assert_eq!(failure.params["code"], "EACCES");
    assert!(!failure.params["reason"].is_empty());
}

#[tokio::test]
async fn a_split_model_missing_parts_is_refused_before_anything_starts() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("big-Q4_K_M-00001-of-00003.gguf"), "x").expect("part");
    let sup = supervisor(dir.path().join("up"), None);

    let failure = sup
        .start(StartRequest::new(
            dir.path().join("llama-server"),
            dir.path().join("big-Q4_K_M-00001-of-00003.gguf"),
        ))
        .await
        .expect_err("refused");
    assert_eq!(failure.kind, FailureKind::PartsMissing);
    assert_eq!(
        failure.params["parts"],
        "big-Q4_K_M-00002-of-00003.gguf, big-Q4_K_M-00003-of-00003.gguf"
    );
}

#[tokio::test]
async fn a_binary_that_is_not_there_is_named_as_such() {
    let dir = tempfile::tempdir().expect("temp dir");
    let sup = supervisor(dir.path().join("up"), None);

    let failure = sup
        .start(StartRequest::new(
            dir.path().join("absent-llama-server"),
            dir.path().join("seer.gguf"),
        ))
        .await
        .expect_err("refused");
    assert_eq!(failure.kind, FailureKind::EngineMissing);
    assert_eq!(failure.error, "llama-server binary not found");
}

/// Like `server`, but the stand-in waits `delay` before it answers `--help`, so a start spends that long on its flags.
#[cfg(target_os = "linux")]
fn slow_flags_server(dir: &Path, delay: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = dir.join("llama-server");
    let help = help_block(&[]).replace("; then\n", &format!("; then\n  {delay}\n"));
    let text = format!(
        "#!/bin/sh\n{help}{}\n",
        body.replace("DIR", &dir.to_string_lossy())
    );
    fs::write(&path, text).expect("stand-in server");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
    path
}

/// The flags a stand-in answers `--help` with, so the launch plans a draft.
const DRAFT_FLAGS: [&str; 5] = [
    "--model-draft",
    "--draft-max",
    "--draft-min",
    "--draft-p-min",
    "-ngld",
];

/// Writes the draft measurements a previous run left in the user-data folder.
fn stats_file(dir: &Path, text: &str) {
    fs::create_dir_all(dir.join("user")).expect("user data");
    fs::write(dir.join("user").join("draft-stats.json"), text).expect("stats");
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_start_dropped_while_loading_does_not_strand_the_next_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    let binary = server(dir.path(), &[], "touch \"DIR/spawned\"\nsleep 30");
    let sup = supervisor(dir.path().join("up"), None);

    let abandoned = {
        let sup = sup.clone();
        let start = request(dir.path(), &binary, "seer.gguf");
        tokio::spawn(async move { sup.start(start).await })
    };
    // The server is up but not answering, so the start is still waiting for it when it is dropped.
    eventually(|| dir.path().join("spawned").exists().then_some(())).await;
    abandoned.abort();
    let _ = abandoned.await;

    fs::write(dir.path().join("up"), "x").expect("marker");
    let again = tokio::time::timeout(
        Duration::from_secs(10),
        sup.start(request(dir.path(), &binary, "seer.gguf")),
    )
    .await
    .expect("the next start does not wait on the dropped one")
    .expect("the running server is reused");
    assert!(again.already_running);
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_reply_that_reports_its_draft_acceptance_is_measured() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("seer.gguf"), "x").expect("model");
    fs::write(dir.path().join("seer-draft.gguf"), "x").expect("draft");
    let binary = server(
        dir.path(),
        &DRAFT_FLAGS,
        "printf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\necho \"draft acceptance rate = 0.62857 (   44 accepted /    70 generated)\" >&2\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    sup.start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the model starts with its draft");
    assert!(lines(&dir.path().join("args.txt")).contains(&"--model-draft".to_owned()));

    let stats = dir.path().join("user").join("draft-stats.json");
    let text = eventually(|| {
        fs::read_to_string(&stats)
            .ok()
            .filter(|text| text.contains("\"samples\""))
    })
    .await;
    let saved: Value = serde_json::from_str(&text).expect("json");
    assert_eq!(saved["seer.gguf"]["samples"].as_f64(), Some(1.0));
    let rate = saved["seer.gguf"]["rate"].as_f64().expect("rate");
    assert!((rate - 44.0 / 70.0).abs() < 1e-9, "{rate}");
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_draft_measured_too_low_is_not_loaded() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("seer.gguf"), "x").expect("model");
    fs::write(dir.path().join("seer-draft.gguf"), "x").expect("draft");
    stats_file(dir.path(), r#"{"seer.gguf":{"rate":0.1,"samples":3}}"#);
    let binary = server(
        dir.path(),
        &DRAFT_FLAGS,
        "printf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    sup.start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the model starts without its draft");
    let args = lines(&dir.path().join("args.txt"));
    assert!(!args.contains(&"--model-draft".to_owned()), "{args:?}");
    sup.stop().await;
}

#[tokio::test]
#[cfg_attr(windows, ignore = "needs a POSIX shell to stand in for llama-server")]
async fn a_draft_measured_well_is_asked_for_its_measured_length() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join("seer.gguf"), "x").expect("model");
    fs::write(dir.path().join("seer-draft.gguf"), "x").expect("draft");
    stats_file(dir.path(), r#"{"seer.gguf":{"rate":0.7,"samples":5}}"#);
    let binary = server(
        dir.path(),
        &DRAFT_FLAGS,
        "printf '%s\\n' \"$@\" > \"DIR/args.txt\"\ntouch \"DIR/up\"\nsleep 30",
    );
    let sup = supervisor(dir.path().join("up"), None);

    sup.start(request(dir.path(), &binary, "seer.gguf"))
        .await
        .expect("the model starts with its draft");
    let args = lines(&dir.path().join("args.txt"));
    assert!(args.contains(&"--model-draft".to_owned()));
    assert_eq!(value_after(&args, "--draft-max"), Some("12"));
    sup.stop().await;
}

/// Moves like `FakeClock`, but waits a real 20 ms per poll, so a start that is never answered lasts long enough to overlap.
#[cfg(target_os = "linux")]
#[derive(Default)]
struct PacedClock {
    now: AtomicU64,
}

#[cfg(target_os = "linux")]
impl Clock for PacedClock {
    fn elapsed_ms(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }

    async fn sleep(&self, duration: Duration) {
        self.now
            .fetch_add(duration.as_millis() as u64, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
#[cfg(target_os = "linux")]
async fn a_start_that_spawns_while_another_is_listing_flags_stops_that_server() {
    let dir = tempfile::tempdir().expect("temp dir");
    let slow_dir = dir.path().join("slow");
    let quick_dir = dir.path().join("quick");
    fs::create_dir_all(&slow_dir).expect("slow engine folder");
    fs::create_dir_all(&quick_dir).expect("quick engine folder");
    // Asking an engine for its flags holds every start, so the first start spawns after its two-second listing, while the
    // second start waits behind that listing. The second start then finds the first loading and must stop it.
    let slow = slow_flags_server(&slow_dir, "sleep 2", "echo $$ > \"DIR/pid\"\nsleep 30");
    let quick = server(&quick_dir, &[], "touch \"DIR/up\"\nsleep 30");
    // A nine-gigabyte model gives the first start the longest load deadline, so it is still loading when replaced.
    let big = fs::File::create(dir.path().join("big.gguf")).expect("model");
    big.set_len(9 * GIB).expect("sparse model");
    let sup = LlamaSupervisor::new(
        MarkerProbe {
            marker: quick_dir.join("up"),
            served: None,
        },
        PacedClock::default(),
        ProcessRunner,
        host(),
    );

    let first = {
        let sup = sup.clone();
        let start = request(dir.path(), &slow, "big.gguf");
        tokio::spawn(async move { sup.start(start).await })
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    let second = {
        let sup = sup.clone();
        let start = request(dir.path(), &quick, "small.gguf");
        tokio::spawn(async move { sup.start(start).await })
    };

    let first = first.await.expect("the first start finishes");
    assert_eq!(
        first.expect_err("the first start is replaced").kind,
        FailureKind::AnotherModel
    );
    let second = second.await.expect("the second start finishes");
    assert!(second.is_ok(), "{second:?}");
    assert_eq!(
        sup.status().model.as_deref(),
        Some(dir.path().join("small.gguf").as_path())
    );
    // The server the first start spawned is stopped, not left holding the port and the GPU.
    let pid = fs::read_to_string(slow_dir.join("pid")).expect("the first server spawned");
    let proc_dir = PathBuf::from(format!("/proc/{}", pid.trim()));
    eventually(|| (!proc_dir.exists()).then_some(())).await;
    sup.stop().await;
}
