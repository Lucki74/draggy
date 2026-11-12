//! Handlers for the image engine channels: model downloads, the engine install, the server and image jobs.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Duration;

use base64::Engine as _;
use draggy_engine::binary_manager::TarExtractor;
use draggy_engine::sd_runner;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::image_models::families::{self, Family, ModelFile};
use crate::engines::image_models::{self, CatalogueEntry, InstallError, InstallProgress};
use crate::engines::sd::{self as sdlogic, Init, Placement};
use crate::engines::sd_install::{self, Setup};
use crate::engines::sysinfo;
use crate::engines::{Engines, RUNNER, host_platform, locked, now_ms, to_fixed1};
use crate::models::hub;
use draggy_models::download::{
    DownloadError, DownloadRequest, Downloaded, Downloader, ReqwestClient, SystemEnv,
};
use draggy_models::huggingface::Download as Resolved;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "sd:download-repo" => download_repo);
    register!(registry, "sd:cancel-download" => cancel_download);
    register!(registry, "sd:delete-model" => delete_model);
    register!(registry, "sd:status" => sd_status);
    register!(registry, "sd:configure" => sd_configure);
    register!(registry, "sd:setup-engine" => sd_setup_engine);
    register!(registry, "sd:generate" => sd_generate);
    register!(registry, "sd:cancel" => sd_cancel);
    register!(registry, "sd:stop" => sd_stop);
}

/// Staged file names of each repository download in flight, keyed by the reference the renderer sent.
static RUNNING: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The model and picture size the Settings picked. Lives until the app quits.
#[derive(Clone, Default)]
struct Config {
    model: String,
    resolution: Option<(i64, i64)>,
}

static CONFIG: LazyLock<Mutex<Config>> = LazyLock::new(|| Mutex::new(Config::default()));

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
    if engines.sd.loaded_model().as_deref() == Some(id.as_str()) {
        engines.sd.stop().await;
    }
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
        return Ok(json!({ "success": false, "error": "Unknown image model" }));
    };
    for name in names {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(json!({ "success": true }))
}

/// A failed result in the renderer's shape.
fn failure(code: &str, message: impl Into<String>) -> Value {
    json!({ "success": false, "code": code, "error": message.into() })
}

