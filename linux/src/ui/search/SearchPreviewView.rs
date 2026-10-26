use crate::services::search_engine::SearchResult;
use adw::prelude::*;

pub struct SearchPreviewWidget {
    pub container: gtk::Box,
    pub text_view: gtk::TextView,
    pub title_label: gtk::Label,
}

impl SearchPreviewWidget {
    pub fn new() -> Self {
        let container = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .vexpand(true)
            .hexpand(true)
            .build();

        let header = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .margin_start(8)
            .margin_end(8)
            .margin_top(6)
            .margin_bottom(6)
            .build();

        let title_label = gtk::Label::builder()
            .label("Select a result to preview")
            .css_classes(["title-4"])
            .xalign(0.0)
            .build();

        header.append(&title_label);

        let text_view = gtk::TextView::builder()
            .editable(false)
            .monospace(true)
            .vexpand(true)
            .hexpand(true)
            .build();

        let scroll = gtk::ScrolledWindow::builder()
            .vexpand(true)
            .hexpand(true)
            .child(&text_view)
            .build();

        container.append(&header);
        container.append(&scroll);

        Self {
            container,
            text_view,
            title_label,
        }
    }

    pub fn show_result(&self, result: &SearchResult) {
        self.title_label.set_label(&format!(
            "{} (line {})",
            result.file_name, result.line_number
        ));

        if let Ok(content) = std::fs::read_to_string(&result.file_path) {
            let buffer = self.text_view.buffer();
            buffer.set_text(&content);
        }
    }

    pub fn widget(&self) -> gtk::Widget {
        self.container.clone().upcast()
    }
}
