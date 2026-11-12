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
use std::sync::{Arc, Mutex, PoisonError};

use draggy_diagnostics::Diagnostics;
use draggy_engine::binary_manager::find_llama_binary;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::storage::{blocking, js_string};
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::embed_server;
use crate::engines::{Engines, host_platform};
use chunk::{CANDIDATE_DEPTH, Chunk, fuse, normalise, rank_chunks};
use scan::FileInfo;
use store::{DEFAULT_EMBED_MODEL, DEFAULT_WORKSPACE, FileRow, Hit, MAX_INDEXED_CHUNKS, Store};

const EMBED_BATCH: usize = 16;
const NOT_AVAILABLE: &str = "embedding model not available";

pub type Pending<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Turns passages into vectors. The engine-backed one starts the embedding server on first use.
pub trait Embedder: Send + Sync {
    fn available<'a>(&'a self, model: &'a str) -> Pending<'a, bool>;
    fn embed<'a>(
        &'a self,
        model: &'a str,
        inputs: Vec<String>,
    ) -> Pending<'a, Result<Vec<Vec<f32>>, String>>;
}

/// Vectors from the embedding server in the engines, started on first use.
struct EngineEmbedder {
    engines: Arc<Engines>,
    diag: Arc<Diagnostics>,
}

impl EngineEmbedder {
    fn new(app: &AppHandle) -> Self {
        let state = app.state::<AppState>();
        Self {
            engines: Arc::clone(&state.engines),
            diag: Arc::clone(&state.diag),
        }
    }
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
static INDEXING: AtomicBool = AtomicBool::new(false);

impl Embedder for EngineEmbedder {
    fn available<'a>(&'a self, model: &'a str) -> Pending<'a, bool> {
        Box::pin(async move {
            find_llama_binary(&host_platform(), Some(&self.engines.user_data)).is_some()
                && embed_server::model_present(&self.engines.models_dir, model)
        })
    }

    fn embed<'a>(
        &'a self,
        model: &'a str,
        inputs: Vec<String>,
    ) -> Pending<'a, Result<Vec<Vec<f32>>, String>> {
        Box::pin(async move {
            let binary = find_llama_binary(&host_platform(), Some(&self.engines.user_data));
            let cores = self.engines.topology().await;
            let setup = crate::engines::EngineSetup::new(&self.engines).await;
            let result = self
                .engines
                .embed
                .embed(
                    binary,
                    &self.engines.models_dir,
                    cores,
                    model,
                    &inputs,
                    &setup,
                )
                .await;
            match result {
                Ok(vectors) => Ok(vectors.iter().map(|v| normalise(v)).collect()),
                Err(error) => {
                    self.diag.warn(
                        "library",
                        "embedding failed",
                        Some(json!({ "reason": error })),
                    );
                    Err(error)
                }
            }
        })
    }
}

/// The text a passage is embedded as: its heading above its body.
fn embed_input(chunk: &Chunk) -> String {
    if chunk.heading.is_empty() {
        chunk.text.clone()
    } else {
        format!("{}\n\n{}", chunk.heading, chunk.text)
    }
}

/// The passages' embed inputs, in order, grouped into batches of `EMBED_BATCH`.
fn embed_batches(passages: &[Chunk]) -> Vec<Vec<String>> {
    passages
        .chunks(EMBED_BATCH)
        .map(|batch| batch.iter().map(embed_input).collect())
        .collect()
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
    let embedder = EngineEmbedder::new(&app);
    if !embedder.available(&model).await {
        return Ok(json!({ "success": false, "error": NOT_AVAILABLE }));
    }

    let dir = data_dir(&app);
    let meta_model = model.clone();
    if let Err(error) = db(&dir, move |s| s.set_meta("embed_model", &meta_model)).await {
        return Ok(failure(error));
    }
    Ok(
        match index_folder(&app, &dir, &embedder, &source, &model, &workspace).await {
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
    embedder: &EngineEmbedder,
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
        match index_file(dir, embedder, source_id, file, model, previous).await {
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
async fn index_file<E: Embedder>(
    dir: &Path,
    embedder: &E,
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
    for inputs in embed_batches(&passages) {
        let embedded = embedder
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

    let embedder = EngineEmbedder::new(&app);
    let vector = match embedder.embed(&model, vec![query.clone()]).await {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Returns a vector per input without touching a server; counts the calls.
    struct Fake {
        calls: AtomicUsize,
        fail: bool,
    }

    impl Embedder for Fake {
        fn available<'a>(&'a self, _model: &'a str) -> Pending<'a, bool> {
            Box::pin(async { true })
        }

        fn embed<'a>(
            &'a self,
            _model: &'a str,
            inputs: Vec<String>,
        ) -> Pending<'a, Result<Vec<Vec<f32>>, String>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if self.fail {
                    return Err("Embedding failed (500): boom".to_owned());
                }
                Ok(inputs
                    .iter()
                    .map(|text| vec![text.len() as f32, 1.0])
                    .collect())
            })
        }
    }

    fn passage(heading: &str, text: &str) -> Chunk {
        Chunk {
            heading: heading.to_owned(),
            text: text.to_owned(),
        }
    }

    #[test]
    fn heading_is_embedded_above_body() {
        assert_eq!(embed_input(&passage("Terms", "Net 30")), "Terms\n\nNet 30");
        assert_eq!(embed_input(&passage("", "Net 30")), "Net 30");
    }

    #[test]
    fn passages_batch_in_order_by_sixteen() {
        let passages: Vec<Chunk> = (0..35).map(|i| passage("", &i.to_string())).collect();
        let batches = embed_batches(&passages);
        let sizes: Vec<usize> = batches.iter().map(Vec::len).collect();
        assert_eq!(sizes, vec![16, 16, 3]);
        let flat: Vec<String> = batches.into_iter().flatten().collect();
        let expected: Vec<String> = (0..35).map(|i| i.to_string()).collect();
        assert_eq!(flat, expected);
    }

    #[tokio::test]
    async fn index_file_stores_one_vector_per_passage() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("notes.md");
        let body = "Payment is due within thirty days of the invoice date. ".repeat(40);
        std::fs::write(&file_path, format!("# Terms\n\n{body}")).expect("write note");
        let size = std::fs::metadata(&file_path).expect("stat").len();
        let info = FileInfo {
            path: file_path,
            mtime: 1,
            size,
        };
        let source_id = db(dir.path(), |s| s.ensure_source("/notes", "default"))
            .await
            .expect("source");
        let fake = Fake {
            calls: AtomicUsize::new(0),
            fail: false,
        };

        let outcome = index_file(dir.path(), &fake, source_id, &info, "nomic", None).await;
        assert!(matches!(outcome, Ok((false, count)) if count > 0));
        assert!(fake.calls.load(Ordering::SeqCst) >= 1);
    }

    #[tokio::test]
    async fn index_file_reports_embedding_failure() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file_path = dir.path().join("broken.txt");
        let body = "Payment is due within thirty days of the invoice date. ".repeat(4);
        std::fs::write(&file_path, &body).expect("write");
        let info = FileInfo {
            path: file_path,
            mtime: 1,
            size: body.len() as u64,
        };
        let source_id = db(dir.path(), |s| s.ensure_source("/broken", "default"))
            .await
            .expect("source");
        let fake = Fake {
            calls: AtomicUsize::new(0),
            fail: true,
        };

        let outcome = index_file(dir.path(), &fake, source_id, &info, "nomic", None).await;
        assert!(matches!(outcome, Err(Failure::Embed(ref m)) if m.contains("500")));
    }
}