/// The picture folder's file name for a chat-stored starting image, as a data URL the engine reads.
fn created_init(data: &Path, name: &str) -> Result<String, String> {
    const UNREADABLE: &str = "The starting image could not be read";
    let file = Path::new(name)
        .file_name()
        .ok_or_else(|| UNREADABLE.to_string())?;
    let mime = sdlogic::created_mime(&file.to_string_lossy())
        .ok_or_else(|| "The starting image is not a PNG, JPEG or WebP picture".to_string())?;
    let bytes =
        fs::read(super::files::created_dir(data).join(file)).map_err(|_| UNREADABLE.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// The engine state the Settings page shows: the install, the runners, the chosen model and the server.
async fn sd_status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    let dir = image_dir(&engines);
    let host = host_platform();
    let nvidia = sd_install::has_nvidia_driver();
    let (_, vram) = engines.specs().await;
    let installed = sd_install::find_sd_binary(&engines.user_data, None);
    let models = image_models::list_image_models(&dir);
    let wanted = locked(&CONFIG).model.clone();
    let model = sdlogic::chosen_model(&models, &wanted);
    Ok(json!({
        "success": true,
        "release": sd_runner::release_for(host.os),
        "installed": installed.is_some(),
        "runner": installed.as_ref().map(|found| found.runner.clone()),
        "source": installed.as_ref().map(|found| found.source),
        "runners": sd_runner::runners_for(host.os, host.arch, nvidia, false),
        "defaultRunner": sd_runner::default_runner(host.os, host.arch, vram, nvidia, false),
        "model": model,
        "models": models,
        "ready": installed.is_some() && !model.is_empty(),
        "server": engines.sd.status(),
    }))
}

/// Saves the chosen model and picture size. A model name over 300 characters is refused.
async fn sd_configure(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let body = args.first().cloned().unwrap_or(Value::Null);
    let model = body.get("model").and_then(Value::as_str).unwrap_or("");
    if model.chars().count() > 300 {
        return Ok(failure("E_REQUEST", "The model name is too long"));
    }
    let resolution = sdlogic::parse_resolution(body.get("resolution").unwrap_or(&Value::Null));
    *locked(&CONFIG) = Config {
        model: model.to_owned(),
        resolution,
    };
    Ok(json!({ "success": true }))
}

/// Stops the server and installs the best engine for this machine, reporting progress as engine-download.
async fn sd_setup_engine(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let engines = state.engines.clone();
    engines.sd.stop().await;
    let Some(net) = engines.net.as_ref() else {
        return Ok(json!({
            "success": false,
            "runner": null,
            "kind": null,
            "error": "The network is not available",
        }));
    };
    let (_, vram) = engines.specs().await;
    let extractor = TarExtractor::for_platform(&RUNNER, &host_platform());
    let progress = |mut value: Value| {
        value["status"] = json!("engine-download");
        emit(&app, "sd:progress", value);
    };
    let result =
        sd_install::ensure_engine(&engines.user_data, net, &extractor, vram, &progress).await;
    match &result {
        Setup::Ready { runner, .. } => {
            state
                .diag
                .info("sd", &format!("image engine ready: {runner}"), None);
        }
        Setup::Failed { kind, .. } => {
            state
                .diag
                .warn("sd", &format!("image engine setup failed: {kind}"), None);
        }
    }
    Ok(result.to_value())
}

/// Runs one image job end to end: checks the request, starts or reuses the server, draws, and saves the picture.
async fn sd_generate(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let engines = state.engines.clone();
    let raw = args.first().cloned().unwrap_or(Value::Null);
    let mut parsed = match sdlogic::parse_request(&raw) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(failure(error.code, error.message)),
    };
    let request_id = parsed.request_id.clone();
    // Checked before minutes of work, so a refused path costs nothing.
    let project_out = match &parsed.destination {
        sdlogic::Destination::Project {
            workspace,
            path,
            overwrite,
            ..
        } => {
            let target = match super::files::project_target(workspace, path) {
                Ok(target) => target,
                Err(message) => return Ok(failure("E_PATH", message)),
            };
            if !overwrite && target.exists() {
                let name = target
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                return Ok(failure("E_EXISTS", format!("{name} already exists")));
            }
            Some((workspace.clone(), path.clone()))
        }
        sdlogic::Destination::Chat => None,
    };
    let progress = |value: Value| {
        let mut event = value;
        event["requestId"] = json!(request_id);
        emit(&app, "sd:progress", event);
    };

    let dir = image_dir(&engines);
    let (_, vram) = engines.specs().await;
    let config = locked(&CONFIG).clone();
    let wanted = if parsed.model.is_empty() {
        config.model.clone()
    } else {
        parsed.model.clone()
    };
    let chosen = sdlogic::chosen_model(&image_models::list_image_models(&dir), &wanted);
    let missing = || failure("E_MODEL_MISSING", "The image model is not downloaded");
    if chosen.is_empty() {
        return Ok(missing());
    }
    let Some(resolved) = image_models::resolve_image_model(&dir, &chosen) else {
        return Ok(missing());
    };

    let host = host_platform();
    let nvidia = sd_install::has_nvidia_driver();
    let preferred = sd_runner::default_runner(host.os, host.arch, vram, nvidia, false);
    let Some(found) = sd_install::find_sd_binary(&engines.user_data, preferred) else {
        return Ok(failure(
            "E_ENGINE_MISSING",
            "The image engine is not installed",
        ));
    };
    let (binary, runner) = (found.path, found.runner);

    let loras_dir = image_models::loras_dir(&dir);
    let available = image_models::list_loras(&dir);
    let mut lora_inputs = Vec::new();
    for (name, multiplier) in &parsed.loras {
        let file = available
            .iter()
            .find(|lora| lora["name"].as_str() == Some(name.as_str()))
            .and_then(|lora| lora["file"].as_str());
        let Some(file) = file else {
            return Ok(failure("E_LORA", format!("There is no LoRA called {name}")));
        };
        lora_inputs.push(json!({
            "path": loras_dir.join(file).to_string_lossy(),
            "multiplier": multiplier,
        }));
    }
    parsed.input["lora"] = Value::Array(lora_inputs);

    let has_init = match &parsed.init {
        Init::None => false,
        Init::Project {
            workspace,
            path,
            optional,
        } => match super::files::read_project_image(workspace, path) {
            Ok(url) => {
                parsed.input["initImage"] = json!(url);
                true
            }
            // A reference the chat tracked may have been moved or deleted; that is text-only, not a failure.
            Err(_) if *optional => false,
            Err(message) => return Ok(failure("E_INIT_IMAGE", message)),
        },
        Init::Data(url) => {
            parsed.input["initImage"] = json!(url);
            true
        }
        Init::Created(name) => match created_init(&engines.user_data, name) {
            Ok(url) => {
                parsed.input["initImage"] = json!(url);
                true
            }
            Err(message) => return Ok(failure("E_INIT_IMAGE", message)),
        },
    };
    let no_size = parsed.input["width"].is_null() && parsed.input["height"].is_null();
    if let Some((width, height)) = config.resolution.filter(|_| no_size) {
        parsed.input["width"] = json!(width);
        parsed.input["height"] = json!(height);
    }

    let family = resolved.family;
    let hints = [chosen.as_str()];
    let mode = families::reference_mode_of(family, &hints);
    let defaults = families::defaults_for(family, &hints);
    let need = image_models::memory_need_gb(&resolved, vram);
    let mut took_chat = false;
    let mut placement = Placement::Gpu;
    let running = engines.sd.loaded_model().as_deref() == Some(chosen.as_str());
    if !running {
        let gb = 1024_f64.powi(3);
        if raw.get("stopChat").and_then(Value::as_bool) == Some(true) {
            stop_chat_model(&engines).await;
            took_chat = true;
        }
        let free_vram = sd_install::free_vram_gb().await;
        let chat = engines.llama().await.status();
        let loaded = loaded_chat_gb(chat.running, chat.model.as_deref());
        let memory = sysinfo::memory();
        let plan_memory = sdlogic::Memory {
            free_vram_gb: free_vram,
            total_vram_gb: vram,
            loaded_llm_gb: loaded,
            unified: false,
            free_ram_gb: memory.free_bytes as f64 / gb,
            total_ram_gb: memory.total_bytes as f64 / gb,
            runner: runner.clone(),
        };
        placement = sdlogic::plan_memory(need, &plan_memory);
        if placement == Placement::Fail {
            return Ok(json!({
                "success": false,
                "code": "E_VRAM",
                "error": "Not enough memory for this image model",
                "params": { "needGB": to_fixed1(need) },
            }));
        }
        if placement == Placement::UnloadChat {
            stop_chat_model(&engines).await;
            took_chat = true;
            placement =
                sdlogic::placement_after_unload(need, vram, free_vram.unwrap_or(0.0) + loaded);
        }
    }
    let offload = placement == Placement::Offload;

    if !running {
        progress(json!({ "status": "loading-model" }));
        if let Err((code, message)) = start_engine(
            &engines,
            &binary,
            &resolved,
            &chosen,
            &loras_dir,
            &sdlogic::engine_flags(offload, false),
        )
        .await
        {
            state
                .diag
                .warn("sd", &format!("server start failed: {code}"), None);
            return Ok(failure(&code, message));
        }
        if took_chat {
            engines.sd.set_took_chat_memory(true);
        }
    }

    let limits = sdlogic::limits_from(&engines.sd.capabilities().await);
    let reference = has_init.then_some(mode);
    let clamped = match sdlogic::clamp_request(&parsed.input, limits, defaults, reference) {
        Ok(clamped) => clamped,
        Err(error) => return Ok(failure(error.code, error.message)),
    };
    let body = sdlogic::build_job_body(&clamped);

    let mut generated = engines
        .sd
        .generate(&request_id, body.clone(), &progress)
        .await;
    if matches!(&generated, Err(error) if error.code == "E_CRASH") {
        state.diag.warn(
            "sd",
            "sd-server stopped during a job; restarting it once in safe mode",
            None,
        );
        if let Err((code, message)) = start_engine(
            &engines,
            &binary,
            &resolved,
            &chosen,
            &loras_dir,
            &sdlogic::engine_flags(offload, true),
        )
        .await
        {
            return Ok(failure(&code, message));
        }
        generated = engines.sd.generate(&request_id, body, &progress).await;
    }
    // The image engine gives the chat model's memory back once its last job is done.
    if took_chat && engines.sd.pending_jobs() == 0 {
        engines.sd.stop().await;
    }

    let bytes = match generated {
        Ok(bytes) => bytes,
        Err(error) => {
            let status = if error.code == "E_CANCELLED" {
                "cancelled"
            } else {
                "error"
            };
            progress(json!({ "status": status, "error": error.message }));
            if status == "error" {
                state
                    .diag
                    .warn("sd", &format!("generate failed: {}", error.code), None);
            }
            return Ok(failure(error.code, error.message));
        }
    };

    if let Some((workspace, target)) = project_out {
        let lower = target.to_ascii_lowercase();
        let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            "image/jpeg"
        } else if lower.ends_with(".webp") {
            "image/webp"
        } else {
            "image/png"
        };
        let data_url = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let chat = match &parsed.destination {
            sdlogic::Destination::Project { chat, .. } => chat.clone(),
            sdlogic::Destination::Chat => None,
        };
        return Ok(
            match super::files::write_project_image(&workspace, &target, &data_url, chat.as_deref())
            {
                Ok((path, checkpoint_id, created)) => {
                    progress(json!({ "status": "done" }));
                    json!({
                        "success": true,
                        "path": path.to_string_lossy(),
                        "filename": path.file_name().map(|n| n.to_string_lossy().into_owned()),
                        "checkpointId": checkpoint_id,
                        "created": created,
                        "width": clamped.width,
                        "height": clamped.height,
                        "seed": clamped.seed,
                        "model": chosen,
                        "referenceUsed": reference.is_some(),
                        "referenceDropped": clamped.reference_dropped,
                    })
                }
                Err(message) => failure(
                    "E_SAVE",
                    if message.is_empty() {
                        "The image could not be saved".to_owned()
                    } else {
                        message
                    },
                ),
            },
        );
    }

    let out_dir = super::files::created_dir(&engines.user_data);
    if let Err(error) = fs::create_dir_all(&out_dir) {
        return Ok(failure("E_FAILED", error.to_string()));
    }
    let stamp = sdlogic::stamp_of(now_ms() / 1000);
    let name = image_models::requests::output_name(&clamped.prompt, &stamp, |candidate| {
        out_dir.join(candidate).exists()
    });
    let path = out_dir.join(&name);
    if let Err(error) = fs::write(&path, &bytes) {
        return Ok(failure("E_FAILED", error.to_string()));
    }
    progress(json!({ "status": "done" }));
    Ok(json!({
        "success": true,
        "path": path.to_string_lossy(),
        "filename": name,
        "created": true,
        "width": clamped.width,
        "height": clamped.height,
        "seed": clamped.seed,
        "model": chosen,
        "referenceUsed": reference.is_some(),
        "referenceDropped": clamped.reference_dropped,
    }))
}

