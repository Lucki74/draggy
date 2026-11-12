//! Handlers for the library channels: a folder index in library.db, searched by keyword and vector and fused by rank.

mod chunk;
pub(super) mod research;
mod scan;
mod store;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::storage::{blocking, js_string};
use super::{IpcError, Registry, emit};
use crate::AppState;
use chunk::{CANDIDATE_DEPTH, Chunk, fuse, normalise, rank_chunks};
use scan::FileInfo;
use store::{DEFAULT_EMBED_MODEL, DEFAULT_WORKSPACE, FileRow, Hit, MAX_INDEXED_CHUNKS, Store};

const EMBED_BATCH: usize = 16;
const EMBED_BASE_URL: &str = "http://127.0.0.1:11436";
const EMBED_TIMEOUT: Duration = Duration::from_secs(120);
const NOT_AVAILABLE: &str = "embedding model not available";

pub type Pending<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Turns passages into vectors. The launcher that starts the embedding server plugs in here.
pub trait Embedder: Send + Sync {
    fn available(&self) -> Pending<'_, bool>;
    fn embed<'a>(
        &'a self,
        model: &'a str,
        inputs: Vec<String>,
    ) -> Pending<'a, Result<Vec<Vec<f32>>, String>>;
}

/// Posts to an embedding server already listening on the local port.
// TODO(embed-server): start llama-server --embedding on demand, as electron/embedServer.cjs does; not ported.
struct HttpEmbedder;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(EMBED_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

static EMBEDDER: HttpEmbedder = HttpEmbedder;
static STORE: Mutex<Option<Store>> = Mutex::new(None);
static INDEXING: AtomicBool = AtomicBool::new(false);

impl Embedder for HttpEmbedder {
    fn available(&self) -> Pending<'_, bool> {
        Box::pin(async {
            CLIENT
                .get(format!("{EMBED_BASE_URL}/health"))
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .is_ok_and(|response| response.status().is_success())
        })
    }

    fn embed<'a>(
        &'a self,
        model: &'a str,
        inputs: Vec<String>,
    ) -> Pending<'a, Result<Vec<Vec<f32>>, String>> {
        Box::pin(async move {
            let payload = json!({ "input": inputs, "model": model }).to_string();
            let response = CLIENT
                .post(format!("{EMBED_BASE_URL}/v1/embeddings"))
                .header("Content-Type", "application/json")
                .body(payload)
                .send()
                .await
                .map_err(|_| "Embedding failed: the server did not answer".to_owned())?;
            let status = response.status();
            let bytes = response
                .bytes()
                .await
                .map_err(|_| "Embedding failed: no body".to_owned())?;
            if !status.is_success() {
                let detail: String = String::from_utf8_lossy(&bytes).chars().take(200).collect();
                return Err(format!("Embedding failed ({}): {detail}", status.as_u16()));
            }
            let shape = "Embedding model returned an unexpected shape";
            let body: Value = serde_json::from_slice(&bytes).map_err(|_| shape.to_owned())?;
            let vectors: Vec<Vec<f32>> = body["data"]
                .as_array()
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| entry["embedding"].as_array())
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_f64)
                                .map(|v| v as f32)
                                .collect()
                        })
                        .collect()
                })
                .unwrap_or_default();
            if vectors.len() != inputs.len() {
                return Err(shape.to_owned());
            }
            Ok(vectors.iter().map(|v| normalise(v)).collect())
        })
    }
}

pub fn register_all(registry: &mut Registry) {
    register!(registry, "library:list" => list);
    register!(registry, "library:stats" => stats);
    register!(registry, "library:pick-folder" => pick_folder);
    register!(registry, "library:index" => index);
    register!(registry, "library:remove" => remove);
    register!(registry, "library:clear" => clear);
    register!(registry, "library:search" => search);
}

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn failure(error: impl std::fmt::Display) -> Value {
    json!({ "success": false, "error": error.to_string() })
}

pub(super) fn data_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().storage.data_dir().to_path_buf()
}

