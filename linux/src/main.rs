//! The Draggy window. Everything that is not widget code lives in the library so it can be tested without a display.

mod agy_view;
mod browser_view;
mod chat_view;
#[cfg(test)]
mod gtk_test;
mod models_view;
mod servers_view;
mod services;
mod settings_dialog;
mod skills_view;
mod state;
mod tasks_view;
mod ui;
mod window;

use adw::prelude::*;
use draggy_linux::APP_ID;
use gtk::{gdk, gio, glib};

/// Keeps the color tokens that match the system's light or dark setting loaded.
fn install_styles() {
    let Some(display) = gdk::Display::default() else {
        return;
    };
    let common = gtk::CssProvider::new();
    common.load_from_resource("/com/draggy/Draggy/style.css");
    gtk::style_context_add_provider_for_display(
        &display,
        &common,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
    let tokens = gtk::CssProvider::new();
    gtk::style_context_add_provider_for_display(
        &display,
        &tokens,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
    let manager = adw::StyleManager::default();
    let apply = move |manager: &adw::StyleManager| {
        let name = if manager.is_dark() { "dark" } else { "light" };
        tokens.load_from_resource(&format!("/com/draggy/Draggy/{name}.css"));
    };
    apply(&manager);
    manager.connect_dark_notify(apply);
}

fn main() -> glib::ExitCode {
    gio::resources_register_include!("draggy.gresource").expect("the bundled resources register");
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_startup(|_| install_styles());
    app.connect_activate(|app| {
        let window = app
            .active_window()
            .unwrap_or_else(|| window::DraggyWindow::new(app).upcast());
        window.present();
    });
    app.run()
}
