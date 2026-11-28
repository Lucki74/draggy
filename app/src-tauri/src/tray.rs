//! The tray icon, so routines and the Telegram gateway keep a visible handle while the window is shut.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const SHOW: &str = "tray-show";
const QUIT: &str = "tray-quit";

/// Adds the icon with Show Draggy and Quit. A failure only costs the tray, so it is logged and skipped.
pub fn install(app: &AppHandle) {
    if let Err(error) = build(app)
        && let Some(state) = app.try_state::<crate::AppState>()
    {
        state
            .diag
            .warn("tray", &format!("tray unavailable: {error}"), None);
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW, "Show Draggy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Draggy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW => crate::focus_main_window(app),
            QUIT => crate::begin_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::focus_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
