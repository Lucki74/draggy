//! Runs the golden fixtures in `shared/fixtures/engine` through the port, as `src/__tests__/fixtures/engine.test.ts` does for
//! the Electron/CJS reference. Whole numbers are compared as integers on both sides, so 64-bit values stay exact through JSON.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Mutex;

use draggy_engine::binary_manager::{
    Asset, GpuProfile, RUNNER_TABLE, RunnerOptions, RunnerSpec, build_number, detect_gpu_runner_with, engine_environment, engine_state,
    pick_release_assets, recommended_release_asset, validate_download_url, variant_of, why_picked,
};
use draggy_engine::command::{CommandOutput, CommandRunner, ProcessSpec};
use draggy_engine::cpu_topology::{
    CpuTopology, from_counts, linux_topology, parse_cpu_list, windows_topology,
};
use draggy_engine::engine_host::{
    EngineControl, EngineHost, EngineStatus, HostError, LaunchOutcome,
};
use draggy_engine::engine_updater::{
    apply_pending_engine, confirm_engine, cuda_major_in, is_unconfirmed, parse_build,
    rollback_engine, same_family, variant_family,
};
use draggy_engine::failure::{EngineLine, classify_failure, watch_line};
use draggy_engine::hardware_probe::{
    Bench, BenchContext, BenchError, BenchRun, BenchSummary, HardwareProbe, HardwareSpecs, Memory,
    Progress, Space, Timings, build_drives, is_fresh, parse_disk_enum, parse_mounted_devices,
    parse_smart_app_control, summarize,
};
use draggy_engine::llama_args::{
    DraftCandidate, HeaderFacts, LaunchInput, ModelTraits, MoeStream, batch_sizes,
    determine_kv_cache, draft_fits, fit_target_mib, moe_stream_args, plan_launch, prompt_cache_mib,
    requested_context,
};
use draggy_engine::llama_draft_stats::{draft_settings, record, record_refusal};
use draggy_engine::llama_output::{Acceptance, failure_reason, parse_acceptance};
use draggy_engine::platform::{Arch, Env, Files, Os, Platform};
use draggy_engine::vram_probe::{largest_qword, parse_nvidia_info};
use draggy_testkit::{cases, files};
use draggy_tools::spawn::CancelToken;
use serde_json::{Map, Value, json};

const NOW: i64 = 1_800_000_000_000;

/// Whole numbers become integers, everything else stays a number, so 4000 and 4000.0 compare equal.
fn canon(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 9.0e15 => {
                Value::from(float as i64)
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(canon).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canon(value)))
                .collect(),
        ),
        other => other,
    }
}

/// Input numbers may be NaN or infinite, which JSON cannot carry, so they arrive as those words.
fn float(value: &Value) -> f64 {
    match value.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => value.as_f64().unwrap_or(f64::NAN),
    }
}

fn int(value: &Value) -> usize {
    value.as_u64().unwrap_or(0) as usize
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}

fn os_of(name: &str) -> Os {
    match name {
        "win32" => Os::Windows,
        "darwin" => Os::MacOs,
        _ => Os::Linux,
    }
}

fn arch_of(name: &str) -> Arch {
    if name == "arm64" {
        Arch::Arm64
    } else {
        Arch::X64
    }
}

fn platform(os: Os, env: &[(&str, &str)]) -> Platform {
    Platform::new(
        os,
        Arch::X64,
        Env::new(env.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))),
    )
}

/// A folder listing: names ending in "/" are folders, others are files with the text "x".
fn materialize(root: &Path, names: &[Value]) {
    for name in names.iter().filter_map(Value::as_str) {
        let target = root.join(name.trim_end_matches('/'));
        if name.ends_with('/') {
            fs::create_dir_all(&target).expect("create folder");
        } else {
            fs::create_dir_all(target.parent().unwrap_or(root)).expect("create parent");
            fs::write(&target, "x").expect("write file");
        }
    }
}

/// A path relative to a base folder, with "." for the base itself.
fn rel(base: &Path, target: &Path) -> String {
    let relative = target
        .strip_prefix(base)
        .unwrap_or(target)
        .to_string_lossy()
        .replace('\\', "/");
    if relative.is_empty() {
        ".".to_owned()
    } else {
        relative
    }
}

/// Replaces the root folder in a path or value with "<root>", as the TypeScript runner does.
fn scrub(text: &str, root: &Path) -> String {
    text.replace(&root.to_string_lossy().into_owned(), "<root>")
}

