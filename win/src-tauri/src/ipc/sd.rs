//! Handlers for the image engine channels. Download, cancel and delete are here; the other sd:* channels are not ported yet.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::Engines;
use crate::engines::image_models::families::{self, Family, ModelFile};
use crate::engines::image_models::{self, CatalogueEntry, InstallError, InstallProgress};
use crate::models::hub;
use draggy_models::download::{
    DownloadError, DownloadRequest, Downloaded, Downloader, ReqwestClient, SystemEnv,
};
use draggy_models::huggingface::Download as Resolved;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "sd:download-repo" => download_repo);
    register!(registry, "sd:cancel-download" => cancel_download);
    register!(registry, "sd:delete-model" => delete_model);
}

/// Staged file names of each repository download in flight, keyed by the reference the renderer sent.
static RUNNING: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn text(args: &[Value], index: usize) -> String {
    match args.get(index) {
        Some(Value::String(text)) => text.clone(),
        _ => String::new(),
    }
}

fn image_dir(engines: &Engines) -> PathBuf {
    engines.models_dir.join("image")
}

/// Emits one `sd:progress` event. The percent has one decimal place, as the renderer expects.
fn progress_event(
    app: &AppHandle,
    model_id: &str,
    reference: &str,
    status: &str,
    completed: u64,
    total: u64,
    remaining: Option<u64>,
) {
    let percent = if total > 0 {
        (completed as f64 / total as f64 * 1000.0).round() / 10.0
    } else {
        0.0
    };
    emit(
        app,
        "sd:progress",
        json!({
            "status": status,
            "modelId": model_id,
            "reference": reference,
            "completed": completed,
            "total": total,
            "percent": percent,
            "remainingSeconds": remaining,
        }),
    );
}

/// Fetches one file into the image folder, reporting its bytes on top of `base`.
async fn fetch_file(
    app: &AppHandle,
    downloader: &Downloader<ReqwestClient, SystemEnv>,
    request: DownloadRequest,
    reference: &str,
    model_id: &str,
    base: u64,
    total: u64,
) -> Result<Downloaded, DownloadError> {
    let sink = app.clone();
    let reference = reference.to_owned();
    let model_id = model_id.to_owned();
    downloader
        .download(request, move |p| {
            progress_event(
                &sink,
                &model_id,
                &reference,
                "model-download",
                base + p.completed,
                total,
                p.remaining_seconds,
            );
        })
        .await
}

/// Downloads a model from a Hugging Face reference. A model Draggy knows also gets the pinned files it needs.
async fn download_repo(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let reference = text(&args, 0);
    let engines = app.state::<AppState>().engines.clone();
    let refused =
        || json!({ "success": false, "error": "That model cannot be downloaded as one file" });
    let hub = hub::hub().map_err(IpcError::Failed)?;
    let Some(resolved) = hub.resolve_download(&reference, false).await else {
        return Ok(refused());
    };
    if resolved.parts.is_some() {
        return Ok(refused());
    }
    let repo = reference.split(':').next().unwrap_or("").to_lowercase();
    let known = image_models::CATALOGUE.iter().find(|entry| {
        entry
            .files
            .iter()
            .any(|f| f.hf_repo.to_lowercase() == repo && f.filename == resolved.filename)
    });
    // A model not in the catalogue gets the encoders and VAE its family needs, found from its name.
    let family = match known {
        Some(_) => None,
        None => families::family_of(&[reference.as_str(), resolved.filename.as_str()]),
    };
    let parts = family.map(families::parts_of).unwrap_or_default();
    let dir = image_dir(&engines);

    let staged: Vec<String> = match known {
        Some(entry) => entry
            .files
            .iter()
            .map(|f| format!("{}{}", f.filename, image_models::UNVERIFIED))
            .collect(),
        None => std::iter::once(resolved.filename.clone())
            .chain(
                parts
                    .iter()
                    .map(|p| format!("{}{}", p.filename, image_models::UNVERIFIED)),
            )
            .collect(),
    };
    RUNNING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(reference.clone(), staged);
    let outcome = run_download(
        &app, &engines, &dir, &reference, known, family, &resolved, &parts,
    )
    .await;
    RUNNING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&reference);
    Ok(outcome)
}

