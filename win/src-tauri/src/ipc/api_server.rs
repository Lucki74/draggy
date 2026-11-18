//! The local API server: an OpenAI-style endpoint on 127.0.0.1 that answers with the local engine. The renderer does
//! the generating, so each request goes to it as an event and its text comes back on the `api-server:*` channels.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use draggy_api::server::{
    Backend, BackendError, ByteStream, CompletionRequest, DEFAULT_PORT, Env, ForwardReply, HOST,
    Mode, ModelEntry, Reply, Sink, Usage,
};
use draggy_providers::registry::Keystore;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::ipc::providers::adapters::AppKeys;

const CONFIG_KEY: &str = "apiServer";
const KEY_OWNER: &str = "__draggy_api_server";
const REPLY_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const STARTING: &str = "Draggy is still starting. Try again in a moment.";
const TOO_LONG: &str = "The reply took too long.";
const GONE: &str = "The client went away.";
const FAILED: &str = "The reply failed.";
const GATEWAY_DOWN: &str = "The model gateway is not running.";
const PREPARE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// One request waiting on the renderer. The sink takes the text as it arrives; `finish` takes the outcome.
struct Pending {
    sink: Sink,
    finish: Option<oneshot::Sender<Result<Reply, BackendError>>>,
}

static PENDING: Mutex<Option<HashMap<String, Pending>>> = Mutex::new(None);
static READY: AtomicBool = AtomicBool::new(false);
static MODEL_MODE: AtomicBool = AtomicBool::new(false);
type Prepared = oneshot::Sender<Result<String, String>>;
static PREPARING: Mutex<Option<HashMap<String, Prepared>>> = Mutex::new(None);
static KEY: Mutex<String> = Mutex::new(String::new());
static SERVER: Mutex<Option<(u16, tauri::async_runtime::JoinHandle<()>)>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "api-server:status" => status);
    register!(registry, "api-server:configure" => configure);
    register!(registry, "api-server:regenerate-key" => regenerate_key);
    register!(registry, "api-server:ready" => ready);
    register!(registry, "api-server:text" => text);
    register!(registry, "api-server:model" => model);
    register!(registry, "api-server:done" => done);
    register!(registry, "api-server:failed" => failed);
    register!(registry, "api-server:prepared" => prepared);
}

/// Starts the server if the saved settings turn it on. Called once at launch.
pub fn apply_saved(app: &AppHandle) {
    apply(app);
}

/// Stops the server and fails every waiting request. Called on app exit.
pub fn stop_all() {
    if let Some((_, task)) = SERVER.lock().unwrap_or_else(|p| p.into_inner()).take() {
        task.abort();
    }
    let waiting = PENDING.lock().unwrap_or_else(|p| p.into_inner()).take();
    drop(waiting);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Config {
    enabled: bool,
    port: u16,
    /// Plain requests go to the model alone instead of the agent.
    model_mode: bool,
}

async fn status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(status_value(&app))
}

async fn configure(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let input = args.first().cloned().unwrap_or(Value::Null);
    // A call that names only some fields keeps the saved rest.
    let saved = read_config(&app);
    let config = Config {
        enabled: input
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(saved.enabled),
        port: input.get("port").map_or(saved.port, |port| port_from(Some(port))),
        model_mode: input
            .get("mode")
            .and_then(Value::as_str)
            .map_or(saved.model_mode, |mode| mode == "model"),
    };
    save_config(&app, config);
    apply(&app);
    Ok(status_value(&app))
}

async fn regenerate_key(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let key = new_key();
    store_key(&app, &key);
    *KEY.lock().unwrap_or_else(|p| p.into_inner()) = key;
    Ok(status_value(&app))
}

async fn ready(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    READY.store(true, Ordering::SeqCst);
    Ok(json!({ "success": true }))
}

async fn text(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = arg_text(&args, 0);
    let chunk = arg_text(&args, 1);
    with_pending(&id, |pending| pending.sink.text(&chunk));
    Ok(json!({ "success": true }))
}

async fn model(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = arg_text(&args, 0);
    let name = arg_text(&args, 1);
    with_pending(&id, |pending| pending.sink.model(&name));
    Ok(json!({ "success": true }))
}

