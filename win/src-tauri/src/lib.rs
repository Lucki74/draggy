//! Draggy for Windows: a Tauri shell around the React renderer. The renderer keeps the Electron API
//! shape; `ipc` serves its channels.

pub mod chat_gateway;
pub mod engines;
pub mod ipc;
pub mod mcp;
pub mod models;
pub mod paths;
pub mod pricing;
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

/// `logs/app.log`, `debug.log` and `events.jsonl` under the data folder, like the Electron build.
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
    // TODO: hidden title bar with a themed overlay, as Electron's titleBarStyle hidden does.
    window.show()
}

fn focus_main_window(app: &tauri::AppHandle) {
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
        .register_uri_scheme_protocol("widget", |_ctx, request| {
            ipc::widgets::serve(&request.uri().to_string())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::ipc_invoke,
            ipc::ipc_send,
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
            ipc::api_server::apply_saved(app.handle());
            ipc::mcp::adopt_stored_credentials(app.handle());
            ipc::providers::start_auto_refresh(app.handle());
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
