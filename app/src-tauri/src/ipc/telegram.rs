//! The Telegram settings channels and the bridge to the renderer. The bot token is written here and
//! never read back: the renderer only learns whether one is saved.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use super::web::keys;
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::gateway::telegram::{
    Command, Event, HttpTransport, LoopState, Paired, Runner, Sink, State, Transport, poll_loop,
};
use tauri::Manager;

/// The least time between two messages to one chat.
const SEND_GAP: Duration = Duration::from_millis(1100);

#[derive(Default, Serialize, Deserialize)]
struct Config {
    enabled: bool,
    paired: Vec<Paired>,
}

#[derive(Default)]
struct Info {
    bot: String,
    error: String,
    running: bool,
}

struct Live {
    runner: Arc<Runner>,
    cancel: CancellationToken,
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static INFO: Mutex<Info> = Mutex::new(Info {
    bot: String::new(),
    error: String::new(),
    running: false,
});
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "telegram:status" => status);
    register!(registry, "telegram:set-token" => set_token);
    register!(registry, "telegram:set-enabled" => set_enabled);
    register!(registry, "telegram:pair-start" => pair_start);
    register!(registry, "telegram:unpair" => unpair);
    register!(registry, "telegram:send" => send);
    register!(registry, "telegram:ask-approval" => ask_approval);
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn config_path() -> Option<std::path::PathBuf> {
    crate::paths::data_dir(std::env::var_os("APPDATA"))
        .ok()
        .map(|dir| dir.join("telegram.json"))
}

fn with_config<T>(change: impl FnOnce(&mut Config) -> T) -> T {
    let mut guard = lock(&CONFIG);
    let config = guard.get_or_insert_with(|| {
        config_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    });
    let out = change(config);
    if let (Some(path), Ok(text)) = (config_path(), serde_json::to_string(config)) {
        let _ = std::fs::write(path, text);
    }
    out
}

fn runner() -> Option<Arc<Runner>> {
    lock(&LIVE).as_ref().map(|live| Arc::clone(&live.runner))
}

/// Copies the paired chats out of the running gateway into the saved config.
fn sync_paired() {
    if let Some(runner) = runner() {
        let paired = runner.state().paired().to_vec();
        with_config(|config| config.paired = paired);
    }
}

struct AppSink {
    app: AppHandle,
}

impl Sink for AppSink {
    fn event(&self, event: Event) {
        match event {
            Event::Message {
                chat_id,
                text,
                command,
            } => {
                let command = command.map(|command| match command {
                    Command::New => "new",
                    Command::Stop => "stop",
                });
                emit(
                    &self.app,
                    "telegram-message",
                    json!({ "chatId": chat_id.to_string(), "text": text, "command": command }),
                );
            }
            Event::Approval { approval_id, allow } => {
                emit(
                    &self.app,
                    "telegram-approval",
                    json!({ "approvalId": approval_id, "allow": allow }),
                );
            }
            Event::PairedChanged => {
                sync_paired();
                emit(&self.app, "telegram-status", status_value(&self.app));
            }
        }
    }
}

fn status_value(app: &AppHandle) -> Value {
    let now = now();
    let (paired, pairing, locked) = match runner() {
        Some(runner) => {
            let state = runner.state();
            (
                state.paired().to_vec(),
                state
                    .pairing(now)
                    .map(|(code, expires)| json!({ "code": code, "expiresAt": expires * 1000 })),
                state.locked_secs(now),
            )
        }
        None => (with_config(|config| config.paired.clone()), None, 0),
    };
    let info = lock(&INFO);
    json!({
        "hasToken": !keys::TELEGRAM.key(app).is_empty(),
        "enabled": with_config(|config| config.enabled),
        "running": info.running,
        "bot": info.bot,
        "error": info.error,
        "paired": paired
            .iter()
            .map(|one| json!({ "chatId": one.chat_id.to_string(), "name": one.name }))
            .collect::<Vec<_>>(),
        "pairing": pairing,
        "lockedSecs": locked,
    })
}

fn report(app: &AppHandle, generation: u64, state: LoopState) {
    if GENERATION.load(Ordering::SeqCst) != generation {
        return;
    }
    {
        let mut info = lock(&INFO);
        match state {
            LoopState::Running => {
                info.running = true;
                info.error.clear();
            }
            LoopState::Retrying(message) => {
                info.running = true;
                info.error = message;
            }
            LoopState::Stopped(message) => {
                info.running = false;
                info.error = message.unwrap_or_default();
            }
        }
    }
    emit(app, "telegram-status", status_value(app));
}

fn stop_live() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(live) = lock(&LIVE).take() {
        live.cancel.cancel();
    }
    let mut info = lock(&INFO);
    info.running = false;
    info.bot.clear();
}

/// Stops the long poll. Called on exit.
pub fn stop() {
    stop_live();
}

