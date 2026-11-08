use super::UnifiedDiffView::{code_label, line_class, number_label};
use crate::services::diff_parser::{DiffLine, DiffLineType, FileDiff, pair_lines};
use adw::prelude::*;

fn cell(line: Option<&DiffLine>, old_side: bool) -> gtk::Box {
    let cell = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .hexpand(true)
        .build();
    if let Some(line) = line {
        if let Some(class) = line_class(line) {
            cell.add_css_class(class);
        }
        let number = if old_side {
            line.old_line_num
        } else {
            line.new_line_num
        };
        cell.append(&number_label(number));
        cell.append(&code_label(&line.text));
    }
    cell
}

pub fn build(diff: &FileDiff) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .css_classes(["diff-body"])
        .build();
    for (old, new) in pair_lines(&diff.lines) {
        if let Some(header) = old.filter(|l| l.line_type == DiffLineType::Header) {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 0);
            row.add_css_class("diff-header");
            row.append(&code_label(&header.text));
            vbox.append(&row);
            continue;
        }
        let row = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .homogeneous(true)
            .spacing(2)
            .build();
        row.append(&cell(old, true));
        row.append(&cell(new, false));
        vbox.append(&row);
    }
    vbox.upcast()
}
