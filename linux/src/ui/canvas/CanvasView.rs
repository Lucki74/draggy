use adw::prelude::*;
use std::rc::Rc;

use crate::services::canvas_store::CanvasStore;

pub fn build(store: Rc<CanvasStore>) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();

    let toolbar = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(8)
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let title = gtk::Label::builder()
        .label("Canvas")
        .css_classes(["title-3"])
        .build();

    let add_btn = gtk::Button::with_label("Add Note");
    add_btn.add_css_class("suggested-action");

    toolbar.append(&title);
    let spacer = gtk::Box::builder().hexpand(true).build();
    toolbar.append(&spacer);
    toolbar.append(&add_btn);

    let drawing_area = gtk::DrawingArea::builder()
        .vexpand(true)
        .hexpand(true)
        .build();

    let store_clone = Rc::clone(&store);
    add_btn.connect_clicked(move |_| {
        store_clone.add_note(100.0, 100.0, "New Note");
    });

    main_box.append(&toolbar);
    main_box.append(&drawing_area);

    main_box.upcast()
}
