//! The embedding server: one llama-server with --embedding on loopback, started on first use and stopped after a
//! minute idle.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use draggy_engine::cpu_topology::CpuTopology;
use draggy_engine::engine_host::EngineControl;
use draggy_engine::supervisor::{SpawnPlan, StartResult, Supervisor};
use serde_json::{Value, json};
use tokio::sync::Mutex as AsyncMutex;

use draggy_engine::llama_flags::engine_flags;

use super::{ENGINE_FLAGS, EngineSetup, RUNNER, locked};

const READY_TIMEOUT: Duration = Duration::from_secs(60);
const IDLE: Duration = Duration::from_secs(60);
const PING_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const READY_PATH: &str = "/health";
const NO_ENGINE: &str = "The AI engine is not installed yet.";
const SHAPE: &str = "Embedding model returned an unexpected shape";

/// The embedding llama-server. Starts are serialised; the process stops after `IDLE` with no use.
pub struct EmbedServer {
    supervisor: Supervisor,
    /// The model file served, and its port.
    served: Arc<Mutex<Option<(String, u16)>>>,
    /// Bumped on every use; an idle timer stops the server only when no later use came.
    generation: Arc<AtomicU64>,
    starting: AsyncMutex<()>,
    http: reqwest::Client,
}

impl Default for EmbedServer {
    fn default() -> Self {
        Self::new()
    }
}

/// A free loopback port, picked by the OS.
fn free_port() -> Option<u16> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .ok()
}

/// The `.gguf` files in a folder, by name. Empty when the folder cannot be read.
fn gguf_names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.to_lowercase().ends_with(".gguf"))
                .collect()
        })
        .unwrap_or_default()
}

fn stem_of(name: &str) -> String {
    let lower = name.to_lowercase();
    lower
        .strip_suffix(".gguf")
        .unwrap_or(lower.as_str())
        .to_owned()
}

/// The file an embedding model name stands for: that exact file, else the first of that family.
pub fn resolve_model_file(names: &[String], model: &str) -> Option<String> {
    let wanted = model.trim().to_lowercase();
    if wanted.is_empty() {
        return None;
    }
    let mut files: Vec<&str> = names
        .iter()
        .map(String::as_str)
        .filter(|name| name.to_lowercase().ends_with(".gguf"))
        .collect();
    files.sort_unstable();
    let exact = files
        .iter()
        .find(|name| name.to_lowercase() == wanted || stem_of(name) == wanted);
    let family = || files.iter().find(|name| stem_of(name).starts_with(&wanted));
    exact.or_else(family).map(|name| (*name).to_owned())
}

/// Whether the model's file is in the models folder.
pub fn model_present(models_dir: &Path, model: &str) -> bool {
    resolve_model_file(&gguf_names(models_dir), model).is_some()
}

/// Arguments for the server: embedding only, and the chat model's thread split. The prompt cache is switched
/// off with `--cache-ram 0` only when the binary has that flag.
pub fn server_args(file: &str, port: u16, cores: CpuTopology, cache_ram: bool) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-m".into(),
        file.into(),
        "--port".into(),
        port.to_string(),
        "--host".into(),
        "127.0.0.1".into(),
        "--embedding".into(),
        "-c".into(),
        "8192".into(),
        "--parallel".into(),
        "4".into(),
        "-b".into(),
        "2048".into(),
        "-ub".into(),
        "2048".into(),
        "-t".into(),
        cores.performance.to_string(),
        "-tb".into(),
        cores.performance.max(cores.physical).to_string(),
    ];
    if cache_ram {
        args.extend(["--cache-ram".into(), "0".into()]);
    }
    args
}

/// The last non-blank line of the engine's output, as the reason a start failed.
fn failure_reason(output: &str) -> Option<String> {
    output
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_owned())
}

pub fn embeddings_body(model: &str, inputs: &[String]) -> Value {
    json!({ "input": inputs, "model": model })
}

