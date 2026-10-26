use adw::prelude::*;
use crate::services::git_operations::GitCommitInfo;

pub struct GitCommitDetailWidget {
    pub container: gtk::Box,
    pub title_label: gtk::Label,
    pub meta_label: gtk::Label,
}

impl GitCommitDetailWidget {
    pub fn new() -> Self {
        let container = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .vexpand(true)
            .hexpand(true)
            .margin_start(12)
            .margin_end(12)
            .margin_top(8)
            .margin_bottom(8)
            .spacing(6)
            .build();

        let title_label = gtk::Label::builder()
            .label("Select a commit")
            .css_classes(["title-4"])
            .xalign(0.0)
            .build();

        let meta_label = gtk::Label::builder()
            .label("")
            .css_classes(["dim-label"])
            .xalign(0.0)
            .build();

        container.append(&title_label);
        container.append(&meta_label);

        Self {
            container,
            title_label,
            meta_label,
        }
    }

    pub fn show_commit(&self, commit: &GitCommitInfo) {
        self.title_label.set_label(&commit.message);
        self.meta_label.set_label(&format!(
            "Commit {} by {} on {}",
            commit.hash, commit.author, commit.date
        ));
    }

    pub fn widget(&self) -> gtk::Widget {
        self.container.clone().upcast()
    }
}
