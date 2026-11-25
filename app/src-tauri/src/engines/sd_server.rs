//! The stable-diffusion server: one process on loopback, image jobs run one at a time, cancel and stop.

use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use base64::Engine as _;
use draggy_engine::engine_host::EngineControl;
use draggy_engine::supervisor::{SpawnPlan, StartResult, Supervisor};
use serde_json::{Value, json};
use tokio::sync::Mutex as AsyncMutex;

use super::locked;
use super::sd::{self, SdError};

const POLL: Duration = Duration::from_millis(400);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const PATIENCE: Duration = Duration::from_secs(600);

/// Decrements the pending count when a generate call ends, however it ends.
struct Pending<'a>(&'a AtomicUsize);

impl Drop for Pending<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The stable-diffusion server process. Jobs queue behind one lock, so the engine only ever draws one image.
pub struct SdServer {
    supervisor: Supervisor,
    served: Mutex<Option<(String, u16)>>,
    http: reqwest::Client,
    queue: AsyncMutex<()>,
    pending: AtomicUsize,
    /// Request id to engine job id. The job id is None until the job is posted.
    jobs: Mutex<HashMap<String, Option<String>>>,
    cancelled: Mutex<HashSet<String>>,
    /// Set when a job stopped the chat model to make room. The engine holds that memory until it stops.
    took_chat_memory: AtomicBool,
}

