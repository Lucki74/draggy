use crate::services::diff_parser::{DiffLineType, FileDiff};
use adw::prelude::*;

pub fn build(diff: &FileDiff) -> gtk::Widget {
    let paned = gtk::Paned::builder()
        .orientation(gtk::Orientation::Horizontal)
        .vexpand(true)
        .hexpand(true)
        .build();

    let left_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(1)
        .build();

    let right_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(1)
        .build();

    for line in &diff.lines {
        if line.line_type != DiffLineType::Add {
            let row = gtk::Box::builder()
                .orientation(gtk::Orientation::Horizontal)
                .spacing(6)
                .margin_start(4)
                .margin_end(4)
                .build();
            let num = line.old_line_num.map(|n| n.to_string()).unwrap_or_default();
            let num_lbl = gtk::Label::builder()
                .label(&num)
                .css_classes(["dim-label", "monospace"])
                .width_chars(4)
                .xalign(1.0)
                .build();
            let txt_lbl = gtk::Label::builder()
                .label(&line.text)
                .css_classes(["monospace"])
                .xalign(0.0)
                .hexpand(true)
                .build();
            if line.line_type == DiffLineType::Delete {
                row.add_css_class("diff-delete");
            }
            row.append(&num_lbl);
            row.append(&txt_lbl);
            left_box.append(&row);
        }

        if line.line_type != DiffLineType::Delete {
            let row = gtk::Box::builder()
                .orientation(gtk::Orientation::Horizontal)
                .spacing(6)
                .margin_start(4)
                .margin_end(4)
                .build();
            let num = line.new_line_num.map(|n| n.to_string()).unwrap_or_default();
            let num_lbl = gtk::Label::builder()
                .label(&num)
                .css_classes(["dim-label", "monospace"])
                .width_chars(4)
                .xalign(1.0)
                .build();
            let txt_lbl = gtk::Label::builder()
                .label(&line.text)
                .css_classes(["monospace"])
                .xalign(0.0)
                .hexpand(true)
                .build();
            if line.line_type == DiffLineType::Add {
                row.add_css_class("diff-add");
            }
            row.append(&num_lbl);
            row.append(&txt_lbl);
            right_box.append(&row);
        }
    }

    let left_scroll = gtk::ScrolledWindow::builder().child(&left_box).build();
    let right_scroll = gtk::ScrolledWindow::builder().child(&right_box).build();

    paned.set_start_child(Some(&left_scroll));
    paned.set_end_child(Some(&right_scroll));

    paned.upcast()
}