async fn done(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = arg_text(&args, 0);
    let result = args.get(1).cloned().unwrap_or(Value::Null);
    let reply = Reply {
        model: result
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        content: result
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        usage: Usage {
            prompt_tokens: result["usage"]["promptTokens"].as_u64().unwrap_or(0),
            response_tokens: result["usage"]["responseTokens"].as_u64().unwrap_or(0),
        },
    };
    if let Some(finish) = take_pending(&id).and_then(|pending| pending.finish) {
        let _ = finish.send(Ok(reply));
    }
    Ok(json!({ "success": true }))
}

async fn prepared(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = arg_text(&args, 0);
    let model = arg_text(&args, 1);
    let message = arg_text(&args, 2);
    let waiting = PREPARING
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
        .and_then(|map| map.remove(&id));
    if let Some(waiting) = waiting {
        let _ = waiting.send(if message.is_empty() {
            Ok(model)
        } else {
            Err(message)
        });
    }
    Ok(json!({ "success": true }))
}

async fn failed(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = arg_text(&args, 0);
    let message = arg_text(&args, 1);
    let message = if message.is_empty() {
        FAILED.to_owned()
    } else {
        message
    };
    if let Some(finish) = take_pending(&id).and_then(|pending| pending.finish) {
        let _ = finish.send(Err(BackendError { message }));
    }
    Ok(json!({ "success": true }))
}

