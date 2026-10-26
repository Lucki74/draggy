use adw::prelude::*;
use std::rc::Rc;

use crate::services::draft_store::DraftStore;

pub fn build(store: Rc<DraftStore>) -> gtk::Widget {
    let paned = gtk::Paned::builder()
        .orientation(gtk::Orientation::Horizontal)
        .vexpand(true)
        .hexpand(true)
        .build();

    let sidebar = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .width_request(240)
        .build();

    let new_btn = gtk::Button::with_label("New Draft");
    new_btn.add_css_class("suggested-action");
    new_btn.set_margin_start(8);
    new_btn.set_margin_end(8);
    new_btn.set_margin_top(8);
    new_btn.set_margin_bottom(8);

    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .vexpand(true)
        .build();
    list_box.add_css_class("navigation-sidebar");

    sidebar.append(&new_btn);
    sidebar.append(&list_box);

    let editor_view = gtk::TextView::builder()
        .vexpand(true)
        .hexpand(true)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let store_clone = Rc::clone(&store);
    let list_clone = list_box.clone();
    new_btn.connect_clicked(move |_| {
        let draft = store_clone.create_draft("Untitled Draft", "");
        let row = gtk::ListBoxRow::new();
        let lbl = gtk::Label::builder()
            .label(&draft.title)
            .xalign(0.0)
            .margin_start(8)
            .margin_top(4)
            .margin_bottom(4)
            .build();
        row.set_child(Some(&lbl));
        list_clone.prepend(&row);
    });

    paned.set_start_child(Some(&sidebar));
    paned.set_end_child(Some(&editor_view));

    paned.upcast()
}