/// Files kept in a map, read as if they sat under `root`.
struct MapFiles {
    root: PathBuf,
    files: BTreeMap<String, String>,
}

impl MapFiles {
    fn key(&self, path: &Path) -> Option<String> {
        Some(
            path.strip_prefix(&self.root)
                .ok()?
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/"),
        )
    }
}

impl Files for MapFiles {
    fn read_text(&self, path: &Path) -> Option<String> {
        self.files.get(&self.key(path)?).cloned()
    }

    fn list_dir(&self, path: &Path) -> Option<Vec<String>> {
        let prefix = format!("{}/", self.key(path)?);
        let names: BTreeSet<String> = self
            .files
            .keys()
            .filter_map(|key| {
                key.strip_prefix(&prefix)
                    .and_then(|rest| rest.split('/').next())
                    .map(str::to_owned)
            })
            .collect();
        if names.is_empty() {
            None
        } else {
            Some(names.into_iter().collect())
        }
    }

    fn exists(&self, path: &Path) -> bool {
        self.key(path).is_some_and(|key| {
            self.files.contains_key(&key)
                || self.files.keys().any(|k| k.starts_with(&format!("{key}/")))
        })
    }
}

/// The probe's registry answers, keyed by what the query asked for.
struct ProbeRunner {
    mounted: String,
    disks: String,
    sac: String,
}

impl CommandRunner for ProbeRunner {
    async fn run(&self, spec: ProcessSpec) -> Option<CommandOutput> {
        let key = spec.args.get(1).map_or("", String::as_str);
        let stdout = if key.ends_with("MountedDevices") {
            self.mounted.clone()
        } else if key.ends_with("disk\\Enum") {
            self.disks.clone()
        } else {
            format!(
                "    VerifiedAndReputablePolicyState    REG_DWORD    {}",
                self.sac
            )
        };
        Some(CommandOutput {
            success: true,
            stdout,
            stderr: String::new(),
        })
    }
}

/// A benchmark whose write does nothing and whose measurement is fixed, like the TypeScript fakes.
struct FakeBench {
    summary: BenchSummary,
}

impl Bench for FakeBench {
    fn write_temp(
        &self,
        _file: &Path,
        _size: u64,
        _cancel: &CancelToken,
    ) -> Result<(), BenchError> {
        Ok(())
    }

    fn measure(
        &self,
        _file: &Path,
        _size: u64,
        _cancel: &CancelToken,
        _ctx: &BenchContext<'_>,
    ) -> Result<BenchSummary, BenchError> {
        Ok(self.summary)
    }
}

fn summary_of(value: &Value) -> BenchSummary {
    BenchSummary {
        seq_mbps: float(&value["seqMBps"]),
        expert_mbps: float(&value["expertMBps"]),
        rand_4k_mbps: float(&value["rand4kMBps"]),
        rand_4k_iops: float(&value["rand4kIops"]),
        unbuffered: value["unbuffered"].as_bool().unwrap_or(false),
    }
}

fn space_map(value: &Value) -> impl Fn(&str) -> Option<Space> + Sync + '_ {
    move |volume: &str| {
        let entry = value.get(volume)?;
        Some(Space {
            size_bytes: float(&entry["sizeBytes"]) as u64,
            free_bytes: float(&entry["freeBytes"]) as u64,
        })
    }
}

fn run_cpu(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or("") {
        "fromCounts" => json!(from_counts(int(&input["logical"]), int(&input["physical"]))),
        "parseCpuList" => json!(parse_cpu_list(&text(&input["text"]))),
        "windowsTopology" => {
            let model = input["model"].as_str().unwrap_or("");
            topology_json(windows_topology(model, int(&input["logical"])))
        }
        "linuxTopology" => {
            let root = PathBuf::from("/fixture-root");
            let map = input["files"]
                .as_object()
                .map_or_else(BTreeMap::new, |object| {
                    object
                        .iter()
                        .map(|(key, value)| (key.clone(), text(value)))
                        .collect()
                });
            topology_json(linux_topology(
                &MapFiles {
                    root: root.clone(),
                    files: map,
                },
                &root,
            ))
        }
        other => panic!("unknown cpu op {other}"),
    }
}

fn topology_json(topology: Option<CpuTopology>) -> Value {
    topology.map_or(
        Value::Null,
        |t| json!({"logical": t.logical, "physical": t.physical, "performance": t.performance}),
    )
}

