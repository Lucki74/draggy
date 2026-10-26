use adw::prelude::*;
use std::rc::Rc;

use super::ImageHistoryView::build_history_list;
use super::ImageModelSelector::build_selector;
use crate::services::image_engine::ImageEngine;

pub fn build(engine: Rc<ImageEngine>) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .vexpand(true)
        .hexpand(true)
        .build();

    let title = gtk::Label::builder()
        .label("Image Generation")
        .css_classes(["title-2"])
        .xalign(0.0)
        .build();

    let selector = build_selector();

    let prompt_entry = gtk::Entry::builder()
        .placeholder_text("Enter prompt for image generation...")
        .hexpand(true)
        .build();

    let gen_btn = gtk::Button::with_label("Generate");
    gen_btn.add_css_class("suggested-action");

    let input_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(8)
        .build();
    input_box.append(&prompt_entry);
    input_box.append(&gen_btn);

    main_box.append(&title);
    main_box.append(&selector);
    main_box.append(&input_box);

    let history = engine.history.lock().unwrap().clone();
    let history_widget = build_history_list(&history);
    main_box.append(&history_widget);

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&main_box)
        .build();

    scroll.upcast()
}