/// Runs store work off the UI thread, with the database opened on first use.
pub(super) async fn db<T, F>(dir: &Path, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut Store) -> rusqlite::Result<T> + Send + 'static,
{
    let dir = dir.to_path_buf();
    match blocking(move || {
        let mut guard = STORE.lock().unwrap_or_else(PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(Store::open(&dir.join("library.db")).map_err(text)?);
        }
        match guard.as_mut() {
            Some(store) => work(store).map_err(text),
            None => Err("library is closed".to_owned()),
        }
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(text(error)),
    }
}

/// Holds the single index run; released when the run ends, however it ends.
struct RunClaim;

impl RunClaim {
    fn take() -> Option<Self> {
        INDEXING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for RunClaim {
    fn drop(&mut self) {
        INDEXING.store(false, Ordering::Release);
    }
}

async fn list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = js_string(args.first());
    let dir = data_dir(&app);
    let result = db(&dir, move |s| {
        let scope = (!workspace.is_empty()).then_some(workspace);
        s.list_sources(scope.as_deref())
    })
    .await;
    Ok(match result {
        Ok(sources) => json!({ "success": true, "sources": sources }),
        Err(error) => failure(error),
    })
}

async fn stats(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let dir = data_dir(&app);
    Ok(match db(&dir, |s| s.stats(MAX_INDEXED_CHUNKS)).await {
        Ok(stats) => json!({ "success": true, "stats": stats }),
        Err(error) => failure(error),
    })
}

async fn pick_folder(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let dialog_app = app.clone();
    let picked = blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Choose a folder to index")
            .blocking_pick_folder()
    })
    .await?;
    Ok(match picked.and_then(|folder| folder.into_path().ok()) {
        Some(path) => json!({ "success": true, "path": path.to_string_lossy().into_owned() }),
        None => json!({ "success": false, "cancelled": true }),
    })
}

async fn index(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let source = js_string(args.first());
    let model = js_string(args.get(1));
    let model = if model.is_empty() {
        DEFAULT_EMBED_MODEL.to_owned()
    } else {
        model
    };
    let workspace = js_string(args.get(2));
    let workspace = if workspace.is_empty() {
        DEFAULT_WORKSPACE.to_owned()
    } else {
        workspace
    };

    let Some(_claim) = RunClaim::take() else {
        return Ok(json!({ "success": false, "error": "An index run is already in progress." }));
    };
    if !EMBEDDER.available().await {
        return Ok(json!({ "success": false, "error": NOT_AVAILABLE }));
    }

    let dir = data_dir(&app);
    let meta_model = model.clone();
    if let Err(error) = db(&dir, move |s| s.set_meta("embed_model", &meta_model)).await {
        return Ok(failure(error));
    }
    Ok(
        match index_folder(&app, &dir, &source, &model, &workspace).await {
            Ok(value) => value,
            Err(error) => failure(error),
        },
    )
}

enum Failure {
    Embed(String),
    Other,
}