fn run_registry(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or("") {
        "mountedDevices" => Value::Array(
            parse_mounted_devices(&text(&input["text"]))
                .into_iter()
                .map(|(letter, usb)| json!({"letter": letter.to_string(), "usb": usb}))
                .collect(),
        ),
        "diskEnum" => Value::Array(
            parse_disk_enum(&text(&input["text"]))
                .into_iter()
                .map(|disk| json!({"index": disk.index, "bus": disk.bus, "name": disk.name, "instance": disk.instance}))
                .collect(),
        ),
        "drives" => {
            let space = space_map(&input["space"]);
            let drives = build_drives(
                &parse_mounted_devices(&text(&input["mounted"])),
                &parse_disk_enum(&text(&input["disks"])),
                &space,
            );
            json!(drives)
        }
        "smartAppControl" => json!(parse_smart_app_control(&text(&input["text"]))),
        other => panic!("unknown registry op {other}"),
    }
}

fn run_bench(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or("") {
        "summarize" => json!(summarize(Timings {
            seq_bytes: float(&input["seqBytes"]),
            seq_ms: float(&input["seqMs"]),
            rand_bytes: float(&input["randBytes"]),
            rand_ms: float(&input["randMs"]),
            small_reads: float(&input["smallReads"]),
            small_ms: float(&input["smallMs"]),
            unbuffered: input["unbuffered"].as_bool().unwrap_or(false),
        })),
        "isFresh" => {
            let at = if input["at"].is_null() {
                None
            } else {
                Some(float(&input["at"]))
            };
            json!(is_fresh(at, float(&input["now"])))
        }
        other => panic!("unknown bench op {other}"),
    }
}

/// The probe and the benchmark, as ordered steps. The clock and the cache folder are shared across the steps.
fn run_probe(input: &Value) -> Value {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    runtime.block_on(async {
        let user_data = tempfile::tempdir().expect("temp dir");
        if let Some(cache) = input.get("cache") {
            fs::write(user_data.path().join("disk-bench.json"), cache.to_string())
                .expect("write cache");
        }
        let os = os_of(&text(&input["platform"]));
        let home = input["homedir"].as_str().unwrap_or("/root").to_owned();
        let memory = Memory {
            total_bytes: int(&input["memory"]["totalBytes"]) as u64,
            free_bytes: int(&input["memory"]["freeBytes"]) as u64,
        };
        let specs = input
            .get("specs")
            .filter(|value| !value.is_null())
            .map(|value| HardwareSpecs {
                cpu: value["cpu"].as_str().map(str::to_owned),
                gpu: value["gpu"].as_str().map(str::to_owned),
                vram_gb: float(&value["vram"]),
                unified_memory: value["unifiedMemory"].as_bool().unwrap_or(false),
            });
        let cpu = CpuTopology {
            logical: int(&input["cpu"]["logical"]),
            physical: int(&input["cpu"]["physical"]),
            performance: int(&input["cpu"]["performance"]),
        };
        let runner = ProbeRunner {
            mounted: text(&input["mounted"]),
            disks: text(&input["disks"]),
            sac: input["sac"].as_str().unwrap_or("0x0").to_owned(),
        };
        let space_values = input["space"].clone();
        let volumes = space_map(&space_values);
        let probe = HardwareProbe::new(
            os,
            &home,
            PathBuf::from("reg.exe"),
            user_data.path(),
            &runner,
            &volumes,
        );
        let clock = Cell::new(float(&input["now"]));
        let random = || 0.5;
        let progress = |_: Progress| {};
        let fake = FakeBench {
            summary: summary_of(&input["measure"]),
        };

        let mut results = Vec::new();
        for step in input["steps"].as_array().map_or(&[][..], Vec::as_slice) {
            match step["op"].as_str().unwrap_or("") {
                "probe" => {
                    let report = probe.probe(specs.as_ref(), memory, cpu, clock.get()).await;
                    results.push(serde_json::to_value(report).unwrap_or(Value::Null));
                }
                "bench" => {
                    let now = || clock.get();
                    let ctx = BenchContext {
                        now: &now,
                        random: &random,
                        progress: &progress,
                    };
                    let volume = text(&step["volume"]);
                    let size = float(&step["sizeGB"]);
                    let outcome = probe
                        .run_benchmark(&fake, &volume, size, "fixture", &ctx)
                        .await;
                    results.push(bench_json(outcome));
                }
                "benchmarks" => results.push(Value::Object(probe.benchmarks(clock.get()))),
                "advance" => clock.set(clock.get() + float(&step["ms"])),
                other => panic!("unknown probe step {other}"),
            }
        }
        Value::Array(results)
    })
}

