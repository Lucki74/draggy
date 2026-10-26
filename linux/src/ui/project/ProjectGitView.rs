use adw::prelude::*;
use crate::services::git_status_monitor::get_git_status;

pub fn build(dir: &str) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let title = gtk::Label::builder()
        .label("Git Repository Status")
        .css_classes(["title-3"])
        .xalign(0.0)
        .build();

    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .build();
    list_box.add_css_class("boxed-list");

    let status = get_git_status(dir);
    for m in status.modified {
        let row = adw::ActionRow::builder()
            .title(&m)
            .subtitle("Modified")
            .build();
        list_box.append(&row);
    }
    for u in status.untracked {
        let row = adw::ActionRow::builder()
            .title(&u)
            .subtitle("Untracked")
            .build();
        list_box.append(&row);
    }

    vbox.append(&title);
    vbox.append(&list_box);

    vbox.upcast()
}