#[allow(clippy::too_many_arguments)]
async fn run_download(
    app: &AppHandle,
    engines: &Engines,
    dir: &Path,
    reference: &str,
    known: Option<&'static CatalogueEntry>,
    family: Option<&'static Family>,
    resolved: &Resolved,
    parts: &[ModelFile],
) -> Value {
    let Some(downloader) = engines.models_dl.as_ref() else {
        return json!({ "success": false, "error": "network unavailable" });
    };
    let model_id = match known {
        Some(entry) => entry.id.to_owned(),
        None => format!("file:{}", resolved.filename),
    };
    let total: u64 = match known {
        Some(entry) => entry.files.iter().map(|f| f.size).sum(),
        None => resolved.size + parts.iter().map(|p| p.size).sum::<u64>(),
    };
    let outcome: Result<(), Value> = async {
        if let Some(entry) = known {
            install(
                app,
                downloader,
                dir,
                reference,
                &model_id,
                entry.files,
                0,
                total,
            )
            .await?;
        } else {
            fs::create_dir_all(dir).map_err(io_failure)?;
            let have_main = resolved.size > 0
                && fs::metadata(dir.join(&resolved.filename))
                    .map(|m| m.len())
                    .unwrap_or(0)
                    == resolved.size;
            if !have_main {
                let mut request =
                    DownloadRequest::new(resolved.url.clone(), dir, &resolved.filename);
                request.keep_extension = true;
                fetch_file(app, downloader, request, reference, &model_id, 0, total)
                    .await
                    .map_err(download_failure)?;
            }
            image_models::record_family(dir, &resolved.filename, family.map(|f| f.id))
                .map_err(io_failure)?;
            if !parts.is_empty() {
                install(
                    app,
                    downloader,
                    dir,
                    reference,
                    &model_id,
                    parts,
                    resolved.size,
                    total,
                )
                .await?;
            }
        }
        Ok(())
    }
    .await;
    match outcome {
        Ok(()) => {
            progress_event(app, &model_id, reference, "model-done", total, total, None);
            json!({ "success": true })
        }
        Err(value) => value,
    }
}

/// Installs files with progress counted from `origin` bytes. Failures come back as the renderer's result shape.
#[allow(clippy::too_many_arguments)]
async fn install(
    app: &AppHandle,
    downloader: &Downloader<ReqwestClient, SystemEnv>,
    dir: &Path,
    reference: &str,
    model_id: &str,
    files: &[ModelFile],
    origin: u64,
    total: u64,
) -> Result<(), Value> {
    // Bytes finished before the file in flight, shared with the fetch that reports that file.
    let done = Arc::new(AtomicU64::new(origin));
    let fetch_done = Arc::clone(&done);
    let verify_app = app.clone();
    let verify_id = model_id.to_owned();
    let verify_ref = reference.to_owned();
    let result = image_models::install_files(
        files,
        dir,
        |request| {
            let base = fetch_done.load(Ordering::SeqCst);
            fetch_file(app, downloader, request, reference, model_id, base, total)
        },
        move |progress: InstallProgress| match progress.stage {
            "model-verify" => progress_event(
                &verify_app,
                &verify_id,
                &verify_ref,
                "model-verify",
                0,
                total,
                None,
            ),
            _ => done.store(origin + progress.completed, Ordering::SeqCst),
        },
    )
    .await;
    result.map_err(install_failure)
}

fn download_failure(error: DownloadError) -> Value {
    match error {
        DownloadError::Cancelled => json!({ "success": false, "cancelled": true }),
        other => json!({ "success": false, "error": other.to_string() }),
    }
}

fn io_failure(error: std::io::Error) -> Value {
    json!({ "success": false, "error": error.to_string() })
}

fn install_failure(error: InstallError) -> Value {
    match error {
        InstallError::Cancelled => json!({ "success": false, "cancelled": true }),
        InstallError::Hash { filename } => json!({
            "success": false,
            "code": "E_MODEL_HASH",
            "error": format!("{filename} did not match its pinned hash"),
        }),
        InstallError::Download(message) | InstallError::Io(message) => {
            json!({ "success": false, "error": message })
        }
    }
}

/// Stops the transfers of a reference, a catalogue id or a `file:` id. Staged files are left for a retry.
async fn cancel_download(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let engines = app.state::<AppState>().engines.clone();
    let dir = image_dir(&engines);
    let running = RUNNING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&id)
        .cloned();
    let names: Vec<String> = match running {
        Some(names) => names,
        None => match image_models::catalogue_entry(&id) {
            Some(entry) => entry
                .files
                .iter()
                .map(|f| format!("{}{}", f.filename, image_models::UNVERIFIED))
                .collect(),
            None => id
                .strip_prefix("file:")
                .and_then(|name| Path::new(name).file_name())
                .map(|n| vec![n.to_string_lossy().into_owned()])
                .unwrap_or_default(),
        },
    };
    if let Some(downloader) = engines.models_dl.as_ref() {
        for name in &names {
            downloader.cancel(&dir, name, true);
        }
    }
    Ok(json!({ "success": true }))
}

/// Deletes a catalogue model's files, or one `file:` model, and forgets the family recorded for it.
async fn delete_model(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let engines = app.state::<AppState>().engines.clone();
    let dir = image_dir(&engines);
    let names: Vec<String> = if let Some(entry) = image_models::catalogue_entry(&id) {
        entry.files.iter().map(|f| f.filename.to_owned()).collect()
    } else if let Some(name) = id
        .strip_prefix("file:")
        .and_then(|name| Path::new(name).file_name())
        .map(|n| n.to_string_lossy().into_owned())
    {
        image_models::record_family(&dir, &name, None)
            .map_err(|e| IpcError::Failed(e.to_string()))?;
        vec![name]
    } else {
        return Err(IpcError::Failed("Unknown image model".into()));
    };
    for name in names {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(json!({ "success": true }))
}
