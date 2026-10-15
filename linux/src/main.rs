//! The Draggy window. Everything that is not widget code lives in the library so it can be tested without a display.

use adw::prelude::*;
use draggy_linux::APP_ID;

fn main() -> gtk::glib::ExitCode {
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_activate(|app| {
        let window = adw::ApplicationWindow::builder()
            .application(app)
            .title("Draggy")
            .default_width(1100)
            .default_height(720)
            .build();
        window.present();
    });
    app.run()
}
