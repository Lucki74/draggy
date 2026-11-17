//! The startup window. It shows on every launch while the main window loads, and on the way it checks
//! for an update, downloads it and hands it to the installer. The user can start without updating.
//! Any failure in the update step only delays the launch; it never stops it.

use std::path::Path;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use crate::AppState;
use crate::ipc::{self, updater};

pub const LABEL: &str = "splash";
const CHANNEL: &str = "splash-state";
/// The launch check gives up after this, so a slow network costs a few seconds at most.
const CHECK_TIMEOUT: Duration = Duration::from_secs(3);
/// Per request, long enough for the installer download; the user can skip it at any time.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The main window shows after its first paint, or after this if the renderer never says so.
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATED_HOLD: Duration = Duration::from_millis(1200);
const FAILED_HOLD: Duration = Duration::from_millis(1600);
const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const VERSION_FILE: &str = "last-version";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    phase: &'static str,
    version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
}

impl State {
    const fn checking() -> Self {
        Self {
            phase: "checking",
            version: None,
            downloaded: 0,
            total: None,
        }
    }
}

static STATE: Mutex<State> = Mutex::new(State::checking());
/// The skip button or the close box. A permit is kept, so a press between two waits is not lost.
static SKIP: LazyLock<Notify> = LazyLock::new(Notify::new);
/// The main window's first paint.
static READY: LazyLock<Notify> = LazyLock::new(Notify::new);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn snapshot() -> State {
    lock(&STATE).clone()
}

fn set(app: &AppHandle, change: impl FnOnce(&mut State)) {
    let next = {
        let mut state = lock(&STATE);
        change(&mut state);
        state.clone()
    };
    ipc::emit(app, CHANNEL, json!(next));
}

/// Phases the user may cut short. Installing and launching run to the end.
fn may_skip(phase: &str) -> bool {
    matches!(phase, "checking" | "downloading" | "updated" | "failed")
}

pub fn skip() {
    if may_skip(snapshot().phase) {
        SKIP.notify_one();
    }
}

/// The close box means "start without updating"; it never quits the app halfway through a launch.
pub fn close_requested() {
    skip();
}

pub fn main_ready() {
    READY.notify_one();
}

/// True when this launch runs a newer version than the last one did.
fn updated(previous: Option<&str>, current: &str) -> bool {
    previous.is_some_and(|previous| updater::is_newer(current, previous.trim()))
}

/// The saved theme, accent and language, set before the page's scripts run so the first frame is right.
fn boot_script(raw_settings: Option<&str>) -> String {
    let settings: Value = raw_settings
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    let pick = |key: &str| settings.get(key).filter(|v| v.is_string()).cloned();
    let boot = json!({
        "theme": pick("theme"),
        "accent": pick("accent"),
        "language": pick("language"),
    });
    format!("window.__DRAGGY_SPLASH__ = {boot};")
}

/// Builds the splash and shows it in the saved theme's colour.
pub fn open(app: &AppHandle, data_dir: &Path) -> tauri::Result<()> {
    let raw = crate::theme::saved_settings(&data_dir.join("draggy.db"));
    let window = tauri::webview::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("splash.html".into()),
    )
    .title("Draggy")
    .inner_size(400.0, 500.0)
    .resizable(false)
    .maximizable(false)
    .decorations(false)
    .shadow(true)
    .center()
    .visible(false)
    .data_directory(data_dir.join("webview"))
    .initialization_script(boot_script(raw.as_deref()))
    .on_navigation(crate::is_app_page)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()?;
    crate::paint_and_show(&window, data_dir)
}

/// Runs the startup: the update step unless this is first-run setup, then the main window.
pub fn start(app: &AppHandle, setup: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let data_dir = app.state::<AppState>().storage.data_dir().to_path_buf();
        let current = app.package_info().version.to_string();
        let previous = remember_version(&data_dir, &current);
        if updated(previous.as_deref(), &current) {
            set(&app, |s| {
                s.phase = "updated";
                s.version = Some(current.clone());
            });
            hold(UPDATED_HOLD).await;
        } else if !setup {
            update_step(&app).await;
        }
        launch(&app, setup).await;
    });
}

/// Stores this run's version and returns the last run's.
fn remember_version(data_dir: &Path, current: &str) -> Option<String> {
    let file = data_dir.join(VERSION_FILE);
    let previous = std::fs::read_to_string(&file).ok();
    if previous.as_deref().map(str::trim) != Some(current) {
        let _ = std::fs::write(&file, current);
    }
    previous
}

/// Waits for `duration`, or less if the user skips.
async fn hold(duration: Duration) {
    tokio::select! {
        () = tokio::time::sleep(duration) => {}
        () = SKIP.notified() => {}
    }
}

