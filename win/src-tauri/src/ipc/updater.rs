//! Updater channels: the state stream and the install trigger.
//! Checks run at launch and every six hours; a download starts only when the user asks to install.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use super::{IpcError, Registry, emit};
use crate::AppState;

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const CHANNEL: &str = "updater-state";
const DISABLED_IN_DEV: &str = "Updates are disabled in development.";
const UNAVAILABLE: &str = "Update support is unavailable.";
const CHECK_FAILED: &str = "Update check failed.";
const INSTALL_FAILED: &str = "Update install failed.";

pub fn register_all(registry: &mut Registry) {
    register!(registry, "updater:state" => state);
    register!(registry, "updater:install" => install);
}

#[derive(Clone, Debug, Serialize)]
pub struct State {
    status: &'static str,
    version: Option<String>,
    percent: u8,
    notes: Option<String>,
    error: Option<String>,
}

impl State {
    const fn idle() -> Self {
        Self {
            status: "idle",
            version: None,
            percent: 0,
            notes: None,
            error: None,
        }
    }
}

/// An update the check found, with its bytes once the download has finished.
struct Found {
    update: Arc<Update>,
    bytes: Option<Vec<u8>>,
}

static STATE: Mutex<State> = Mutex::new(State::idle());
static FOUND: Mutex<Option<Found>> = Mutex::new(None);

/// What the install channel does for a status: download a found update, install a downloaded one, or nothing.
#[derive(Debug, PartialEq)]
enum Plan {
    Download,
    Install,
    Nothing,
}

async fn state(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!(snapshot()))
}

async fn install(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let current = current_version(&app);
    let now = snapshot();
    match plan(now.status, now.version.as_deref(), &current) {
        Plan::Download => {
            start_download(&app);
            Ok(json!(snapshot()))
        }
        Plan::Install => Ok(json!(begin_install(&app))),
        Plan::Nothing => Ok(json!(now)),
    }
}