fn arg_text(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn with_pending(id: &str, act: impl FnOnce(&Pending)) {
    let guard = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(pending) = guard.as_ref().and_then(|map| map.get(id)) {
        act(pending);
    }
}

fn take_pending(id: &str) -> Option<Pending> {
    PENDING
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
        .and_then(|map| map.remove(id))
}

/// The status the renderer sees. The key is shown only while the server is on.
fn status_value(app: &AppHandle) -> Value {
    let config = read_config(app);
    let running = SERVER.lock().unwrap_or_else(|p| p.into_inner()).is_some();
    let error = LAST_ERROR.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let mut status = json!({
        "success": true,
        "enabled": config.enabled,
        "port": config.port,
        "mode": if config.model_mode { "model" } else { "agent" },
        "running": running,
        "baseUrl": format!("http://{HOST}:{}/v1", config.port),
        "error": error,
    });
    if config.enabled {
        status["key"] = json!(current_key());
    }
    status
}

/// Brings the server in line with the saved settings: stops it, then starts it when enabled.
fn apply(app: &AppHandle) {
    if let Some((_, task)) = SERVER.lock().unwrap_or_else(|p| p.into_inner()).take() {
        task.abort();
    }
    *LAST_ERROR.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let config = read_config(app);
    MODEL_MODE.store(config.model_mode, Ordering::SeqCst);
    if !config.enabled {
        return;
    }
    if current_key().is_empty() {
        let key = load_or_make_key(app);
        *KEY.lock().unwrap_or_else(|p| p.into_inner()) = key;
    }
    let listener = match std::net::TcpListener::bind((HOST, config.port)) {
        Ok(listener) => listener,
        Err(error) => {
            let message = draggy_api::server::listen_failure(&error, config.port);
            *LAST_ERROR.lock().unwrap_or_else(|p| p.into_inner()) = Some(message.clone());
            log(
                app,
                "warn",
                "api server did not start",
                Some(json!({ "port": config.port })),
            );
            return;
        }
    };
    let _ = listener.set_nonblocking(true);
    let port = config.port;
    let bridge = Bridge(app.clone());
    let task = tauri::async_runtime::spawn(async move {
        let Ok(socket) = tokio::net::TcpListener::from_std(listener) else {
            return;
        };
        let router = draggy_api::server::router(port, bridge, Keys);
        let _ = axum::serve(socket, router).await;
    });
    *SERVER.lock().unwrap_or_else(|p| p.into_inner()) = Some((port, task));
    log(
        app,
        "info",
        "api server listening",
        Some(json!({ "port": port })),
    );
}

/// The bridge to the renderer: it takes the request as an event and answers on the channels above.
struct Bridge(AppHandle);

impl Backend for Bridge {
    async fn list_models(&self) -> Result<Vec<ModelEntry>, BackendError> {
        let app = self.0.clone();
        let listed = tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<AppState>();
            let projectors = crate::engines::locked(&state.engines.projectors);
            let mut cache = crate::engines::locked(&state.engines.capabilities);
            draggy_models::model_storage::list_gguf_models(
                &state.engines.models_dir,
                &projectors,
                &mut cache,
            )
            .map(|list| {
                list.into_iter()
                    .map(|entry| ModelEntry {
                        id: entry.filename,
                        owned_by: "local".to_owned(),
                        context_length: entry.context_length.map(|length| length as u64),
                        capabilities: entry.capabilities,
                    })
                    .collect::<Vec<ModelEntry>>()
            })
            .map_err(|_| BackendError {
                message: "The models could not be listed.".to_owned(),
            })
        })
        .await;
        listed.unwrap_or_else(|_| {
            Err(BackendError {
                message: "The models could not be listed.".to_owned(),
            })
        })
    }

    async fn generate(
        &self,
        request: CompletionRequest,
        sink: Sink,
        cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        if !READY.load(Ordering::SeqCst) {
            return Err(BackendError {
                message: STARTING.to_owned(),
            });
        }
        let id = new_id();
        let (finish, outcome) = oneshot::channel();
        PENDING
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(
                id.clone(),
                Pending {
                    sink,
                    finish: Some(finish),
                },
            );
        emit(
            &self.0,
            "api-server:request",
            json!({ "id": id, "request": request }),
        );

        tokio::select! {
            () = cancel.cancelled() => {
                take_pending(&id);
                emit(&self.0, "api-server:abort", json!(id));
                Err(BackendError { message: GONE.to_owned() })
            }
            waited = tokio::time::timeout(REPLY_TIMEOUT, outcome) => match waited {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err(BackendError { message: FAILED.to_owned() }),
                Err(_) => {
                    take_pending(&id);
                    emit(&self.0, "api-server:abort", json!(id));
                    Err(BackendError { message: TOO_LONG.to_owned() })
                }
            }
        }
    }

    async fn prepare_model(
        &self,
        requested: &str,
        cancel: CancellationToken,
    ) -> Result<String, BackendError> {
        if !READY.load(Ordering::SeqCst) {
            return Err(BackendError {
                message: STARTING.to_owned(),
            });
        }
        let id = new_id();
        let (reply, outcome) = oneshot::channel();
        PREPARING
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(id.clone(), reply);
        emit(
            &self.0,
            "api-server:prepare",
            json!({ "id": id, "model": requested }),
        );
        let forget = || {
            if let Some(map) = PREPARING.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
                map.remove(&id);
            }
        };
        tokio::select! {
            () = cancel.cancelled() => {
                forget();
                Err(BackendError { message: GONE.to_owned() })
            }
            waited = tokio::time::timeout(PREPARE_TIMEOUT, outcome) => match waited {
                Ok(Ok(Ok(model))) => Ok(model),
                Ok(Ok(Err(message))) => Err(BackendError { message }),
                Ok(Err(_)) => Err(BackendError { message: FAILED.to_owned() }),
                Err(_) => {
                    forget();
                    Err(BackendError { message: TOO_LONG.to_owned() })
                }
            }
        }
    }

    async fn forward(
        &self,
        body: Value,
        cancel: CancellationToken,
    ) -> Result<ForwardReply, BackendError> {
        let Some(gateway) = self.0.try_state::<crate::chat_gateway::ChatGateway>() else {
            return Err(BackendError {
                message: GATEWAY_DOWN.to_owned(),
            });
        };
        let info = gateway.info().clone();
        let sent = reqwest::Client::new()
            .post(format!("{}/chat", info.url))
            .bearer_auth(&info.token)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send();
        let response = tokio::select! {
            () = cancel.cancelled() => {
                return Err(BackendError { message: GONE.to_owned() });
            }
            sent = sent => sent.map_err(|_| BackendError { message: FAILED.to_owned() })?,
        };
        let status = response.status().as_u16();
        // Dropping the stream drops the response, which closes the call and stops the engine.
        let stream: ByteStream = Box::pin(futures_util::stream::unfold(
            (Some(response), cancel),
            |(response, cancel)| async move {
                let mut response = response?;
                let chunk = tokio::select! {
                    () = cancel.cancelled() => return None,
                    chunk = response.chunk() => chunk,
                };
                match chunk {
                    Ok(Some(bytes)) => Some((Ok(Bytes::from(bytes)), (Some(response), cancel))),
                    Ok(None) => None,
                    Err(_) => Some((
                        Err(BackendError { message: FAILED.to_owned() }),
                        (None, cancel),
                    )),
                }
            },
        ));
        Ok(ForwardReply { status, body: stream })
    }
}

