use crate::services::diff_parser::{DiffLine, DiffLineType, FileDiff};
use adw::prelude::*;

/// A code label that wraps at any character, so a long line never scrolls sideways.
pub fn code_label(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .css_classes(["monospace", "diff-text"])
        .xalign(0.0)
        .hexpand(true)
        .wrap(true)
        .wrap_mode(gtk::pango::WrapMode::WordChar)
        .selectable(true)
        .build()
}

pub fn number_label(number: Option<usize>) -> gtk::Label {
    gtk::Label::builder()
        .label(number.map(|n| n.to_string()).unwrap_or_default())
        .css_classes(["dim-label", "monospace", "diff-num"])
        .width_chars(4)
        .valign(gtk::Align::Start)
        .xalign(1.0)
        .build()
}

pub fn line_class(line: &DiffLine) -> Option<&'static str> {
    match line.line_type {
        DiffLineType::Add => Some("diff-add"),
        DiffLineType::Delete => Some("diff-delete"),
        DiffLineType::Header => Some("diff-header"),
        DiffLineType::Context => None,
    }
}

pub fn build(diff: &FileDiff) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .css_classes(["diff-body"])
        .build();
    for line in &diff.lines {
        let row = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(8)
            .build();
        if let Some(class) = line_class(line) {
            row.add_css_class(class);
        }
        row.append(&number_label(line.new_line_num.or(line.old_line_num)));
        row.append(&code_label(&line.text));
        vbox.append(&row);
    }
    vbox.upcast()
}
