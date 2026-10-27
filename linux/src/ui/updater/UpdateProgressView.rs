use adw::prelude::*;

pub fn build_progress_bar(fraction: f64) -> gtk::ProgressBar {
    gtk::ProgressBar::builder()
        .fraction(fraction)
        .show_text(true)
        .build()
}
