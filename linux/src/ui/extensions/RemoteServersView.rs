use adw::prelude::*;
use std::rc::Rc;

use crate::services::extension_store::ExtensionStore;

pub fn build(store: Rc<ExtensionStore>) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .build();
    list_box.add_css_class("boxed-list");

    let servers = store.remote_servers.lock().unwrap().clone();
    for srv in servers {
        let row = adw::ActionRow::builder()
            .title(&srv.name)
            .subtitle(&srv.url)
            .build();
        list_box.append(&row);
    }

    let add_btn = gtk::Button::with_label("Add Server");
    add_btn.add_css_class("suggested-action");

    main_box.append(&list_box);
    main_box.append(&add_btn);

    main_box.upcast()
}
