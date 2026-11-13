//! Draggy for Windows: a Tauri shell around the React renderer. The renderer keeps the Electron API
//! shape; `ipc` serves its channels.

pub mod browser;
pub mod chat_gateway;
pub mod draggy_scheme;
pub mod engines;
pub mod ipc;
pub mod mcp;
pub mod models;
pub mod paths;
pub mod pricing;
pub mod proc_log;
pub mod quit;
pub mod secrets;
pub mod storage;
pub mod terminals;
pub mod theme;
pub mod tts;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::Path;
use std::sync::Arc;

use draggy_diagnostics::{Config, Diagnostics, SystemClock};
use tauri::window::Color;
use tauri::{Manager, WindowEvent};

pub struct AppState {
    pub diag: Arc<Diagnostics>,
    pub registry: Arc<ipc::Registry>,
    pub quit: Arc<quit::Quit>,
    pub storage: Arc<storage::Db>,
    pub engines: Arc<engines::Engines>,
    pub mcp: Arc<mcp::Host>,
}

/// `logs/app.log`, `debug.log` and `events.jsonl` under the data folder.
fn open_log(data_dir: &Path) -> Diagnostics {
    let packaged = !cfg!(debug_assertions);
    let env_file = if packaged {
        None
    } else {
        std::fs::read_to_string("../.env.local").ok()
    };
    // A random id is enough to tell two runs apart in a log; no dependency needed for it.
    let session = format!("{:08x}", RandomState::new().build_hasher().finish() as u32);
    let config = Config::from_env(
        |key| std::env::var(key).ok(),
        session,
        std::process::id(),
        packaged,
        env_file.as_deref(),
    );
    Diagnostics::open(
        data_dir.join("logs"),
        config,
        Arc::new(SystemClock::default()),
    )
}

/// Sets the window colour from the saved theme, then shows it, so no wrong-coloured frame flashes.
fn show_main_window(app: &tauri::App, data_dir: &Path) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let raw = theme::saved_settings(&data_dir.join("draggy.db"));
    let setting = theme::theme_setting(raw.as_deref());
    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let [r, g, b] = theme::background_for(setting, system_dark);
    window.set_background_color(Some(Color(r, g, b, 255)))?;
    window.show()
}

/// The query that opens the renderer on first-run setup.
const SETUP_QUERY: &str = "onboarding=true";
/// Electron's MIN_WINDOW_WIDTH and MIN_WINDOW_HEIGHT; each is clamped to the work area.
const MIN_WINDOW_WIDTH: f64 = 760.0;
const MIN_WINDOW_HEIGHT: f64 = 480.0;

/// The minimum size, clamped to the work area as Electron did with Math.min.
fn window_minimum(area_width: f64, area_height: f64) -> (f64, f64) {
    (
        MIN_WINDOW_WIDTH.min(area_width),
        MIN_WINDOW_HEIGHT.min(area_height),
    )
}

/// The primary monitor's work area in logical pixels, or None when it cannot be read.
#[cfg(windows)]
fn work_area(scale: f64) -> Option<(f64, f64)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SystemParametersInfoW,
    };
    let mut rect = RECT::default();
    // SAFETY: SPI_GETWORKAREA writes one RECT through the pointer, which lives for the call.
    unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(std::ptr::addr_of_mut!(rect).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
    }
    let width = f64::from(rect.right - rect.left) / scale;
    let height = f64::from(rect.bottom - rect.top) / scale;
    Some((width, height))
}

#[cfg(not(windows))]
fn work_area(_scale: f64) -> Option<(f64, f64)> {
    None
}

fn minimum_for_screen(app: &tauri::AppHandle) -> (f64, f64) {
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map_or(1.0, |monitor| monitor.scale_factor());
    let (width, height) = work_area(scale).unwrap_or((f64::INFINITY, f64::INFINITY));
    window_minimum(width, height)
}

