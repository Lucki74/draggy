use adw::prelude::*;
use crate::services::git_operations::GitCommitInfo;

pub fn build_commit_row(commit: &GitCommitInfo) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(2)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(8)
        .build();

    let hash_lbl = gtk::Label::builder()
        .label(&commit.hash)
        .css_classes(["heading", "monospace"])
        .build();

    let author_lbl = gtk::Label::builder()
        .label(&commit.author)
        .css_classes(["dim-label"])
        .build();

    let date_lbl = gtk::Label::builder()
        .label(&commit.date)
        .css_classes(["dim-label"])
        .hexpand(true)
        .xalign(1.0)
        .build();

    header.append(&hash_lbl);
    header.append(&author_lbl);
    header.append(&date_lbl);

    let msg_lbl = gtk::Label::builder()
        .label(&commit.message)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .xalign(0.0)
        .build();

    vbox.append(&header);
    vbox.append(&msg_lbl);
    row.set_child(Some(&vbox));

    row
}
