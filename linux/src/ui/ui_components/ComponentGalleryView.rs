use adw::prelude::*;

use super::DockPanelView::build_dock;
use super::SignatureView::build_signature;

pub fn build_gallery() -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(16)
        .margin_start(16)
        .margin_end(16)
        .margin_top(16)
        .margin_bottom(16)
        .build();

    let sig = build_signature("Llama-3.2-3B");
    let dock = build_dock();

    vbox.append(&sig);
    vbox.append(&dock);

    vbox.upcast()
}