fn bench_json(outcome: BenchRun) -> Value {
    match outcome {
        BenchRun::Done {
            disk_key,
            benchmark,
        } => json!({"ok": true, "diskKey": disk_key, "benchmark": benchmark}),
        BenchRun::Refused(reason) => json!({"ok": false, "error": reason}),
        BenchRun::Cancelled => json!({"ok": false, "error": "cancelled"}),
        BenchRun::Failed(detail) => json!({"ok": false, "error": "failed", "detail": detail}),
    }
}

fn run_video(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or("") {
        "largestQword" => json!(largest_qword(&text(&input["text"]))),
        "nvidiaInfo" => parse_nvidia_info(&text(&input["text"])).map_or(Value::Null, |info| {
            json!({"computeCapability": info.compute_capability, "driverVersion": info.driver_version, "driverMajor": info.driver_major})
        }),
        other => panic!("unknown video op {other}"),
    }
}

fn run_assets(input: &Value) -> Value {
    let platform_name = input["platform"].as_str().unwrap_or("linux");
    match input["op"].as_str().unwrap_or("") {
        "pick" => {
            let assets: Vec<Asset> = input["assets"].as_array().map_or_else(Vec::new, |names| {
                names
                    .iter()
                    .map(|name| Asset {
                        name: text(name),
                        ..Asset::default()
                    })
                    .collect()
            });
            let profile = GpuProfile {
                vram_gb: float(&input["vramGB"]),
                nvidia: input["nvidia"].as_bool().unwrap_or(false),
                cuda13: input["cuda13"].as_bool().unwrap_or(false),
            };
            let picked = pick_release_assets(
                os_of(platform_name),
                arch_of(input["arch"].as_str().unwrap_or("x64")),
                &assets,
                &profile,
            );
            json!({
                "main": picked.main.map(|a| a.name.clone()),
                "extra": picked.extra.map(|a| a.name.clone()),
                "variant": picked.variant,
            })
        }
        "variantOf" => json!(variant_of(&text(&input["name"]))),
        "buildNumber" => json!(build_number(&text(&input["tag"]))),
        "whyPicked" => {
            let profile = GpuProfile {
                vram_gb: float(&input["vramGB"]),
                nvidia: input["nvidia"].as_bool().unwrap_or(false),
                cuda13: input["cuda13"].as_bool().unwrap_or(false),
            };
            json!(why_picked(&profile, input["variant"].as_str()))
        }
        "recommended" => {
            let host = platform(os_of(platform_name), &[]);
            json!(recommended_release_asset(&host, float(&input["vramGB"])))
        }
        "validateUrl" => {
            let policy = Mutex::new(draggy_web::policy::UrlPolicy::new());
            json!(validate_download_url(&text(&input["url"]), &policy))
        }
        other => panic!("unknown asset op {other}"),
    }
}

fn run_gpu_runner(input: &Value) -> Value {
    let root = tempfile::tempdir().expect("temp dir");
    let llama = root.path().join("llama");
    fs::create_dir_all(&llama).expect("create engine folder");
    materialize(
        &llama,
        input["files"].as_array().map_or(&[][..], Vec::as_slice),
    );
    let host = platform(os_of(input["platform"].as_str().unwrap_or("linux")), &[]);
    let vram = float(&input["vramGB"]);
    let nvidia = input["nvidia"].as_bool().unwrap_or(false);
    if input["op"].as_str() == Some("state") {
        let state = engine_state(&host, &llama, vram, nvidia);
        return json!({"present": state.present, "complete": state.complete, "runnerType": state.runner_type});
    }
    let options = RunnerOptions {
        rocm: input["rocm"].as_bool().unwrap_or(false),
    };
    let runner = detect_gpu_runner_with(&host, &llama, vram, nvidia, options);
    json!({
        "runnerDir": rel(&llama, &runner.runner_dir),
        "backendDll": runner.backend_dll.as_ref().map(|dll| rel(&llama, dll)),
        "runnerType": runner.runner_type,
    })
}

