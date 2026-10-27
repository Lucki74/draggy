use adw::prelude::*;

pub fn build_bar() -> gtk::ProgressBar {
    gtk::ProgressBar::builder()
        .show_text(true)
        .fraction(0.3)
        .build()
}
