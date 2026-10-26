use adw::prelude::*;
use crate::services::diff_parser::{DiffLineType, FileDiff};

pub fn build(diff: &FileDiff) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(1)
        .build();

    for line in &diff.lines {
        let row = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(8)
            .margin_start(4)
            .margin_end(4)
            .build();

        let num_str = line
            .new_line_num
            .or(line.old_line_num)
            .map(|n| n.to_string())
            .unwrap_or_default();

        let num_lbl = gtk::Label::builder()
            .label(&num_str)
            .css_classes(["dim-label", "monospace"])
            .width_chars(5)
            .xalign(1.0)
            .build();

        let text_lbl = gtk::Label::builder()
            .label(&line.text)
            .css_classes(["monospace"])
            .xalign(0.0)
            .hexpand(true)
            .build();

        match line.line_type {
            DiffLineType::Add => {
                row.add_css_class("diff-add");
            }
            DiffLineType::Delete => {
                row.add_css_class("diff-delete");
            }
            DiffLineType::Header => {
                row.add_css_class("diff-header");
            }
            DiffLineType::Context => {}
        }

        row.append(&num_lbl);
        row.append(&text_lbl);
        vbox.append(&row);
    }

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .hexpand(true)
        .child(&vbox)
        .build();

    scroll.upcast()
}
