//! The model library as the shells drive it: search the hub, download a model, list and delete what is on disk.
//!
//! Resolving names, the url policy, resuming, retries and the file layout live in `draggy-models`. This file wires
//! the real HTTP client and clock in and flattens the results for the boundary.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use draggy_models::download::{
    DownloadError, DownloadRequest, Downloader, Phase, Progress, ReqwestClient, SystemEnv,
};
use draggy_models::huggingface::{HuggingFace, LibraryModel};
use draggy_models::mlx_files::list_mlx_models;
use draggy_models::mmproj::Projectors;
use draggy_models::model_storage::{CapabilityCache, delete_gguf_model, list_gguf_models};

use crate::error::CoreError;

/// A model the hub offers.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct LibraryModelRecord {
    /// The name to show, such as `qwen3`.
    pub name: String,
    /// What to download with a size tag after a colon: the hub repository, or a curated model's name.
    pub reference: String,
    pub description: String,
    pub capabilities: Vec<String>,
    /// The sizes offered, as the hub words them.
    pub sizes: Vec<String>,
}

/// A hub result as the shells see it. A hub model downloads by its repository, as Windows does.
fn record_of(model: LibraryModel) -> LibraryModelRecord {
    LibraryModelRecord {
        reference: model.repo.clone().unwrap_or_else(|| model.name.clone()),
        name: model.name,
        description: model.description,
        capabilities: model.capabilities,
        sizes: model.sizes,
    }
}

/// A model file on disk.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct InstalledModelRecord {
    pub filename: String,
    pub path: String,
    pub bytes: u64,
    pub capabilities: Vec<String>,
    /// `gguf` or `mlx`. The format decides the engine.
    pub format: String,
}

/// How far a download is. A model made of several files reports one running total.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct DownloadProgressRecord {
    pub filename: String,
    pub completed: u64,
    pub total: u64,
    pub percent: f64,
    pub remaining_seconds: Option<u64>,
}

/// Implemented by the shell. Called from the download's own thread, a few times a second.
#[uniffi::export(with_foreign)]
pub trait DownloadObserver: Send + Sync {
    fn on_progress(&self, progress: DownloadProgressRecord);
}

#[derive(uniffi::Object)]
pub struct ModelLibrary {
    models_dir: PathBuf,
    hub: HuggingFace<ReqwestClient>,
    downloader: Downloader<ReqwestClient, SystemEnv>,
    cache: Mutex<CapabilityCache>,
    projectors: Mutex<Projectors>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn model_error(message: impl Into<String>) -> CoreError {
    CoreError::Model {
        message: message.into(),
    }
}

fn download_error(error: &DownloadError) -> CoreError {
    match error {
        DownloadError::Cancelled => CoreError::Invalid {
            message: "The download was cancelled.".to_owned(),
        },
        other => model_error(other.to_string()),
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl ModelLibrary {
    /// `models_dir` is where model files live; the first download creates it.
    #[uniffi::constructor]
    pub fn new(models_dir: String) -> Result<Self, CoreError> {
        let client = ReqwestClient::new().map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?;
        Ok(Self {
            models_dir: PathBuf::from(models_dir),
            hub: HuggingFace::new(client.clone()),
            downloader: Downloader::new(client, SystemEnv),
            cache: Mutex::new(CapabilityCache::default()),
            projectors: Mutex::new(Projectors::new()),
        })
    }

    /// Searches the hub. An empty query lists the top models.
    pub async fn search(&self, query: String) -> Vec<LibraryModelRecord> {
        self.hub
            .search(&query, now_ms())
            .await
            .into_iter()
            .map(record_of)
            .collect()
    }

    /// Downloads `reference` (`name` or `name:tag`) with its split parts, resuming a partial file from an earlier try.
    /// Returns the file name to start the engine on.
    pub async fn download(
        &self,
        reference: String,
        observer: Arc<dyn DownloadObserver>,
    ) -> Result<String, CoreError> {
        let plan = self
            .hub
            .resolve_download(&reference, false)
            .await
            .ok_or_else(|| {
                model_error(format!("No downloadable model was found for {reference}."))
            })?;
        let mut files = vec![(plan.url.clone(), plan.filename.clone(), plan.size)];
        for part in plan.parts.iter().flatten() {
            files.push((part.url.clone(), part.filename.clone(), part.size));
        }
        let total: u64 = files.iter().map(|(_, _, size)| *size).sum();
        let mut finished = 0_u64;
        for (url, filename, size) in files {
            let name = filename.clone();
            let before = finished;
            let sink = Arc::clone(&observer);
            self.downloader
                .download(
                    DownloadRequest::new(url, self.models_dir.clone(), filename),
                    move |progress: Progress| {
                        if progress.phase == Phase::Preparing {
                            return;
                        }
                        let completed = before + progress.completed;
                        let whole = total.max(completed);
                        #[allow(clippy::cast_precision_loss)]
                        let percent = if whole == 0 {
                            0.0
                        } else {
                            completed as f64 * 100.0 / whole as f64
                        };
                        sink.on_progress(DownloadProgressRecord {
                            filename: name.clone(),
                            completed,
                            total: whole,
                            percent,
                            remaining_seconds: progress.remaining_seconds,
                        });
                    },
                )
                .await
                .map_err(|error| download_error(&error))?;
            finished += size;
        }
        Ok(plan.filename)
    }

    /// Stops the download of `filename` and removes the partial file.
    pub fn cancel(&self, filename: String) {
        self.downloader.cancel(&self.models_dir, &filename, false);
    }

    /// The models on disk. Projectors and drafts are read through their model, so they are not listed.
    pub fn installed(&self) -> Result<Vec<InstalledModelRecord>, CoreError> {
        let entries = list_gguf_models(
            &self.models_dir,
            &locked(&self.projectors),
            &mut locked(&self.cache),
        )
        .map_err(|error| model_error(error.to_string()))?;
        let mut records: Vec<InstalledModelRecord> = entries
            .into_iter()
            .map(|entry| InstalledModelRecord {
                filename: entry.filename,
                path: entry.path.to_string_lossy().into_owned(),
                bytes: entry.size,
                capabilities: entry.capabilities,
                format: "gguf".to_owned(),
            })
            .collect();
        records.extend(list_mlx_models(&self.models_dir).into_iter().map(|mlx| {
            InstalledModelRecord {
                filename: mlx.name,
                path: mlx.path.to_string_lossy().into_owned(),
                bytes: mlx.bytes,
                capabilities: Vec::new(),
                format: "mlx".to_owned(),
            }
        }));
        Ok(records)
    }

    /// Deletes a model file. False when there was no such file.
    pub fn delete(&self, filename: String) -> Result<bool, CoreError> {
        delete_gguf_model(&self.models_dir, &filename)
            .map_err(|error| model_error(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(name: &str, repo: Option<&str>) -> LibraryModel {
        LibraryModel {
            name: name.to_owned(),
            repo: repo.map(str::to_owned),
            description: String::new(),
            capabilities: Vec::new(),
            sizes: vec!["Q4_K_M".to_owned()],
        }
    }

    #[test]
    fn a_hub_result_downloads_by_its_repository() {
        let record = record_of(model(
            "Huihui-Qwen3.8-27B-abliterated",
            Some("huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF"),
        ));
        assert_eq!(record.name, "Huihui-Qwen3.8-27B-abliterated");
        assert_eq!(
            record.reference,
            "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF"
        );
    }

    #[test]
    fn a_curated_model_downloads_by_its_name() {
        assert_eq!(record_of(model("qwen3", None)).reference, "qwen3");
    }
}