fn run_environment(input: &Value) -> Value {
    let root = tempfile::tempdir().expect("temp dir");
    let llama = root.path().join("bin").join("llama");
    fs::create_dir_all(&llama).expect("create engine folder");
    materialize(
        &llama,
        input["files"].as_array().map_or(&[][..], Vec::as_slice),
    );
    materialize(
        root.path(),
        input["explicitFiles"]
            .as_array()
            .map_or(&[][..], Vec::as_slice),
    );
    let path = input["path"].as_str().unwrap_or("");
    let ld = input["ldLibraryPath"].as_str().unwrap_or("");
    let host = platform(
        os_of(input["platform"].as_str().unwrap_or("linux")),
        &[("PATH", path), ("LD_LIBRARY_PATH", ld)],
    );
    let explicit = input["explicit"]
        .as_str()
        .map(|name| root.path().join(name));
    let vram = float(&input["vramGB"]);
    let nvidia = input["nvidia"].as_bool().unwrap_or(false);
    let engine = engine_environment(&host, root.path(), vram, explicit.as_deref(), nvidia);
    let env: Map<String, Value> = engine
        .env
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(scrub(value, root.path()))))
        .collect();
    json!({
        "env": env,
        "runnerDir": rel(root.path(), &engine.runner_dir),
        "runnerType": engine.runner_type,
        "binaryPath": engine.binary_path.as_ref().map(|path| rel(root.path(), path)),
    })
}

/// Writes a tree of text files; names with "llama-server" are written as this host names the server.
fn write_tree(root: &Path, tree: &Map<String, Value>) {
    for (name, content) in tree {
        let target = root.join(name);
        fs::create_dir_all(target.parent().unwrap_or(root)).expect("create parent");
        fs::write(target, text(content)).expect("write file");
    }
}

/// Every file under the root: engine.json is parsed and its install time dropped; other files are text.
fn read_tree(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let key = rel(root, &path);
            let body = fs::read_to_string(&path).unwrap_or_default();
            if path.file_name().and_then(|n| n.to_str()) == Some("engine.json") {
                let mut meta: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                if let Some(object) = meta.as_object_mut() {
                    object.remove("installedAt");
                }
                out.insert(key, meta);
            } else {
                out.insert(key, Value::from(body));
            }
        }
    }
    out
}

fn run_updater(input: &Value) -> Value {
    let op = input["op"].as_str().unwrap_or("");
    match op {
        "variantFamily" => json!(variant_family(&text(&input["variant"]))),
        "sameFamily" => json!(same_family(
            &text(&input["installed"]),
            &text(&input["wanted"])
        )),
        "parseBuild" => json!(parse_build(&text(&input["output"]))),
        "cudaMajor" => {
            let dir = tempfile::tempdir().expect("temp dir");
            materialize(
                dir.path(),
                input["files"].as_array().map_or(&[][..], Vec::as_slice),
            );
            json!(cuda_major_in(dir.path()))
        }
        "steps" => {
            let root = tempfile::tempdir().expect("temp dir");
            let tree = input["files"].as_object().cloned().unwrap_or_default();
            write_tree(root.path(), &tree);
            let host = platform(Os::Linux, &[]);
            let results: Vec<Value> = input["steps"]
                .as_array()
                .map_or(&[][..], Vec::as_slice)
                .iter()
                .map(|step| match step["op"].as_str().unwrap_or("") {
                    "apply" => {
                        let outcome = apply_pending_engine(&host, root.path(), NOW);
                        let mut out = Map::new();
                        out.insert("applied".to_owned(), Value::from(outcome.applied));
                        if let Some(tag) = outcome.tag {
                            out.insert("tag".to_owned(), Value::from(tag));
                        }
                        if let Some(error) = outcome.error {
                            out.insert("error".to_owned(), Value::from(error));
                        }
                        Value::Object(out)
                    }
                    "confirm" => json!(confirm_engine(&host, root.path())),
                    "rollback" => {
                        let outcome = rollback_engine(&host, root.path());
                        let mut out = Map::new();
                        out.insert("rolledBack".to_owned(), Value::from(outcome.rolled_back));
                        if let Some(tag) = outcome.tag {
                            out.insert("tag".to_owned(), Value::from(tag));
                        }
                        if let Some(error) = outcome.error {
                            out.insert("error".to_owned(), Value::from(error));
                        }
                        Value::Object(out)
                    }
                    "unconfirmed" => json!(is_unconfirmed(&host, root.path())),
                    other => panic!("unknown updater step {other}"),
                })
                .collect();
            json!({"results": results, "tree": Value::Object(read_tree(root.path()))})
        }
        other => panic!("unknown updater op {other}"),
    }
}

/// The host's two engines, shared with the launch closures so a launch can start one.
#[derive(Default)]
struct Engine {
    running: Cell<bool>,
    stops: Cell<u32>,
}

#[derive(Clone)]
struct FakeEngine(Rc<Engine>);

impl EngineControl for FakeEngine {
    fn stop_sync(&self) {
        self.0.stops.set(self.0.stops.get() + 1);
        self.0.running.set(false);
    }