impl Default for SdServer {
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

impl SdServer {
    pub fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
            served: Mutex::new(None),
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            queue: AsyncMutex::new(()),
            pending: AtomicUsize::new(0),
            jobs: Mutex::new(HashMap::new()),
            cancelled: Mutex::new(HashSet::new()),
            took_chat_memory: AtomicBool::new(false),
        }
    }

    /// Starts the server with a model's arguments and waits until it reports ready, within `deadline`.
    pub async fn start(
        &self,
        binary: &Path,
        model_args: &[String],
        model: &str,
        deadline: Duration,
        env: &[(String, String)],
    ) -> Result<(), SdError> {
        // Replacing the engine does not give the chat model its memory back; the new one takes it over.
        let holds_chat_memory = self.took_chat_memory.load(Ordering::SeqCst);
        self.stop().await;
        self.took_chat_memory
            .store(holds_chat_memory, Ordering::SeqCst);
        let port = free_port().ok_or_else(|| SdError {
            code: "E_ENGINE_START",
            message: "The image engine did not start".into(),
        })?;
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
        let mut args = model_args.to_vec();
        args.extend(
            [
                "--listen-ip",
                "127.0.0.1",
                "--listen-port",
                &port.to_string(),
                "-t",
                &threads.to_string(),
            ]
            .map(str::to_owned),
        );
        let plan = SpawnPlan {
            program: binary.to_path_buf(),
            args,
            cwd: binary.parent().map(Path::to_path_buf),
            env: env.iter().map(|(k, v)| (k.into(), v.into())).collect(),
            port,
            ready_path: sd::READY_PATH,
            model: model.to_owned(),
            timeout: deadline,
        };
        match self.supervisor.start(plan).await {
            StartResult::Ready => {
                *locked(&self.served) = Some((model.to_owned(), port));
                Ok(())
            }
            StartResult::Failed { output } => {
                let reason = output.lines().rev().find(|l| !l.trim().is_empty());
                let message = match reason {
                    Some(line) => format!("The image engine did not start: {}", line.trim()),
                    None => "The image engine did not start".into(),
                };
                Err(SdError {
                    code: "E_ENGINE_START",
                    message,
                })
            }
        }
    }

    /// Stops the process and forgets the model it served.
    pub async fn stop(&self) {
        *locked(&self.served) = None;
        self.took_chat_memory.store(false, Ordering::SeqCst);
        self.supervisor.stop().await;
    }

    /// Records that a job stopped the chat model to make room, so the engine holds that memory until it stops.
    pub fn set_took_chat_memory(&self, took: bool) {
        self.took_chat_memory.store(took, Ordering::SeqCst);
    }

    /// Jobs waiting or drawing, counting the one in progress.
    pub fn pending_jobs(&self) -> usize {
        self.pending.load(Ordering::SeqCst)
    }

    /// Called before the chat model starts. If images pushed it out, waits for the running job, then stops the
    /// engine so the chat model gets the GPU back. Returns whether that happened.
    pub async fn yield_to_chat(&self) -> bool {
        if !self.took_chat_memory.load(Ordering::SeqCst) {
            return false;
        }
        let _queued = self.queue.lock().await;
        self.stop().await;
        true
    }

    /// The `sd:status` server block.
    pub fn status(&self) -> Value {
        let running = self.supervisor.status().running;
        let served = locked(&self.served).clone();
        sd::server_status(
            running,
            served.as_ref().map(|(model, _)| model.as_str()),
            self.pending.load(Ordering::SeqCst),
        )
    }

    /// The engine's own description of itself, including its size limits. Null when it does not answer.
    pub async fn capabilities(&self) -> Value {
        match self.call(reqwest::Method::GET, sd::READY_PATH, None).await {
            Ok((200, value)) => value,
            _ => Value::Null,
        }
    }

    /// The model the server holds, when it runs.
    pub fn loaded_model(&self) -> Option<String> {
        locked(&self.served)
            .as_ref()
            .map(|(model, _)| model.clone())
    }

    fn base(&self) -> Option<String> {
        locked(&self.served)
            .as_ref()
            .map(|(_, port)| format!("http://127.0.0.1:{port}"))
    }

    /// One request to the server. Returns the status code and the JSON body, when there is one.
    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<(u16, Value), String> {
        let base = self.base().ok_or("The image engine is not running")?;
        let mut request = self.http.request(method, format!("{base}{path}"));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let value = response.json::<Value>().await.unwrap_or(Value::Null);
        Ok((status, value))
    }

    /// Cancels a request. A queued one is dropped before it is sent; a running one is asked to stop.
    pub async fn cancel(&self, request_id: &str) -> bool {
        let job = match locked(&self.jobs).get(request_id) {
            None => return false,
            Some(job) => job.clone(),
        };
        locked(&self.cancelled).insert(request_id.to_owned());
        let Some(job_id) = job else {
            return true;
        };
        match self
            .call(
                reqwest::Method::POST,
                &format!("/sdcpp/v1/jobs/{job_id}/cancel"),
                None,
            )
            .await
        {
            Ok((status, _)) => (200..300).contains(&status),
            Err(_) => false,
        }
    }

    /// Runs one image job and returns its PNG bytes. `progress` gets queued and generating events.
    pub async fn generate(
        &self,
        request_id: &str,
        body: Value,
        progress: &(dyn Fn(Value) + Sync),
    ) -> Result<Vec<u8>, SdError> {
        self.pending.fetch_add(1, Ordering::SeqCst);
        let _count = Pending(&self.pending);
        let waiting = self.pending.load(Ordering::SeqCst);
        if waiting > 1 {
            progress(json!({ "status": "queued", "position": waiting - 1 }));
        }
        locked(&self.jobs).insert(request_id.to_owned(), None);
        let result = self.run_queued(request_id, body, progress).await;
        locked(&self.jobs).remove(request_id);
        locked(&self.cancelled).remove(request_id);
        result
    }

    async fn run_queued(
        &self,
        request_id: &str,
        body: Value,
        progress: &(dyn Fn(Value) + Sync),
    ) -> Result<Vec<u8>, SdError> {
        let _turn = self.queue.lock().await;
        if locked(&self.cancelled).contains(request_id) {
            return Err(cancelled());
        }
        let (status, reply) = self
            .call(reqwest::Method::POST, "/sdcpp/v1/img_gen", Some(body))
            .await
            .map_err(|message| engine_error(&message))?;
        if status == 429 {
            return Err(SdError {
                code: "E_BUSY",
                message: "The image engine queue is full".into(),
            });
        }
        let job_id = reply
            .get("id")
            .and_then(Value::as_str)
            .filter(|_| status == 202)
            .ok_or_else(|| engine_error("The image engine refused the job"))?
            .to_owned();
        locked(&self.jobs).insert(request_id.to_owned(), Some(job_id.clone()));
        self.poll(&job_id, progress).await
    }

    async fn poll(
        &self,
        job_id: &str,
        progress: &(dyn Fn(Value) + Sync),
    ) -> Result<Vec<u8>, SdError> {
        let mut last_state = String::new();
        let mut last_answer = Instant::now();
        loop {
            if self.base().is_none() || !self.supervisor.status().running {
                return Err(crashed());
            }
            tokio::time::sleep(POLL).await;
            let polled = self
                .call(
                    reqwest::Method::GET,
                    &format!("/sdcpp/v1/jobs/{job_id}"),
                    None,
                )
                .await;
            let (status, job) = match polled {
                Ok(answer) => {
                    last_answer = Instant::now();
                    answer
                }
                // The server does not answer while it decodes; that is busy, not failed.
                Err(message) => {
                    if !self.supervisor.status().running {
                        return Err(crashed());
                    }
                    if last_answer.elapsed() < PATIENCE {
                        continue;
                    }
                    return Err(engine_error(&message));
                }
            };
            if status == 404 || status == 410 {
                return Err(engine_error("The image engine lost the job"));
            }
            let state = job
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if state != last_state || state == "queued" {
                last_state.clone_from(&state);
                match state.as_str() {
                    "queued" => progress(json!({
                        "status": "queued",
                        "position": job.get("queue_position").and_then(Value::as_u64).unwrap_or(0),
                    })),
                    "generating" => progress(json!({ "status": "generating" })),
                    _ => {}
                }
            }
            match state.as_str() {
                "completed" => {
                    let encoded = job
                        .pointer("/result/images/0/b64_json")
                        .and_then(Value::as_str)
                        .ok_or_else(|| engine_error("The image engine returned no image"))?;
                    return base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|e| engine_error(&e.to_string()));
                }
                "cancelled" => return Err(cancelled()),
                "failed" => {
                    let message = job
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Generation failed");
                    return Err(engine_error(message));
                }
                _ => {}
            }
        }
    }
}

fn cancelled() -> SdError {
    SdError {
        code: "E_CANCELLED",
        message: "Cancelled".into(),
    }
}

fn crashed() -> SdError {
    SdError {
        code: "E_CRASH",
        message: "The image engine stopped during the job".into(),
    }
}

fn engine_error(message: &str) -> SdError {
    SdError {
        code: "E_FAILED",
        message: message.to_owned(),
    }
}