async fn update_step(app: &AppHandle) {
    if cfg!(debug_assertions) {
        mock::run(app).await;
        return;
    }
    let updater = match updater::updater_with(app, DOWNLOAD_TIMEOUT) {
        Ok(updater) => updater,
        Err(error) => return warn(app, "updater unavailable", error.to_string()),
    };
    let found = tokio::select! {
        result = tokio::time::timeout(CHECK_TIMEOUT, updater.check()) => result,
        () = SKIP.notified() => return,
    };
    let current = app.package_info().version.to_string();
    let update = match found {
        Ok(Ok(Some(update))) if updater::is_newer(&update.version, &current) => update,
        Ok(Ok(_)) => return,
        Ok(Err(error)) => return warn(app, "launch check failed", error.to_string()),
        Err(_) => return warn(app, "launch check timed out", String::new()),
    };
    set(app, |s| {
        s.phase = "downloading";
        s.version = Some(update.version.clone());
        s.downloaded = 0;
        s.total = None;
    });
    let downloaded = {
        let progress = app.clone();
        let mut done: u64 = 0;
        let mut shown = Instant::now();
        let download = update.download(
            move |chunk, total| {
                done = done.saturating_add(chunk as u64);
                if shown.elapsed() >= PROGRESS_EVERY {
                    shown = Instant::now();
                    set(&progress, |s| {
                        s.downloaded = done;
                        s.total = total;
                    });
                }
            },
            || {},
        );
        tokio::select! {
            result = download => Some(result),
            () = SKIP.notified() => None,
        }
    };
    let bytes = match downloaded {
        // Skipped: the app offers the same update later, from its own updater.
        None => return updater::adopt(app, update),
        Some(Ok(bytes)) => bytes,
        Some(Err(error)) => {
            warn(app, "launch download failed", error.to_string());
            return fail(app).await;
        }
    };
    set(app, |s| s.phase = "installing");
    // On Windows a successful install ends the process here; elsewhere it returns and the app restarts.
    match tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await {
        Ok(Ok(())) => app.restart(),
        Ok(Err(error)) => warn(app, "launch install failed", error.to_string()),
        Err(error) => warn(app, "launch install failed", error.to_string()),
    }
    fail(app).await;
}

async fn fail(app: &AppHandle) {
    set(app, |s| s.phase = "failed");
    hold(FAILED_HOLD).await;
}

/// Builds the main window hidden, waits for its first paint, then swaps it in for the splash.
async fn launch(app: &AppHandle, setup: bool) {
    set(app, |s| s.phase = "launching");
    if let Err(error) = crate::build_main_window(app, setup) {
        warn(app, "main window failed", error.to_string());
        app.exit(1);
        return;
    }
    ipc::providers::attach_focus_refresh(app);
    let _ = tokio::time::timeout(READY_TIMEOUT, READY.notified()).await;
    if let Err(error) = crate::show_main_window(app) {
        warn(app, "main window did not show", error.to_string());
    }
    if let Some(splash) = app.get_webview_window(LABEL) {
        let _ = splash.destroy();
    }
}

fn warn(app: &AppHandle, message: &str, reason: String) {
    if let Some(state) = app.try_state::<AppState>() {
        let fields = (!reason.is_empty()).then(|| json!({ "reason": reason }));
        state.diag.warn("splash", message, fields);
    }
}

/// Development builds have no signed release to update from. `DRAGGY_SPLASH_MOCK` plays the phases:
/// `update`, `offline`, `error` or `updated`; anything else goes straight to launch.
mod mock {
    use super::*;

    const SIZE: u64 = 38_200_000;
    const STEPS: u64 = 40;

    pub async fn run(app: &AppHandle) {
        let mode = std::env::var("DRAGGY_SPLASH_MOCK").unwrap_or_default();
        match mode.as_str() {
            "update" | "error" => {
                if !download(app).await {
                    return;
                }
                if mode == "error" {
                    return fail(app).await;
                }
                set(app, |s| s.phase = "installing");
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            "offline" => hold(CHECK_TIMEOUT).await,
            "updated" => {
                let current = app.package_info().version.to_string();
                set(app, |s| {
                    s.phase = "updated";
                    s.version = Some(current);
                });
                hold(UPDATED_HOLD).await;
            }
            _ => {}
        }
    }

    /// A fake download. False when the user skipped it.
    async fn download(app: &AppHandle) -> bool {
        hold(Duration::from_millis(800)).await;
        set(app, |s| {
            s.phase = "downloading";
            s.version = Some("9.9.9".to_owned());
            s.total = Some(SIZE);
        });
        for step in 1..=STEPS {
            tokio::select! {
                () = tokio::time::sleep(Duration::from_millis(100)) => {}
                () = SKIP.notified() => return false,
            }
            set(app, |s| s.downloaded = SIZE * step / STEPS);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_version_than_last_run_is_an_update() {
        assert!(updated(Some("1.2.0"), "1.3.0"));
        assert!(updated(Some("1.2.0\r\n"), "1.2.1"));
        assert!(!updated(Some("1.3.0"), "1.3.0"));
        assert!(!updated(Some("1.4.0"), "1.3.0"));
        assert!(!updated(None, "1.3.0"));
        assert!(!updated(Some("garbage"), "1.3.0"));
    }

    #[test]
    fn only_waiting_phases_can_be_skipped() {
        for phase in ["checking", "downloading", "updated", "failed"] {
            assert!(may_skip(phase), "{phase}");
        }
        assert!(!may_skip("installing"));
        assert!(!may_skip("launching"));
    }

    #[test]
    fn the_boot_script_carries_only_the_look_settings() {
        let raw = r#"{"theme":"dark","accent":"ember","language":"fr","apiKey":"secret"}"#;
        let script = boot_script(Some(raw));
        assert_eq!(
            script,
            r#"window.__DRAGGY_SPLASH__ = {"theme":"dark","accent":"ember","language":"fr"};"#
        );
    }

    #[test]
    fn the_boot_script_survives_missing_or_broken_settings() {
        let expected =
            r#"window.__DRAGGY_SPLASH__ = {"theme":null,"accent":null,"language":null};"#;
        assert_eq!(boot_script(None), expected);
        assert_eq!(boot_script(Some("not json")), expected);
        assert_eq!(boot_script(Some(r#"{"theme":42}"#)), expected);
    }

    #[test]
    fn the_state_has_the_shape_the_page_reads() {
        let value = json!(State::checking());
        assert_eq!(
            value,
            json!({ "phase": "checking", "version": null, "downloaded": 0, "total": null })
        );
    }
}