/// Walks the folder and indexes what changed. Stops early only when embedding keeps failing.
async fn index_folder(
    app: &AppHandle,
    dir: &Path,
    source: &str,
    model: &str,
    workspace: &str,
) -> Result<Value, String> {
    let root = std::path::absolute(source).unwrap_or_else(|_| PathBuf::from(source));
    let folder = root.clone();
    if !blocking(move || folder.exists()).await.map_err(text)? {
        return Ok(json!({ "success": false, "error": "That folder no longer exists." }));
    }

    let key = root.to_string_lossy().into_owned();
    let workspace_owned = workspace.to_owned();
    let source_id = db(dir, move |s| s.ensure_source(&key, &workspace_owned)).await?;
    let walk_root = root.clone();
    let files: Vec<FileInfo> = blocking(move || scan::walk(&walk_root))
        .await
        .map_err(text)?;
    let mut existing: HashMap<String, FileRow> =
        db(dir, move |s| s.existing_files(source_id)).await?;

    let (mut indexed, mut skipped, mut failed, mut chunks) = (0_u64, 0_u64, 0_u64, 0_i64);
    let mut seen: HashSet<String> = HashSet::new();
    for (position, file) in files.iter().enumerate() {
        let path_key = file.path.to_string_lossy().into_owned();
        // Electron marks the file seen before the ceiling check, so the file that hits the ceiling keeps its rows.
        seen.insert(path_key.clone());
        if db(dir, |s| s.total_chunks()).await? >= MAX_INDEXED_CHUNKS {
            break;
        }
        emit_progress(app, "indexing", position + 1, files.len(), &file.path);

        let previous = existing.remove(&path_key);
        match index_file(dir, source_id, file, model, previous).await {
            Ok((true, count)) => {
                skipped += 1;
                chunks += count;
            }
            Ok((false, count)) => {
                indexed += 1;
                chunks += count;
            }
            Err(Failure::Embed(message)) => {
                failed += 1;
                if failed > 3 {
                    return Ok(json!({
                        "success": false,
                        "error": format!("Embedding stopped: {message}"),
                        "indexed": indexed, "skipped": skipped, "failed": failed,
                    }));
                }
            }
            Err(Failure::Other) => failed += 1,
        }
    }

    // Files that left the folder lose their rows; files past the chunk ceiling are not seen, so their rows go, as in electron/library.cjs.
    for (path, row) in existing {
        if !seen.contains(&path) {
            db(dir, move |s| s.drop_file(row.id)).await?;
        }
    }
    emit_progress(app, "done", files.len(), files.len(), &root);
    app.state::<AppState>().diag.info(
        "library",
        "index run finished",
        Some(json!({ "indexed": indexed, "skipped": skipped, "failed": failed, "chunks": chunks, "files": files.len() })),
    );
    Ok(json!({
        "success": true, "indexed": indexed, "skipped": skipped, "failed": failed,
        "chunks": chunks, "files": files.len(),
    }))
}

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, file: &Path) {
    let name = if phase == "done" {
        String::new()
    } else {
        file.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    emit(
        app,
        "library-progress",
        json!({ "phase": phase, "current": current, "total": total, "file": name }),
    );
}

/// Returns (skipped, chunk count). An unchanged file keeps its rows.
async fn index_file(
    dir: &Path,
    source_id: i64,
    file: &FileInfo,
    model: &str,
    previous: Option<FileRow>,
) -> Result<(bool, i64), Failure> {
    if let Some(row) = previous
        .as_ref()
        .filter(|row| row.mtime == file.mtime && row.size == file.size as i64)
    {
        return Ok((true, row.chunks));
    }

    let path = file.path.clone();
    let body = match blocking(move || scan::read_text(&path)).await {
        Ok(Ok(body)) => body,
        _ => return Err(Failure::Other),
    };
    let passages: Vec<Chunk> = blocking(move || chunk::chunk_text(&body))
        .await
        .map_err(|_| Failure::Other)?;

    let old_id = previous.as_ref().map(|row| row.id);
    if passages.is_empty() {
        if let Some(id) = old_id {
            db(dir, move |s| s.drop_file(id))
                .await
                .map_err(|_| Failure::Other)?;
        }
        return Ok((false, 0));
    }

    let mut vectors: Vec<Vec<f32>> = Vec::with_capacity(passages.len());
    for batch in passages.chunks(EMBED_BATCH) {
        let inputs: Vec<String> = batch
            .iter()
            .map(|c| {
                if c.heading.is_empty() {
                    c.text.clone()
                } else {
                    format!("{}\n\n{}", c.heading, c.text)
                }
            })
            .collect();
        let embedded = EMBEDDER
            .embed(model, inputs)
            .await
            .map_err(Failure::Embed)?;
        vectors.extend(embedded);
    }

    let count = passages.len() as i64;
    let path_text = file.path.to_string_lossy().into_owned();
    let (mtime, size) = (file.mtime, file.size as i64);
    db(dir, move |s| {
        s.write_file(
            source_id, &path_text, mtime, size, &passages, &vectors, old_id,
        )
    })
    .await
    .map_err(|_| Failure::Other)?;
    Ok((false, count))
}

enum Prepared {
    Empty,
    UnknownSource(Vec<Value>),
    Ready {
        source_id: Option<i64>,
        model: String,
    },
}

async fn search(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = js_string(args.first()).trim().to_owned();
    let limit = args.get(1).and_then(Value::as_f64).unwrap_or(0.0) as i64;
    let model_arg = js_string(args.get(2));
    let options = args.get(3);
    let source = options
        .and_then(|o| o.get("source"))
        .map(|v| js_string(Some(v)))
        .filter(|s| !s.is_empty());
    let workspace = options
        .and_then(|o| o.get("workspaceId"))
        .map(|v| js_string(Some(v)))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_WORKSPACE.to_owned());
    if query.is_empty() {
        return Ok(json!({ "success": true, "results": [] }));
    }

    let dir = data_dir(&app);
    let prepared = db(&dir, move |s| {
        if s.matrix()?.ids.is_empty() {
            return Ok(Prepared::Empty);
        }
        let source_id = match source.as_deref() {
            Some(name) => match s.resolve_source(name)? {
                Some(id) => Some(id),
                None => return Ok(Prepared::UnknownSource(s.list_sources(None)?)),
            },
            None => None,
        };
        let model = if model_arg.is_empty() {
            s.meta("embed_model")?
                .unwrap_or_else(|| DEFAULT_EMBED_MODEL.to_owned())
        } else {
            model_arg
        };
        Ok(Prepared::Ready { source_id, model })
    })
    .await;

    let (source_id, model) = match prepared {
        Ok(Prepared::Empty) => return Ok(json!({ "success": true, "results": [], "empty": true })),
        Ok(Prepared::UnknownSource(rows)) => {
            let paths: Vec<Value> = rows.iter().map(|row| row["path"].clone()).collect();
            return Ok(
                json!({ "success": true, "results": [], "unknownSource": true, "sources": paths }),
            );
        }
        Ok(Prepared::Ready { source_id, model }) => (source_id, model),
        Err(error) => return Ok(json!({ "success": false, "error": error, "results": [] })),
    };

    let vector = match EMBEDDER.embed(&model, vec![query.clone()]).await {
        Ok(mut vectors) => vectors.pop().unwrap_or_default(),
        Err(error) => return Ok(json!({ "success": false, "error": error, "results": [] })),
    };

    let scaled = if limit == 0 { 6 } else { limit.clamp(1, 20) };
    let wanted = usize::try_from(scaled).unwrap_or(6);
    let results = db(&dir, move |s| {
        let vector_hits = rank_chunks(&vector, s.matrix()?, CANDIDATE_DEPTH, source_id);
        let keyword = s.keyword_candidates(&query, source_id, CANDIDATE_DEPTH);
        let fused = fuse(&vector_hits, &keyword, wanted * 3);
        let hits = s.hydrate(&fused)?;
        let allowed = s.scope_ids(&workspace)?;
        Ok(hits
            .iter()
            .filter(|hit| allowed.contains(&hit.source_id))
            .take(wanted)
            .map(Hit::to_json)
            .collect::<Vec<Value>>())
    })
    .await;
    Ok(match results {
        Ok(results) => json!({ "success": true, "results": results }),
        Err(error) => json!({ "success": false, "error": error, "results": [] }),
    })
}

async fn remove(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = args
        .first()
        .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()));
    let Some(id) = id else {
        return Ok(json!({ "success": true }));
    };
    let dir = data_dir(&app);
    Ok(match db(&dir, move |s| s.remove_source(id)).await {
        Ok(()) => json!({ "success": true }),
        Err(error) => failure(error),
    })
}

async fn clear(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let dir = data_dir(&app);
    Ok(match db(&dir, |s| s.clear()).await {
        Ok(()) => json!({ "success": true }),
        Err(error) => failure(error),
    })
}