/// Starts the launch check and the six-hour checks. Disabled in debug builds.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        set(app, |s| {
            s.status = "disabled";
            s.error = Some(DISABLED_IN_DEV.to_owned());
        });
        return;
    }
    // TODO(release): plugins.updater.pubkey in tauri.conf.json is a placeholder; set the minisign public key.
    if app.updater().is_err() {
        warn(app, "updater plugin unavailable", None);
        set(app, |s| {
            s.status = "disabled";
            s.error = Some(UNAVAILABLE.to_owned());
        });
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

fn snapshot() -> State {
    lock(&STATE).clone()
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Applies a change to the state and pushes the result to the window, as `publish` did.
fn set(app: &AppHandle, change: impl FnOnce(&mut State)) {
    let next = {
        let mut state = lock(&STATE);
        change(&mut state);
        state.clone()
    };
    emit(app, CHANNEL, json!(next));
}

fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

// Endpoint is a fixed Windows-only `latest-windows.json` on the `updater-windows` rolling release, not `releases/latest`, which may be mac/linux.
async fn check(app: &AppHandle) {
    set(app, |s| {
        s.status = "checking";
        s.error = None;
    });
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            warn(app, "silent check failed", Some(error.to_string()));
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => offer(app, update),
        Ok(None) => set(app, |s| {
            s.status = "current";
            s.percent = 0;
        }),
        Err(error) => {
            warn(app, "silent check failed", Some(error.to_string()));
            set(app, |s| {
                if matches!(s.status, "available" | "downloading") {
                    s.status = "error";
                    s.error = Some(CHECK_FAILED.to_owned());
                }
            });
        }
    }
}

fn offer(app: &AppHandle, update: Update) {
    let current = current_version(app);
    if !is_newer(&update.version, &current) {
        set(app, |s| {
            s.status = "current";
            s.percent = 0;
        });
        return;
    }
    let version = update.version.clone();
    let notes = notes_text(update.body.as_deref());
    *lock(&FOUND) = Some(Found {
        update: Arc::new(update),
        bytes: None,
    });
    set(app, |s| {
        s.status = "available";
        s.version = Some(version);
        s.notes = notes;
    });
}

/// Downloads the found update in the background, publishing progress and the outcome.
fn start_download(app: &AppHandle) {
    let Some(update) = lock(&FOUND).as_ref().map(|found| Arc::clone(&found.update)) else {
        return;
    };
    set(app, |s| {
        s.status = "downloading";
        s.percent = 0;
        s.error = None;
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut downloaded: u64 = 0;
        let mut last: u8 = 0;
        let progress_app = app.clone();
        let result = update
            .download(
                |chunk, total| {
                    downloaded = downloaded.saturating_add(chunk as u64);
                    let percent = percent_of(downloaded, total);
                    if percent != last {
                        last = percent;
                        set(&progress_app, |s| {
                            s.status = "downloading";
                            s.percent = percent;
                        });
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                if let Some(found) = lock(&FOUND).as_mut() {
                    found.bytes = Some(bytes);
                }
                let version = update.version.clone();
                set(&app, |s| {
                    s.status = "ready";
                    s.version = Some(version);
                    s.percent = 100;
                });
            }
            Err(error) => {
                let text = error.to_string();
                warn(&app, "update download failed", Some(text.clone()));
                let message = non_empty(&text).unwrap_or(CHECK_FAILED).to_owned();
                set(&app, |s| {
                    s.status = "error";
                    s.error = Some(message);
                });
            }
        }
    });
}

/// Installs a downloaded update silently and relaunches. Returns the state with status "installing".
fn begin_install(app: &AppHandle) -> State {
    let taken = lock(&FOUND).as_mut().and_then(|found| {
        found
            .bytes
            .take()
            .map(|bytes| (Arc::clone(&found.update), bytes))
    });
    let Some((update, bytes)) = taken else {
        return snapshot();
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
        match outcome {
            Ok(Ok(())) => app.restart(),
            _ => {
                warn(&app, "update install failed", None);
                set(&app, |s| {
                    s.status = "error";
                    s.error = Some(INSTALL_FAILED.to_owned());
                });
            }
        }
    });
    State {
        status: "installing",
        ..snapshot()
    }
}

fn warn(app: &AppHandle, message: &str, reason: Option<String>) {
    if let Some(state) = app.try_state::<AppState>() {
        state
            .diag
            .warn("updater", message, reason.map(|r| json!({ "reason": r })));
    }
}

/// Non-empty text, or None when the text is empty.
fn non_empty(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn plan(status: &str, version: Option<&str>, current: &str) -> Plan {
    let newer = version.is_some_and(|v| is_newer(v, current));
    match status {
        "available" if newer => Plan::Download,
        "ready" if newer => Plan::Install,
        _ => Plan::Nothing,
    }
}

/// Numeric MAJOR.MINOR.PATCH comparison. Pre-release tags are ignored; unparseable versions are never newer.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (core_version(candidate), core_version(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn core_version(version: &str) -> Option<[u64; 3]> {
    let core = version
        .trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()?;
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    let parsed = [parts.next()??, parts.next()??, parts.next()??];
    parts.next().is_none().then_some(parsed)
}

/// Release notes with surrounding whitespace removed; blank notes are no notes.
fn notes_text(raw: Option<&str>) -> Option<String> {
    raw.and_then(non_empty).map(str::to_owned)
}

/// Whole-number percent, rounded, capped at 100. Unknown total reads as 0.
fn percent_of(downloaded: u64, total: Option<u64>) -> u8 {
    match total {
        Some(total) if total > 0 => {
            (downloaded.saturating_mul(100).saturating_add(total / 2) / total).min(100) as u8
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_compares_numbers_not_text() {
        assert!(is_newer("3.0.6", "3.0.5"));
        assert!(is_newer("3.10.0", "3.9.9"));
        assert!(is_newer("v4.0.0", "3.99.99"));
        assert!(!is_newer("3.0.5", "3.0.5"));
        assert!(!is_newer("3.0.4", "3.0.5"));
    }

    #[test]
    fn unparseable_versions_are_never_newer() {
        assert!(!is_newer("3.0", "3.0.5"));
        assert!(!is_newer("", "3.0.5"));
        assert!(!is_newer("3.0.6", "x.y.z"));
    }

    #[test]
    fn notes_are_trimmed_and_blank_is_none() {
        assert_eq!(
            notes_text(Some("  Fixed things \n")),
            Some("Fixed things".to_owned())
        );
        assert_eq!(notes_text(Some("   ")), None);
        assert_eq!(notes_text(None), None);
    }

    #[test]
    fn percent_rounds_and_caps() {
        assert_eq!(percent_of(0, Some(200)), 0);
        assert_eq!(percent_of(1, Some(3)), 33);
        assert_eq!(percent_of(2, Some(3)), 67);
        assert_eq!(percent_of(300, Some(200)), 100);
        assert_eq!(percent_of(50, None), 0);
    }

    #[test]
    fn install_channel_downloads_only_when_available_and_newer() {
        assert_eq!(plan("available", Some("3.0.6"), "3.0.5"), Plan::Download);
        assert_eq!(plan("available", Some("3.0.5"), "3.0.5"), Plan::Nothing);
        assert_eq!(plan("idle", Some("3.0.6"), "3.0.5"), Plan::Nothing);
        assert_eq!(plan("ready", Some("3.0.6"), "3.0.5"), Plan::Install);
        assert_eq!(plan("ready", None, "3.0.5"), Plan::Nothing);
    }

    #[test]
    fn idle_state_has_electron_shape() {
        let value = json!(State::idle());
        assert_eq!(value["status"], "idle");
        assert_eq!(value["percent"], 0);
        assert!(value["version"].is_null());
        assert!(value["notes"].is_null());
        assert!(value["error"].is_null());
    }
}