/// Reads the key and the clock for each request. The key is the one in memory, never the keystore.
struct Keys;

impl Env for Keys {
    fn api_key(&self) -> String {
        current_key()
    }

    fn now_unix(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs() as i64)
    }

    fn fill_random(&self, buffer: &mut [u8]) {
        let _ = getrandom::fill(buffer);
    }

    fn default_mode(&self) -> Mode {
        if MODEL_MODE.load(Ordering::SeqCst) {
            Mode::Model
        } else {
            Mode::Agent
        }
    }
}

fn current_key() -> String {
    KEY.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

fn new_key() -> String {
    let mut random = [0u8; 24];
    let _ = getrandom::fill(&mut random);
    draggy_api::server::generate_key(&random)
}

fn new_id() -> String {
    let mut random = [0u8; 12];
    let _ = getrandom::fill(&mut random);
    random.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The key lives in the shared keystore under its own owner. Without one, it lasts the launch.
fn load_or_make_key(app: &AppHandle) -> String {
    let keys = AppKeys { app: app.clone() };
    if let Some(saved) = keys.get(KEY_OWNER) {
        return saved;
    }
    let key = new_key();
    store_key(app, &key);
    key
}

fn store_key(app: &AppHandle, key: &str) {
    let mut keys = AppKeys { app: app.clone() };
    if !keys.set(KEY_OWNER, Some(key)) {
        log(app, "warn", "api key kept for this launch only", None);
    }
}

fn read_config(app: &AppHandle) -> Config {
    let raw = app
        .state::<AppState>()
        .storage
        .handle()
        .and_then(|storage| storage.get_value(CONFIG_KEY).ok().flatten());
    let value = raw.and_then(|text| serde_json::from_str::<Value>(&text).ok());
    Config {
        enabled: value
            .as_ref()
            .and_then(|value| value.get("enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        port: port_from(value.as_ref().and_then(|value| value.get("port"))),
        model_mode: value
            .as_ref()
            .and_then(|value| value.get("mode"))
            .and_then(Value::as_str)
            == Some("model"),
    }
}

fn save_config(app: &AppHandle, config: Config) {
    let mode = if config.model_mode { "model" } else { "agent" };
    let value =
        json!({ "enabled": config.enabled, "port": config.port, "mode": mode }).to_string();
    let Some(storage) = app.state::<AppState>().storage.handle() else {
        return;
    };
    if storage.set_value(CONFIG_KEY, &value).is_err() {
        log(app, "warn", "api server settings not saved", None);
    }
}

/// A port in the user range, or the default when the value is missing or outside it.
fn port_from(value: Option<&Value>) -> u16 {
    value
        .and_then(Value::as_u64)
        .filter(|port| (1024..=65535).contains(port))
        .map_or(DEFAULT_PORT, |port| port as u16)
}

fn log(app: &AppHandle, level: &str, message: &str, data: Option<Value>) {
    let state = app.state::<AppState>();
    match level {
        "warn" => state.diag.warn("apiServer", message, data),
        _ => state.diag.info("apiServer", message, data),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_user_range_ports() {
        assert_eq!(port_from(Some(&json!(8080))), 8080);
        assert_eq!(port_from(Some(&json!(80))), DEFAULT_PORT);
        assert_eq!(port_from(Some(&json!(70000))), DEFAULT_PORT);
        assert_eq!(port_from(Some(&json!("8080"))), DEFAULT_PORT);
        assert_eq!(port_from(None), DEFAULT_PORT);
    }

    #[test]
    fn new_ids_are_hex_and_distinct() {
        let first = new_id();
        let second = new_id();
        assert_eq!(first.len(), 24);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn new_keys_carry_the_prefix_and_differ() {
        let first = new_key();
        assert!(first.starts_with("draggy-"));
        assert_ne!(first, new_key());
    }
}
