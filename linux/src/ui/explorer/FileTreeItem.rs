use crate::services::file_operations::FileTreeEntry;
use adw::prelude::*;

pub fn build_row(entry: &FileTreeEntry) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    let hbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(8)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let icon_name = if entry.is_directory {
        "folder-symbolic"
    } else {
        "text-x-generic-symbolic"
    };

    let icon = gtk::Image::from_icon_name(icon_name);
    let label = gtk::Label::builder()
        .label(&entry.name)
        .xalign(0.0)
        .hexpand(true)
        .build();

    hbox.append(&icon);
    hbox.append(&label);
    row.set_child(Some(&hbox));

    row
}
