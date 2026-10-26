use crate::services::search_engine::SearchResult;
use adw::prelude::*;

pub fn build_result_row(item: &SearchResult) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(2)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let title_line = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .build();

    let name_label = gtk::Label::builder()
        .label(&item.file_name)
        .css_classes(["heading"])
        .xalign(0.0)
        .build();

    let line_label = gtk::Label::builder()
        .label(&format!(":{}", item.line_number))
        .css_classes(["dim-label"])
        .xalign(0.0)
        .build();

    title_line.append(&name_label);
    title_line.append(&line_label);

    let snippet_label = gtk::Label::builder()
        .label(&item.snippet)
        .css_classes(["monospace"])
        .xalign(0.0)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .build();

    vbox.append(&title_line);
    vbox.append(&snippet_label);
    row.set_child(Some(&vbox));

    row
}
