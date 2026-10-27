use adw::prelude::*;
use std::rc::Rc;

use super::GitCommitDetail::GitCommitDetailWidget;
use super::GitHistoryView::build_commit_row;
use super::SplitDiffView;
use super::UnifiedDiffView;
use crate::services::diff_parser::parse_git_diff;
use crate::services::git_operations::{git_diff, git_log};

pub fn build(dir: &str) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();

    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let title = gtk::Label::builder()
        .label("Changes & Diff")
        .css_classes(["title-4"])
        .build();

    header.append(&title);

    let content_stack = gtk::Stack::builder().vexpand(true).hexpand(true).build();

    let diff_raw = git_diff(dir);
    let diffs = parse_git_diff(&diff_raw);

    if diffs.is_empty() {
        let empty_lbl = gtk::Label::builder()
            .label("No working tree changes")
            .css_classes(["dim-label"])
            .build();
        content_stack.add_child(&empty_lbl);
    } else if let Some(first_diff) = diffs.first() {
        let view = SplitDiffView::build(first_diff);
        content_stack.add_child(&view);
    }

    main_box.append(&header);
    main_box.append(&content_stack);

    main_box.upcast()
}