/// The main window, built here rather than from config so its links can reach the browser pane. Its
/// own pages stay in the window; any other top-level navigation or window.open goes to the pane instead.
/// With `setup`, it opens on first-run setup, as Electron's createWindow({ onboarding: true }) did.
fn build_main_window(app: &tauri::AppHandle, setup: bool) -> tauri::Result<()> {
    let navigating = app.clone();
    let opening = app.clone();
    let page = if setup {
        format!("index.html?{SETUP_QUERY}")
    } else {
        "index.html".to_owned()
    };
    let (min_width, min_height) = minimum_for_screen(app);
    // The WebView2 profile (localStorage, cookies) lives in the app's own data folder, not LOCALAPPDATA.
    let profile = app.state::<AppState>().storage.data_dir().join("webview");
    tauri::webview::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App(page.into()))
        .title("Draggy")
        .inner_size(1200.0, 800.0)
        .min_inner_size(min_width, min_height)
        .data_directory(profile)
        // Undecorated: the renderer's TitleBar draws the caption buttons. Edge resize and snap stay on.
        .decorations(false)
        .shadow(true)
        .visible(false)
        .on_navigation(move |url| {
            if is_app_page(url) || is_about_page(url) {
                return true;
            }
            ipc::browser::open_from_main_window(&navigating, url.clone());
            false
        })
        .on_new_window(move |url, _features| {
            ipc::browser::open_from_main_window(&opening, url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map(|_| ())
}

/// Points the open main window at first-run setup: a reload with the setup query, then shown and focused.
pub fn show_setup_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let mut url = window.url()?;
    url.set_query(Some(SETUP_QUERY));
    window.navigate(url)?;
    focus_main_window(app);
    Ok(())
}

/// The renderer's own pages: the asset host, and the dev server in debug builds.
fn is_app_page(url: &tauri::Url) -> bool {
    let dev =
        cfg!(debug_assertions) && url.host_str() == Some("127.0.0.1") && url.port() == Some(5173);
    dev || url.host_str() == Some("tauri.localhost")
        || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
}

fn is_about_page(url: &tauri::Url) -> bool {
    url.scheme() == "about"
}

pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    // The port must be known before the window, so the CSP can name the gateway's origin.
    let mut context = tauri::generate_context!();
    let listener = chat_gateway::bind().expect("the chat gateway could not bind");
    chat_gateway::restrict_csp(&mut context, listener.port())
        .expect("the chat gateway could not set its CSP");
    tauri::Builder::default()
        // Must come first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("widget", |_ctx, request| {
            ipc::widgets::serve(&request.uri().to_string())
        })
        .register_asynchronous_uri_scheme_protocol("draggy", |ctx, request, responder| {
            draggy_scheme::handle(
                ctx.app_handle().clone(),
                request.uri().to_string(),
                responder,
            )
        })
        .invoke_handler(tauri::generate_handler![
            ipc::ipc_invoke,
            ipc::ipc_send,
            ipc::ipc_stage,
            chat_gateway::gateway_info
        ])
        .setup(move |app| {
            let data_dir = paths::data_dir(std::env::var_os("APPDATA"))?;
            // Before anything writes, so a legacy folder moves into an empty one.
            let adopted = data_dir
                .parent()
                .map(|parent| paths::adopt_legacy_data_folder(parent, &data_dir))
                .unwrap_or_default();
            std::fs::create_dir_all(data_dir.join("logs"))?;
            let diag = Arc::new(open_log(&data_dir));
            terminals::install_diagnostics(Arc::clone(&diag));
            terminals::sandbox::sweep_specs(&data_dir);
            for note in &adopted {
                diag.info("appData", note, None);
            }
            let storage = Arc::new(storage::Db::open(&data_dir, &diag));
            let engines = Arc::new(engines::Engines::new(&data_dir));
            let mcp = Arc::new(mcp::Host::new(
                app.handle().clone(),
                Arc::clone(&diag),
                &data_dir,
            )?);
            app.manage(AppState {
                engines,
                mcp,
                storage,
                diag,
                registry: Arc::new(ipc::Registry::build()),
                quit: Arc::new(quit::Quit::default()),
            });
            let gateway = chat_gateway::start(
                listener,
                chat_gateway::engine_port(app.handle().clone()),
                chat_gateway::production_serve(app.handle().clone()),
            );
            app.manage(gateway);
            app.manage(ipc::browser::Panes::default());
            ipc::api_server::apply_saved(app.handle());
            ipc::research::prune_at_start(app.handle());
            ipc::mcp::adopt_stored_credentials(app.handle());
            ipc::providers::start_auto_refresh(app.handle());
            ipc::providers::attach_focus_refresh(app.handle());
            // The launch check and the filter lists wait for a finished setup; onboarding:complete starts them.
            let show_setup = app.state::<AppState>().storage.show_setup();
            if !show_setup {
                ipc::updater::start(app.handle());
                browser::adblock::start(app.handle());
            }
            build_main_window(app.handle(), show_setup)?;
            show_main_window(app, &data_dir)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                let Some(state) = app.try_state::<AppState>() else {
                    return;
                };
                // Hold the close until the window has saved, or the timeout passes.
                api.prevent_close();
                if state.quit.begin() {
                    let quit = Arc::clone(&state.quit);
                    let db = Arc::clone(&state.storage);
                    tauri::async_runtime::spawn(async move {
                        quit.flush(&app).await;
                        // The window's last saves have landed by now, so nothing writes after this.
                        db.close();
                        app.exit(0);
                    });
                }
            }
        })
        .build(context)
        .expect("error while building Draggy")
        .run(|app, event| {
            // Every exit path ends here; without the marker the next launch reports a crash.
            if let tauri::RunEvent::Exit = event
                && let Some(state) = app.try_state::<AppState>()
            {
                // No engine child or open port may outlive the window.
                if let Some(gateway) = app.try_state::<chat_gateway::ChatGateway>() {
                    gateway.stop();
                }
                ipc::api_server::stop_all();
                tauri::async_runtime::block_on(state.engines.shutdown());
                terminals::stop_all();
                tauri::async_runtime::block_on(state.mcp.stop_all());
                ipc::code_runner::stop_all();
                state.diag.end_session(true);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_minimum_is_clamped_to_a_small_work_area() {
        assert_eq!(window_minimum(1920.0, 1040.0), (760.0, 480.0));
        assert_eq!(window_minimum(600.0, 400.0), (600.0, 400.0));
    }

    #[test]
    fn the_setup_page_stays_an_app_page() {
        let setup =
            tauri::Url::parse("http://tauri.localhost/index.html?onboarding=true").expect("url");
        assert!(is_app_page(&setup));
        let other =
            tauri::Url::parse("https://example.com/index.html?onboarding=true").expect("url");
        assert!(!is_app_page(&other));
    }
}
