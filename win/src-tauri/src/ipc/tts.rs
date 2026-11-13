//! Handlers for the text to speech channels. Cloud voices only: the request is made here with the provider's stored
//! key, and the renderer gets PCM frames, counts and codes, never the key or an echo of the text.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

use super::pricing::now_ms;
use super::terminals::text;
use super::web::keys;
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::pricing::build::iso_utc;
use crate::tts::cloud::{Provider, SpeakError, Speech, speak};
use crate::tts::consent::{self, KEY as CONSENT_KEY};
use crate::tts::frames::SAMPLE_RATE;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "tts:providers" => tts_providers);
    register!(registry, "tts:consent-grant" => tts_consent_grant);
    register!(registry, "tts:consent-revoke" => tts_consent_revoke);
    register!(registry, "tts:speak" => tts_speak);
    register!(registry, "tts:cancel" => tts_cancel);
}

/// Fragments in flight, by turn. Each carries the sender that cancels it, and a number to find it again.
type Live = HashMap<String, Vec<(u64, watch::Sender<bool>)>>;

static LIVE: LazyLock<Mutex<Live>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT: AtomicU64 = AtomicU64::new(1);

fn live() -> MutexGuard<'static, Live> {
    LIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

fn code(value: &str) -> Value {
    json!({ "success": false, "code": value })
}

/// The consent text from settings, when the store is open.
fn read_consent(app: &AppHandle) -> Option<String> {
    let storage = app.state::<AppState>().storage.handle()?;
    storage.get_value(CONSENT_KEY).ok().flatten()
}

/// Rewrites the consent text with `change`. False when the store is closed or the write failed.
fn write_consent(app: &AppHandle, change: impl FnOnce(Option<&str>) -> String) -> bool {
    let Some(storage) = app.state::<AppState>().storage.handle() else {
        return false;
    };
    let current = storage.get_value(CONSENT_KEY).ok().flatten();
    storage
        .set_value(CONSENT_KEY, &change(current.as_deref()))
        .is_ok()
}

fn stored_key(app: &AppHandle, provider: Provider) -> String {
    keys::stored(app, &format!("provider:{}", provider.id()))
}

async fn tts_providers(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let providers: Vec<Value> = [Provider::OpenAi, Provider::Gemini]
        .into_iter()
        .map(|provider| {
            let configured = !stored_key(&app, provider).is_empty();
            json!({
                "id": provider.id(),
                "name": provider.name(),
                "configured": configured,
                "instance": configured.then_some(provider.id()),
            })
        })
        .collect();
    Ok(json!({
        "providers": providers,
        "consent": consent::list(read_consent(&app).as_deref()),
    }))
}

async fn tts_consent_grant(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(provider) = Provider::from_id(&text(args.first())) else {
        return Ok(code("unknown-provider"));
    };
    let now = iso_utc(now_ms());
    if !write_consent(&app, |raw| consent::grant(raw, provider.id(), &now)) {
        return Ok(code("closed"));
    }
    app.state::<AppState>().diag.info(
        "settings.voice",
        "consent granted",
        Some(json!({ "provider": provider.id(), "kind": "text" })),
    );
    Ok(json!({ "success": true }))
}

async fn tts_consent_revoke(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let provider = text(args.first());
    if !write_consent(&app, |raw| consent::revoke(raw, &provider)) {
        return Ok(code("closed"));
    }
    app.state::<AppState>().diag.info(
        "settings.voice",
        "consent revoked",
        Some(json!({ "provider": provider })),
    );
    Ok(json!({ "success": true }))
}

/// Starts one fragment. Frames go out on `tts:frames`; the answer is the final count.
async fn tts_speak(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let turn = args.first().cloned().unwrap_or(Value::Null);
    let turn_key = text(args.first());
    let request = args.get(1);
    let field = |name: &str| text(request.and_then(|request| request.get(name)));
    let Some(provider) = Provider::from_id(&field("provider")) else {
        return Ok(code("unknown-provider"));
    };
    if !consent::has(read_consent(&app).as_deref(), provider.id()) {
        return Ok(code("no-consent"));
    }
    let key = stored_key(&app, provider);
    if key.is_empty() {
        return Ok(code("no-key"));
    }

    let speech_text = field("text");
    let voice = field("voice");
    let model = field("model");
    let diag = Arc::clone(&app.state::<AppState>().diag);
    diag.debug(
        "ipc.tts",
        "engine chosen",
        Some(json!({ "provider": provider.id(), "chars": speech_text.chars().count() })),
    );

    let (cancel, cancelled) = watch::channel(false);
    let slot = NEXT.fetch_add(1, Ordering::Relaxed);
    live()
        .entry(turn_key.clone())
        .or_default()
        .push((slot, cancel));

    let frames_app = app.clone();
    let on_frames = move |pcm: Vec<i16>| {
        emit(
            &frames_app,
            "tts:frames",
            json!({ "turnId": turn, "pcm": pcm, "sampleRate": SAMPLE_RATE }),
        );
    };
    let speech = Speech {
        text: &speech_text,
        voice: &voice,
        model: &model,
    };
    let outcome = tokio::select! {
        result = speak(provider, &key, &speech, on_frames) => Some(result),
        _ = wait_for_cancel(cancelled) => None,
    };
    forget(&turn_key, slot);

    Ok(match outcome {
        None => {
            diag.info(
                "ipc.tts",
                "synthesis cancelled",
                Some(json!({ "provider": provider.id() })),
            );
            code("cancelled")
        }
        Some(Ok(done)) => {
            diag.info(
                "ipc.tts",
                "synthesis done",
                Some(json!({ "provider": provider.id(), "characters": done.characters, "frames": done.frames })),
            );
            json!({
                "success": true,
                "characters": done.characters,
                "frames": done.frames,
                "provider": provider.id(),
            })
        }
        Some(Err(error)) => {
            let code = error_code(&error);
            diag.warn(
                "ipc.tts",
                "synthesis failed",
                Some(json!({ "provider": provider.id(), "code": code })),
            );
            json!({ "success": false, "code": code })
        }
    })
}

/// Ends every fragment of a turn. A fragment that arrives after this is dropped by the renderer.
async fn tts_cancel(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let senders = live().remove(&text(args.first())).unwrap_or_default();
    for (_, cancel) in senders {
        cancel.send_replace(true);
    }
    Ok(json!({ "success": true }))
}

async fn wait_for_cancel(mut cancelled: watch::Receiver<bool>) {
    let _ = cancelled.wait_for(|stop| *stop).await;
}

fn forget(turn: &str, slot: u64) {
    let mut live = live();
    let empty = match live.get_mut(turn) {
        Some(fragments) => {
            fragments.retain(|(id, _)| *id != slot);
            fragments.is_empty()
        }
        None => false,
    };
    if empty {
        live.remove(turn);
    }
}

/// The error code the renderer sees.
fn error_code(error: &SpeakError) -> String {
    match error {
        SpeakError::Empty | SpeakError::Transport => "failed".to_owned(),
        SpeakError::Http(status) => format!("http-{status}"),
    }
}
