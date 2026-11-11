//! Engine processes, binaries and hardware probes shared by the engine IPC modules.
//!
//! Child processes start through core: `draggy_tools::spawn` sets CREATE_NO_WINDOW, so no extra spawn helper is needed
//! here. Engines bind 127.0.0.1 only, and nothing downloads until the renderer asks.

pub mod load_stage;
pub mod net;
pub mod sysinfo;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use draggy_engine::command::ProcessRunner;
use draggy_engine::cpu_topology::{self, CpuTopology};
use draggy_engine::hardware_probe::{HardwareProbe, HardwareSpecs, Space};
use draggy_engine::llama_health::{HttpProbe, SystemClock};
use draggy_engine::llama_process::{Host, LlamaSupervisor};
use draggy_engine::platform::{Arch, DiskFiles, Env, Os, Platform};
use draggy_engine::vram_probe::{VideoHost, detect_video_memory_gb};
use draggy_models::download::{Downloader, ReqwestClient, SystemEnv};
use draggy_models::mmproj::Projectors;
use draggy_models::model_storage::CapabilityCache;
use draggy_web::policy::UrlPolicy;
use serde_json::{Value, json};
use tokio::sync::OnceCell;

pub type Llama = LlamaSupervisor<HttpProbe, SystemClock, ProcessRunner>;
type VolumeFn = fn(&str) -> Option<Space>;

static RUNNER: ProcessRunner = ProcessRunner;
static VOLUMES: VolumeFn = sysinfo::volume_space;

/// Cached answer of `get-system-specs`, plus the typed part the hardware report reads.
struct Specs {
    value: Value,
    typed: HardwareSpecs,
}

/// Everything long-lived the engine channels share. Built once with the data folder.
pub struct Engines {
    pub user_data: PathBuf,
    pub models_dir: PathBuf,
    llama: OnceCell<Arc<Llama>>,
    specs: OnceCell<Specs>,
    topology: OnceCell<CpuTopology>,
    pub probe: HardwareProbe<'static, ProcessRunner, VolumeFn>,
    pub models_dl: Option<Downloader<ReqwestClient, SystemEnv>>,
    pub net: Option<net::NetDownloader>,
    pub policy: Mutex<UrlPolicy>,
    pub projectors: Mutex<Projectors>,
    pub capabilities: Mutex<CapabilityCache>,
}

pub fn host_platform() -> Platform {
    let arch = if cfg!(target_arch = "aarch64") {
        Arch::Arm64
    } else {
        Arch::X64
    };
    let os = if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::MacOs
    } else {
        Os::Linux
    };
    Platform::new(os, arch, Env::new(std::env::vars()))
}

/// Milliseconds since the epoch, as the benchmark cache and engine metadata count them.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

impl Engines {
    pub fn new(user_data: &Path) -> Self {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let platform = host_platform();
        let probe = HardwareProbe::new(
            platform.os,
            &home,
            sysinfo::reg_exe(),
            user_data,
            &RUNNER,
            &VOLUMES,
        );
        Self {
            user_data: user_data.to_path_buf(),
            models_dir: user_data.join("models"),
            llama: OnceCell::new(),
            specs: OnceCell::new(),
            topology: OnceCell::new(),
            probe,
            models_dl: ReqwestClient::new()
                .ok()
                .map(|client| Downloader::new(client, SystemEnv)),
            net: net::NetDownloader::new().ok(),
            policy: Mutex::new(UrlPolicy::new()),
            projectors: Mutex::new(Projectors::new()),
            capabilities: Mutex::new(CapabilityCache::default()),
        }
    }

    pub async fn topology(&self) -> CpuTopology {
        *self
            .topology
            .get_or_init(|| async {
                let model = sysinfo::cpu_model().await;
                cpu_topology::detect(
                    host_platform().os,
                    &RUNNER,
                    &DiskFiles,
                    &model,
                    sysinfo::logical_cpus(),
                )
                .await
            })
            .await
    }

    /// The llama.cpp supervisor, created on first use because it needs the CPU topology.
    pub async fn llama(&self) -> Arc<Llama> {
        let topology = self.topology().await;
        Arc::clone(
            self.llama
                .get_or_init(|| async {
                    let host = Host {
                        os: host_platform().os,
                        topology,
                        total_ram_bytes: sysinfo::memory().total_bytes,
                        inherited_env: std::env::vars().collect(),
                    };
                    Arc::new(LlamaSupervisor::new(
                        HttpProbe,
                        SystemClock::new(),
                        RUNNER,
                        host,
                    ))
                })
                .await,
        )
    }

    async fn specs_cell(&self) -> &Specs {
        self.specs
            .get_or_init(|| async {
                let cpu = sysinfo::cpu_model().await;
                let memory = sysinfo::memory();
                let platform = host_platform();
                let host = VideoHost {
                    os: platform.os,
                    arch: platform.arch,
                    total_memory_bytes: memory.total_bytes,
                    system_root: PathBuf::from(
                        std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
                    ),
                };
                let vram = detect_video_memory_gb(&host, &RUNNER, &DiskFiles).await;
                let gpu = sysinfo::gpu_name().await;
                let ram = to_fixed1(memory.total_bytes as f64 / 1024_f64.powi(3));
                let vram = to_fixed1(vram);
                let arch = if cfg!(target_arch = "aarch64") {
                    "arm64"
                } else {
                    "x64"
                };
                Specs {
                    value: json!({
                        "cpu": cpu,
                        "ram": ram,
                        "vram": vram,
                        "gpu": gpu,
                        "platform": "win32",
                        "arch": arch,
                    }),
                    typed: HardwareSpecs {
                        cpu: Some(cpu),
                        gpu,
                        vram_gb: vram,
                        unified_memory: false,
                    },
                }
            })
            .await
    }

    /// The `get-system-specs` value and the VRAM in GB.
    pub async fn specs(&self) -> (Value, f64) {
        let cell = self.specs_cell().await;
        (cell.value.clone(), cell.typed.vram_gb)
    }

    pub async fn hardware_specs(&self) -> HardwareSpecs {
        self.specs_cell().await.typed.clone()
    }

    /// Stops every engine child process; the exit hook calls it.
    pub async fn shutdown(&self) {
        if let Some(llama) = self.llama.get() {
            llama.stop().await;
        }
    }
}

/// `Number(x.toFixed(1))`.
pub fn to_fixed1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// A poisoned lock still holds usable data here: nothing under these mutexes can be left half-written.
pub fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