    fn status(&self) -> EngineStatus {
        let running = self.0.running.get();
        EngineStatus {
            running,
            port: running.then_some(1),
            model: running.then(|| "m".to_owned()),
        }
    }
}

fn run_host(input: &Value) -> Value {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    runtime.block_on(async {
        let llama = Rc::new(Engine::default());
        let colibri = Rc::new(Engine::default());
        let mut host = EngineHost::new(FakeEngine(llama.clone()), FakeEngine(colibri.clone()));
        let mut results = Vec::new();
        for step in input["steps"].as_array().map_or(&[][..], Vec::as_slice) {
            match step["op"].as_str().unwrap_or("") {
                "start" => {
                    let kind = text(&step["kind"]);
                    let outcome = text(&step["outcome"]);
                    let detail = step["detail"].as_str().map(str::to_owned);
                    let message = text(&step["message"]);
                    let target = if kind == "colibri" { colibri.clone() } else { llama.clone() };
                    let launch = || async move {
                        match outcome.as_str() {
                            "throw" => Err(message),
                            "success" => {
                                target.running.set(true);
                                Ok(LaunchOutcome { success: true, detail: None })
                            }
                            _ => Ok(LaunchOutcome { success: false, detail }),
                        }
                    };
                    results.push(match host.start(&kind, launch).await {
                        Ok(outcome) => json!({"success": outcome.success, "kind": outcome.detail}),
                        Err(error @ (HostError::UnknownEngine(_) | HostError::Launch(_))) => json!({"error": error.to_string()}),
                    });
                }
                "stop" => {
                    host.stop();
                    results.push(Value::Null);
                }
                "status" => {
                    let status = host.status();
                    results.push(json!({"kind": status.kind, "running": status.running, "port": status.port, "model": status.model}));
                }
                "state" => results.push(json!({
                    "active": host.active(),
                    "stops": {"llamacpp": llama.stops.get(), "colibri": colibri.stops.get()},
                })),
                other => panic!("unknown host step {other}"),
            }
        }
        Value::Array(results)
    })
}

fn run_output(input: &Value) -> Value {
    match watch_line(
        &text(&input["line"]),
        input["moe"].as_bool().unwrap_or(false),
    ) {
        None => Value::Null,
        Some(EngineLine::LowOffload { layers, total }) => {
            json!({"kind": "lowOffload", "layers": layers, "total": total})
        }
        Some(EngineLine::PromptEvaluated { ms, tokens }) => {
            json!({"kind": "promptEvaluated", "ms": ms, "tokens": tokens})
        }
        Some(EngineLine::PromptCacheReused {
            how,
            similarity,
            kept,
        }) => {
            json!({"kind": "promptCacheReused", "how": how, "similarity": similarity, "kept": kept})
        }
    }
}

/// The placeholder the fixtures write for the temp folder; the TS runner replaces the folder with it the same way.
const TEMP_DIR: &str = "<dir>";

fn positive(value: &Value) -> Option<f64> {
    value.as_f64().filter(|number| *number > 0.0)
}

/// The GGUF facts a fixture header names; a null header is a file that does not parse.
fn header_facts(value: &Value) -> Option<HeaderFacts> {
    if value.is_null() {
        return None;
    }
    let field = |key: &str| positive(&value[key]);
    Some(HeaderFacts {
        expert_count: field("expertCount").unwrap_or(0.0),
        context_length: field("contextLength"),
        block_count: field("blockCount"),
        head_count_kv: field("headCountKv"),
        key_length: field("keyLength"),
        value_length: field("valueLength"),
        mtp: field("nextnPredictLayers").is_some(),
    })
}

fn moe_stream_of(value: &Value) -> Option<MoeStream> {
    if value.is_null() {
        return None;
    }
    Some(MoeStream {
        cache_gb: float(&value["cacheGB"]),
        io_threads: value["ioThreads"].as_i64(),
        direct: value["direct"].as_bool().unwrap_or(false),
        vram_slots: float(&value["vramSlots"]),
    })
}