/// Cancels one request by id. Returns whether the request was known and the cancel was taken.
async fn sd_cancel(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let engines = app.state::<AppState>().engines.clone();
    Ok(json!({ "success": engines.sd.cancel(&id).await }))
}

/// Stops the image server and frees its memory.
async fn sd_stop(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    engines.sd.stop().await;
    Ok(json!({ "success": true }))
}

/// Stops the chat model so its memory goes to the image engine.
async fn stop_chat_model(engines: &Engines) {
    engines.llama().await.stop().await;
}

/// Size in GB of the chat model file that is running, 0 when none runs or the file cannot be read.
/// Port of Electron's loadedChatModelGB.
fn loaded_chat_gb(running: bool, model: Option<&Path>) -> f64 {
    if !running {
        return 0.0;
    }
    model
        .and_then(|path| std::fs::metadata(path).ok())
        .map_or(0.0, |meta| meta.len() as f64 / 1024_f64.powi(3))
}

#[cfg(test)]
mod loaded_chat_tests {
    use super::loaded_chat_gb;
    use std::path::Path;

    #[test]
    fn nothing_loaded_counts_as_zero() {
        assert_eq!(
            loaded_chat_gb(false, Some(Path::new("/nope/model.gguf"))),
            0.0
        );
        assert_eq!(loaded_chat_gb(true, None), 0.0);
        assert_eq!(
            loaded_chat_gb(true, Some(Path::new("/definitely/missing.gguf"))),
            0.0
        );
    }

