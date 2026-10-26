use adw::prelude::*;

pub fn build_editor(path: &str) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .build();

    let title = gtk::Label::builder()
        .label(path)
        .css_classes(["heading"])
        .build();
    let save_btn = gtk::Button::with_label("Save");
    save_btn.add_css_class("suggested-action");

    header.append(&title);
    let spacer = gtk::Box::builder().hexpand(true).build();
    header.append(&spacer);
    header.append(&save_btn);

    let text_view = gtk::TextView::builder()
        .monospace(true)
        .vexpand(true)
        .hexpand(true)
        .build();

    if let Ok(content) = std::fs::read_to_string(path) {
        text_view.buffer().set_text(&content);
    }

    vbox.append(&header);
    vbox.append(&text_view);

    vbox.upcast()
}