/// One launch's argument list, with the port the TS runner names by placeholder.
fn run_llama_args(input: &Value) -> Value {
    let model = format!("{TEMP_DIR}/seer.gguf");
    let traits = ModelTraits::from_facts(header_facts(&input["header"]).as_ref(), "seer.gguf");
    let draft_path = format!("{TEMP_DIR}/seer-draft.gguf");
    let draft =
        (!input["draft"].is_null() && !input["skipDraft"].as_bool().unwrap_or(false)).then(|| {
            DraftCandidate {
                path: &draft_path,
                bytes: input["draft"]["bytes"].as_u64(),
                max: Some(8),
            }
        });
    let projector_path = format!("{TEMP_DIR}/seer-mmproj.gguf");
    let projector = (input["projector"].as_bool().unwrap_or(false)
        && !input["skipProjector"].as_bool().unwrap_or(false))
    .then_some(projector_path.as_str());
    let stream = moe_stream_of(&input["moeStream"]);
    let flags: BTreeSet<String> = input["flags"]
        .as_array()
        .map_or_else(BTreeSet::new, |items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        });
    let topology = CpuTopology {
        logical: int(&input["topology"]["logical"]),
        physical: int(&input["topology"]["physical"]),
        performance: int(&input["topology"]["performance"]),
    };
    let runner = input["runnerType"].as_str();
    let windows = input["windows"].as_bool().unwrap_or(false);
    let plan = plan_launch(
        &LaunchInput {
            model: &model,
            model_bytes: input["modelBytes"].as_u64(),
            traits: &traits,
            context: requested_context(input["contextSize"].as_u64(), None, None),
            exact_context: input["exactContext"].as_bool().unwrap_or(false),
            vram_gb: float(&input["vramGB"]),
            windows,
            runner,
            port: 1,
            gpu_layers: input["gpuLayers"].as_i64(),
            requested_threads: input["threads"].as_i64(),
            topology,
            total_ram_bytes: input["totalRamBytes"].as_u64().unwrap_or(0),
            speculative: input["speculative"].as_bool().unwrap_or(true),
            draft,
            moe_stream: stream.as_ref(),
            projector,
        },
        &|flag: &str| flags.contains(flag),
    );
    let mut args = plan.args;
    if let Some(at) = args.iter().position(|arg| arg == "--port") {
        args[at + 1] = "<port>".to_owned();
    }
    json!({
        "args": args,
        "contextSize": plan.context,
        "speculation": plan.speculation.as_str(),
    })
}

fn run_llama_kv(input: &Value) -> Value {
    let traits = ModelTraits {
        moe: input["traits"]["moe"].as_bool().unwrap_or(false),
        trained_context: input["traits"]["trainedContext"].as_u64(),
        kv_bytes_q8: input["traits"]["kvBytesQ8"].as_f64(),
        mtp: false,
    };
    let plan = determine_kv_cache(
        input["modelBytes"].as_u64(),
        input["contextSize"].as_u64().unwrap_or(0),
        float(&input["vramGB"]),
        &traits,
        input["traits"]["exact"].as_bool().unwrap_or(false),
        input["traits"]["runnerType"].as_str(),
    );
    json!({"cacheType": plan.cache_type, "effectiveContext": plan.effective_context})
}

fn run_llama_sizing(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "batch" => {
            let (batch, ubatch) = batch_sizes(
                input["runnerType"].as_str(),
                float(&input["vramGB"]),
                input["moe"].as_bool().unwrap_or(false),
            );
            json!({"batch": batch, "ubatch": ubatch})
        }
        "fitTarget" => json!({
            "fitTargetMiB": fit_target_mib(
                float(&input["vramGB"]),
                input["windows"].as_bool().unwrap_or(false),
            ),
        }),
        "promptCache" => json!({
            "promptCacheMiB": prompt_cache_mib(
                input["modelBytes"].as_u64(),
                input["totalRamBytes"].as_u64().unwrap_or(0),
            ),
        }),
        "draftFits" => json!({
            "fits": draft_fits(
                input["modelBytes"].as_u64(),
                input["draftBytes"].as_u64(),
                float(&input["vramGB"]),
                input["moe"].as_bool().unwrap_or(false),
            ),
        }),
        "moeStream" => {
            let flags: BTreeSet<String> =
                input["flags"]
                    .as_array()
                    .map_or_else(BTreeSet::new, |items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(str::to_owned))
                            .collect()
                    });
            let stream = moe_stream_of(&input["stream"]);
            json!({"args": moe_stream_args(&|flag: &str| flags.contains(flag), stream.as_ref())})
        }
        other => panic!("no sizing rule {other}"),
    }
}

fn run_acceptance(input: &Value) -> Value {
    match parse_acceptance(&text(&input["line"])) {
        Some(sample) => json!({
            "rate": sample.rate,
            "accepted": sample.accepted,
            "generated": sample.generated,
        }),
        None => Value::Null,
    }
}