fn start(app: &AppHandle) {
    stop_live();
    lock(&INFO).error.clear();
    let token = keys::TELEGRAM.key(app);
    if token.is_empty() {
        lock(&INFO).error = "No bot token is saved.".to_owned();
        return;
    }
    let transport = match HttpTransport::new(&token) {
        Ok(transport) => Arc::new(transport),
        Err(message) => {
            lock(&INFO).error = message;
            return;
        }
    };
    let paired = with_config(|config| config.paired.clone());
    let sink = Arc::new(AppSink { app: app.clone() });
    let runner = Arc::new(Runner::new(
        State::with_paired(paired),
        transport.clone(),
        sink,
        SEND_GAP,
    ));
    let cancel = CancellationToken::new();
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    *lock(&LIVE) = Some(Live {
        runner: Arc::clone(&runner),
        cancel: cancel.clone(),
    });
    lock(&INFO).running = true;
    app.state::<AppState>()
        .diag
        .info("telegram", "gateway started", None);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match transport
            .call("getMe", json!({}), Duration::from_secs(15))
            .await
        {
            Ok(me) => {
                let name = me
                    .get("username")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                if GENERATION.load(Ordering::SeqCst) == generation {
                    lock(&INFO).bot = name;
                }
            }
            Err(failure) if failure.fatal => {
                report(&app, generation, LoopState::Stopped(Some(failure.message)));
                return;
            }
            Err(_) => {}
        }
        let reporter = app.clone();
        poll_loop(runner, cancel, now, move |state| {
            report(&reporter, generation, state);
        })
        .await;
    });
}

/// Starts the gateway at launch when it was left on.
pub fn start_saved(app: &AppHandle) {
    if with_config(|config| config.enabled) {
        start(app);
    }
}

fn text_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn chat_id_of(value: &Value) -> Result<i64, IpcError> {
    text_of(value, "chatId")
        .parse()
        .map_err(|_| IpcError::Failed("bad chat id".to_owned()))
}

async fn status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(status_value(&app))
}

async fn set_token(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let token = args
        .first()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    keys::TELEGRAM.set(&app, &token);
    if with_config(|config| config.enabled) {
        start(&app);
    }
    Ok(status_value(&app))
}

async fn set_enabled(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let enabled = args.first().and_then(Value::as_bool).unwrap_or(false);
    with_config(|config| config.enabled = enabled);
    if enabled {
        start(&app);
    } else {
        stop_live();
    }
    Ok(status_value(&app))
}

fn new_code() -> Result<String, IpcError> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes).map_err(|error| IpcError::Failed(error.to_string()))?;
    Ok(format!("{:06}", u32::from_le_bytes(bytes) % 1_000_000))
}

async fn pair_start(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(runner) = runner() else {
        return Err(IpcError::Failed("Turn Telegram on first.".to_owned()));
    };
    let code = new_code()?;
    let opened = runner.state().start_pairing(code, now());
    if let Err(secs) = opened {
        return Err(IpcError::Failed(format!(
            "Pairing is locked for {secs} more seconds."
        )));
    }
    Ok(status_value(&app))
}

async fn unpair(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let target = args.first().cloned().unwrap_or(Value::Null);
    let chat_id: i64 = target
        .as_str()
        .and_then(|text| text.parse().ok())
        .ok_or_else(|| IpcError::Failed("bad chat id".to_owned()))?;
    if let Some(runner) = runner() {
        let actions = runner.state().unpair(chat_id);
        runner.execute(actions).await;
        sync_paired();
    } else {
        with_config(|config| config.paired.retain(|one| one.chat_id != chat_id));
    }
    Ok(status_value(&app))
}

/// Sends text to a paired chat. A chat that is not paired gets nothing.
async fn send(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let input = args.first().cloned().unwrap_or(Value::Null);
    let chat_id = chat_id_of(&input)?;
    let Some(runner) = runner() else {
        return Err(IpcError::Failed("Telegram is off.".to_owned()));
    };
    if !runner.state().is_paired(chat_id) {
        return Err(IpcError::Failed("That chat is not paired.".to_owned()));
    }
    runner
        .send_text(chat_id, &text_of(&input, "text"))
        .await
        .map_err(|failure| IpcError::Failed(failure.message))?;
    Ok(json!({ "success": true }))
}

async fn ask_approval(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let input = args.first().cloned().unwrap_or(Value::Null);
    let chat_id = chat_id_of(&input)?;
    let Some(runner) = runner() else {
        return Err(IpcError::Failed("Telegram is off.".to_owned()));
    };
    runner
        .ask_approval(
            chat_id,
            &text_of(&input, "approvalId"),
            &text_of(&input, "text"),
            now(),
        )
        .await
        .map_err(|failure| IpcError::Failed(failure.message))?;
    Ok(json!({ "success": true }))
}