    #[test]
    fn running_model_counts_its_file_size_in_gb() {
        let dir = std::env::temp_dir().join(format!("loaded-chat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("chat.gguf");
        std::fs::write(&file, vec![0_u8; 1024 * 1024]).unwrap();
        let gb = loaded_chat_gb(true, Some(&file));
        std::fs::remove_dir_all(&dir).unwrap();
        assert!((gb - 1.0 / 1024.0).abs() < 1e-9);
    }
}

/// Starts the image engine with one model and its LoRA folder, plus the placement flags. Returns the failure code and message.
async fn start_engine(
    engines: &Engines,
    binary: &Path,
    resolved: &image_models::Resolved,
    chosen: &str,
    loras_dir: &Path,
    flags: &[&'static str],
) -> Result<(), (String, String)> {
    let mut args = image_models::model_args(resolved)
        .map_err(|message| ("E_MODEL_MISSING".to_owned(), message))?;
    args.push("--lora-model-dir".into());
    args.push(loras_dir.to_string_lossy().into_owned());
    args.extend(flags.iter().map(|flag| (*flag).to_owned()));
    let gb = 1024_f64.powi(3);
    let size_gb = resolved
        .paths
        .iter()
        .map(|(_, path)| fs::metadata(path).map_or(0, |m| m.len()))
        .sum::<u64>() as f64
        / gb;
    let deadline = Duration::from_millis(sdlogic::load_deadline_ms(size_gb));
    let setup = crate::engines::EngineSetup::new(engines).await;
    engines
        .sd
        .start(binary, &args, chosen, deadline, &setup.env)
        .await
        .map_err(|error| (error.code.to_owned(), error.message))
}