fn run_failure_reason(input: &Value) -> Value {
    let lines: Vec<String> = input["lines"].as_array().map_or_else(Vec::new, |items| {
        items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect()
    });
    json!(failure_reason(&lines))
}

/// Replays the replies and refusals against a folder that starts as the file a previous run left, then reads the settings
/// and the file, as the reference's `draftStats` fixture runner does.
fn run_draft_stats(input: &Value) -> Value {
    let dir = tempfile::tempdir().expect("temp dir");
    let stats = dir.path().join("draft-stats.json");
    if !input["initial"].is_null() {
        fs::write(&stats, input["initial"].to_string()).expect("initial stats");
    }
    for step in input["ops"].as_array().map_or(&[][..], Vec::as_slice) {
        let model = PathBuf::from(text(&step["model"]));
        match step["op"].as_str().unwrap_or_default() {
            "record" => record(
                dir.path(),
                &model,
                Acceptance {
                    rate: float(&step["rate"]),
                    accepted: int(&step["accepted"]) as u64,
                    generated: int(&step["generated"]) as u64,
                },
            ),
            _ => record_refusal(dir.path(), &model),
        }
    }
    let settings = draft_settings(Some(dir.path()), Path::new(&text(&input["model"])));
    let stored = fs::read_to_string(&stats)
        .ok()
        .and_then(|saved| serde_json::from_str::<Value>(&saved).ok());
    json!({
        "settings": { "enabled": settings.enabled, "max": settings.max, "rate": settings.rate },
        "stored": stored,
    })
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "cpu-topology.json" => run_cpu(input),
        "hardware-registry.json" => run_registry(input),
        "hardware-probe.json" => run_probe(input),
        "hardware-bench.json" => run_bench(input),
        "video-memory.json" => run_video(input),
        "binary-assets.json" => run_assets(input),
        "gpu-runner.json" => run_gpu_runner(input),
        "engine-environment.json" => run_environment(input),
        "engine-updater.json" => run_updater(input),
        "engine-host.json" => run_host(input),
        "failure.json" => json!(classify_failure(
            &input["lines"]
                .as_array()
                .map_or_else(Vec::new, |lines| lines
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>())
        )),
        "engine-output.json" => run_output(input),
        "engine-llama-args.json" => run_llama_args(input),
        "engine-llama-kv.json" => run_llama_kv(input),
        "engine-llama-sizing.json" => run_llama_sizing(input),
        "engine-llama-acceptance.json" => run_acceptance(input),
        "engine-llama-failure-reason.json" => run_failure_reason(input),
        "engine-draft-stats.json" => run_draft_stats(input),
        other => panic!("no runner for {other}"),
    }
}

/// A canonical value with Windows' backslash separators read as slashes, on both sides of a comparison.
fn neutral(value: Value) -> Value {
    let slash = char::from(92u8);
    let text = value.to_string().replace(&format!("{slash}{slash}"), "/");
    serde_json::from_str(&text).expect("a replaced JSON text parses")
}

#[test]
fn fixtures_match_the_typescript_reference() {
    let mut failures = Vec::new();
    let mut ran = 0;
    for file in files("engine") {
        for case in cases("engine", &file) {
            let name = case["name"].as_str().unwrap_or("").to_owned();
            let actual = neutral(canon(run(&file, &case["input"])));
            let expected = neutral(canon(case["expected"].clone()));
            ran += 1;
            if actual != expected {
                failures.push(format!(
                    "{file} / {name}\n  expected {expected}\n  actual   {actual}"
                ));
            }
        }
    }
    assert!(ran > 0, "no engine fixtures ran");
    assert!(
        failures.is_empty(),
        "{} of {ran} engine fixtures differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn runner_table_matches_the_shared_fixture() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../shared/fixtures/runner-table.json");
    let fixture: Value = serde_json::from_str(&fs::read_to_string(path).expect("runner-table.json reads"))
        .expect("runner-table.json parses");
    let column = |spec: &Option<RunnerSpec>| match spec {
        Some(spec) => json!({"folders": spec.folders, "marker": spec.marker}),
        None => Value::Null,
    };
    let actual: Vec<Value> = RUNNER_TABLE
        .iter()
        .map(|row| {
            json!({
                "runnerType": row.runner_type,
                "needsNvidia": row.needs_nvidia,
                "rocm": row.rocm,
                "windows": column(&row.windows),
                "linux": column(&row.linux),
            })
        })
        .collect();
    assert_eq!(Value::Array(actual), fixture["rows"]);
}