/// The vectors of an OpenAI-style embeddings reply, one per input, in order.
pub fn parse_embeddings(body: &Value, expected: usize) -> Result<Vec<Vec<f32>>, String> {
    let rows = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| SHAPE.to_owned())?;
    let vectors = rows
        .iter()
        .map(|entry| {
            entry["embedding"].as_array().map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_f64)
                    .map(|v| v as f32)
                    .collect::<Vec<f32>>()
            })
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| SHAPE.to_owned())?;
    if vectors.len() != expected {
        return Err(SHAPE.to_owned());
    }
    Ok(vectors)
}

impl EmbedServer {
    pub fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
            served: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            starting: AsyncMutex::new(()),
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
        }
    }

    /// Vectors for `inputs` from the named model, starting the server when it is not already serving it.
    pub async fn embed(
        &self,
        binary: Option<PathBuf>,
        models_dir: &Path,
        cores: CpuTopology,
        model: &str,
        inputs: &[String],
        setup: &EngineSetup,
    ) -> Result<Vec<Vec<f32>>, String> {
        let port = self.ensure(binary, models_dir, cores, model, setup).await?;
        let response = self
            .http
            .post(format!("http://127.0.0.1:{port}/v1/embeddings"))
            .json(&embeddings_body(model, inputs))
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
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| SHAPE.to_owned())?;
        parse_embeddings(&body, inputs.len())
    }

    async fn ensure(
        &self,
        binary: Option<PathBuf>,
        models_dir: &Path,
        cores: CpuTopology,
        model: &str,
        setup: &EngineSetup,
    ) -> Result<u16, String> {
        let shown = if model.is_empty() { "(none)" } else { model };
        let file = resolve_model_file(&gguf_names(models_dir), model)
            .ok_or_else(|| format!("The embedding model {shown} is not downloaded."))?;
        self.touch();

        let _turn = self.starting.lock().await;
        if let Some(port) = self.live_port(&file).await {
            return Ok(port);
        }
        let binary = binary.ok_or_else(|| NO_ENGINE.to_owned())?;
        self.launch(&binary, &models_dir.join(&file), &file, cores, setup)
            .await
    }

    /// The port of the running server when it serves `file` and answers its health route.
    async fn live_port(&self, file: &str) -> Option<u16> {
        let (served, port) = locked(&self.served).clone()?;
        if served != file || !self.supervisor.status().running {
            return None;
        }
        let healthy = self
            .http
            .get(format!("http://127.0.0.1:{port}{READY_PATH}"))
            .timeout(PING_TIMEOUT)
            .send()
            .await
            .is_ok_and(|response| response.status().is_success());
        healthy.then_some(port)
    }

    async fn launch(
        &self,
        binary: &Path,
        path: &Path,
        file: &str,
        cores: CpuTopology,
        setup: &EngineSetup,
    ) -> Result<u16, String> {
        self.stop().await;
        let port = free_port().ok_or_else(|| "The embedding engine did not start.".to_owned())?;
        let flags = engine_flags(
            &RUNNER,
            &ENGINE_FLAGS,
            binary,
            &setup.env,
            Some(&setup.user_data),
        )
        .await;
        let cache_ram = flags.is_some_and(|flags| flags.contains("--cache-ram"));
        let plan = SpawnPlan {
            program: binary.to_path_buf(),
            args: server_args(&path.to_string_lossy(), port, cores, cache_ram),
            cwd: binary.parent().map(Path::to_path_buf),
            env: setup
                .env
                .iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
            port,
            ready_path: READY_PATH,
            model: file.to_owned(),
            timeout: READY_TIMEOUT,
        };
        match self.supervisor.start(plan).await {
            StartResult::Ready => {
                *locked(&self.served) = Some((file.to_owned(), port));
                Ok(port)
            }
            StartResult::Failed { output } => Err(match failure_reason(&output) {
                Some(reason) => format!("The embedding engine did not start: {reason}"),
                None => "The embedding engine did not start.".to_owned(),
            }),
        }
    }

    /// Restarts the idle clock; the timer stops the server only if no later use reset it.
    fn touch(&self) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let latest = Arc::clone(&self.generation);
        let served = Arc::clone(&self.served);
        let supervisor = self.supervisor.clone();
        tokio::spawn(async move {
            tokio::time::sleep(IDLE).await;
            if latest.load(Ordering::SeqCst) == generation {
                *locked(&served) = None;
                supervisor.stop().await;
            }
        });
    }

    /// Stops the process and forgets the model it served.
    pub async fn stop(&self) {
        *locked(&self.served) = None;
        self.supervisor.stop().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn exact_name_and_stem_win_over_prefix() {
        let files = names(&["nomic-embed-text-v1.5.Q4_K_M.gguf", "nomic-embed-text.gguf"]);
        assert_eq!(
            resolve_model_file(&files, "nomic-embed-text.gguf").as_deref(),
            Some("nomic-embed-text.gguf")
        );
        assert_eq!(
            resolve_model_file(&files, "NOMIC-EMBED-TEXT").as_deref(),
            Some("nomic-embed-text.gguf")
        );
    }

    #[test]
    fn family_prefix_picks_first_sorted_match() {
        let files = names(&[
            "nomic-embed-text-v1.5.Q4_K_M.gguf",
            "nomic-embed-text-v1.5.Q8_0.gguf",
        ]);
        assert_eq!(
            resolve_model_file(&files, "nomic-embed-text").as_deref(),
            Some("nomic-embed-text-v1.5.Q4_K_M.gguf")
        );
    }

    #[test]
    fn missing_or_blank_model_resolves_to_none() {
        let files = names(&["chat.gguf", "notes.txt"]);
        assert_eq!(resolve_model_file(&files, "nomic-embed-text"), None);
        assert_eq!(resolve_model_file(&files, "   "), None);
        assert_eq!(resolve_model_file(&names(&["notes.txt"]), "notes"), None);
    }

    #[test]
    fn parses_ordered_vectors() {
        let body = json!({ "data": [ { "embedding": [1.0, 2.0] }, { "embedding": [3.0, 4.5] } ] });
        let vectors = parse_embeddings(&body, 2).expect("two vectors");
        assert_eq!(vectors, vec![vec![1.0, 2.0], vec![3.0, 4.5]]);
    }

    #[test]
    fn rejects_wrong_count_or_missing_embedding() {
        let short = json!({ "data": [ { "embedding": [1.0] } ] });
        assert_eq!(parse_embeddings(&short, 2).unwrap_err(), SHAPE);
        let broken = json!({ "data": [ { "vector": [1.0] } ] });
        assert_eq!(parse_embeddings(&broken, 1).unwrap_err(), SHAPE);
        assert_eq!(parse_embeddings(&json!({}), 1).unwrap_err(), SHAPE);
    }

    #[test]
    fn request_body_carries_model_and_inputs() {
        let body = embeddings_body("nomic", &["a".to_owned(), "b".to_owned()]);
        assert_eq!(body, json!({ "input": ["a", "b"], "model": "nomic" }));
    }

    #[test]
    fn args_bind_loopback_and_split_threads() {
        let cores = CpuTopology {
            logical: 16,
            physical: 8,
            performance: 6,
        };
        let args = server_args("C:/m/e.gguf", 5005, cores, true);
        let pair = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .map(|i| args[i + 1].clone())
        };
        assert_eq!(pair("--host").as_deref(), Some("127.0.0.1"));
        assert_eq!(pair("--port").as_deref(), Some("5005"));
        assert_eq!(pair("-t").as_deref(), Some("6"));
        assert_eq!(pair("-tb").as_deref(), Some("8"));
        assert!(args.contains(&"--embedding".to_owned()));
    }

    #[test]
    fn failure_reason_is_last_non_blank_line() {
        assert_eq!(
            failure_reason("a\n\nerror: boom  \n\n").as_deref(),
            Some("error: boom")
        );
        assert_eq!(failure_reason("  \n"), None);
    }
}
