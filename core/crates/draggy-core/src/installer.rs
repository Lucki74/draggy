//! Gets `llama-server` onto the machine: downloads the prebuilt llama.cpp release for this OS into the app's data
//! folder, unpacks it and reports where the binary is.
//!
//! Choosing the release asset, the checksum, the staging folder and the swap live in `draggy-engine`. This file
//! supplies the real network client and tar, and flattens the result for the boundary.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_engine::binary_manager::{
    BinaryError, DownloadProgress, Downloader, SetupOutcome, TarExtractor, Toolkit,
    ensure_engine_ready,
};
use draggy_engine::command::ProcessRunner;
use draggy_engine::platform::{Arch, Env, Os, Platform};
use draggy_web::policy::UrlPolicy;

use crate::error::CoreError;

const USER_AGENT: &str = concat!("Draggy/", env!("CARGO_PKG_VERSION"));

/// How far the engine download is.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct InstallProgressRecord {
    pub percent: f64,
    pub completed: u64,
    pub total: u64,
    /// What is happening, such as `download` or `unpack`.
    pub phase: String,
    pub label: String,
}

/// Implemented by the shell. Called from the install's own thread.
#[uniffi::export(with_foreign)]
pub trait InstallObserver: Send + Sync {
    fn on_progress(&self, progress: InstallProgressRecord);
}

/// An engine that is installed and ready to start.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct InstalledEngineRecord {
    pub binary_path: String,
    /// The GPU backend it runs on, such as `metal` or `cpu`.
    pub runner_type: String,
}

/// [`Downloader`] over reqwest.
pub struct NetDownloader {
    client: reqwest::Client,
}

impl NetDownloader {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self { client })
    }
}

fn transfer(error: impl std::fmt::Display) -> BinaryError {
    BinaryError::Transfer(error.to_string())
}

impl Downloader for NetDownloader {
    async fn get_text(&self, url: &str, accept: Option<&str>) -> Result<String, BinaryError> {
        let mut request = self.client.get(url).timeout(Duration::from_secs(60));
        if let Some(accept) = accept {
            request = request.header(reqwest::header::ACCEPT, accept);
        }
        let response = request.send().await.map_err(transfer)?;
        let status = response.status();
        if !status.is_success() {
            return Err(BinaryError::Transfer(format!(
                "the server answered {status}"
            )));
        }
        response.text().await.map_err(transfer)
    }

    async fn download(
        &self,
        url: &str,
        dest: &Path,
        on_bytes: &(dyn Fn(u64) + Sync),
    ) -> Result<(), BinaryError> {
        let mut response = self.client.get(url).send().await.map_err(transfer)?;
        let status = response.status();
        if !status.is_success() {
            return Err(BinaryError::Transfer(format!(
                "the server answered {status}"
            )));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(dest)?;
        while let Some(chunk) = response.chunk().await.map_err(transfer)? {
            file.write_all(&chunk)?;
            on_bytes(chunk.len() as u64);
        }
        file.flush()?;
        Ok(())
    }
}

/// Sets the `gpu.rocm` choice: when on, an AMD card takes the ROCm build ahead of Vulkan. Off by default.
#[uniffi::export]
pub fn set_gpu_rocm(enabled: bool) {
    draggy_engine::binary_manager::set_runner_options(
        draggy_engine::binary_manager::RunnerOptions { rocm: enabled },
    );
}

/// The engine a model of `format` ("gguf" or "mlx") runs on here: "llamacpp" or "mlx". An MLX model on a machine that
/// is not an Apple silicon Mac is refused, and never falls back to llama.cpp.
#[uniffi::export]
pub fn engine_for_model_format(format: String) -> Result<String, crate::error::CoreError> {
    let platform = host_platform();
    draggy_engine::engine_host::engine_for_format(&format, platform.os, platform.arch)
        .map(str::to_owned)
        .map_err(|error| crate::error::CoreError::Engine {
            message: error.to_string(),
        })
}

/// Whether this machine can run MLX models.
#[uniffi::export]
pub fn mlx_supported() -> bool {
    let platform = host_platform();
    draggy_engine::mlx_runtime::supported(platform.os, platform.arch)
}

fn host_platform() -> Platform {
    let os = if cfg!(target_os = "macos") {
        Os::MacOs
    } else if cfg!(target_os = "windows") {
        Os::Windows
    } else {
        Os::Linux
    };
    let arch = if cfg!(target_arch = "aarch64") {
        Arch::Arm64
    } else {
        Arch::X64
    };
    Platform::new(os, arch, Env::new(std::env::vars()))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn engine_error(message: impl Into<String>) -> CoreError {
    CoreError::Engine {
        message: message.into(),
    }
}

#[derive(uniffi::Object)]
pub struct EngineInstaller {
    user_data: PathBuf,
    downloader: NetDownloader,
    policy: Mutex<UrlPolicy>,
}

#[uniffi::export(async_runtime = "tokio")]
impl EngineInstaller {
    /// `user_data` is the app's data folder; the engine goes in `bin/llama` inside it.
    #[uniffi::constructor]
    pub fn new(user_data: String) -> Result<Self, CoreError> {
        let downloader = NetDownloader::new().map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?;
        Ok(Self {
            user_data: PathBuf::from(user_data),
            downloader,
            policy: Mutex::new(UrlPolicy::new()),
        })
    }

    /// The installed engine, or None when there is none yet.
    pub fn installed(&self) -> Option<InstalledEngineRecord> {
        let platform = host_platform();
        let binary = platform
            .engine_dir(&self.user_data)
            .join(platform.server_name());
        binary.is_file().then(|| InstalledEngineRecord {
            binary_path: binary.to_string_lossy().into_owned(),
            runner_type: String::new(),
        })
    }

    /// Makes sure an engine is installed, downloading the llama.cpp release when it is not. `gpu_memory_gb` picks the
    /// build; 0 asks for the CPU one.
    pub async fn install(
        &self,
        gpu_memory_gb: f64,
        observer: Arc<dyn InstallObserver>,
    ) -> Result<InstalledEngineRecord, CoreError> {
        let platform = host_platform();
        let runner = ProcessRunner;
        let extractor = TarExtractor::for_platform(&runner, &platform);
        let clock = now_ms;
        let kit = Toolkit {
            runner: &runner,
            downloader: &self.downloader,
            extractor: &extractor,
            policy: &self.policy,
            clock: &clock,
        };
        let report = move |progress: DownloadProgress| {
            observer.on_progress(InstallProgressRecord {
                percent: progress.percent,
                completed: progress.completed,
                total: progress.total,
                phase: progress.phase.to_owned(),
                label: progress.label.to_owned(),
            });
        };
        match ensure_engine_ready(
            &kit,
            &platform,
            &self.user_data,
            gpu_memory_gb,
            false,
            &report,
        )
        .await
        {
            SetupOutcome::Ready {
                binary_path,
                runner_type,
            } => Ok(InstalledEngineRecord {
                binary_path: binary_path.to_string_lossy().into_owned(),
                runner_type: runner_type.to_owned(),
            }),
            SetupOutcome::NotReady { error } => Err(engine_error(error)),
        }
    }
}
