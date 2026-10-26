use adw::prelude::*;

pub fn build() -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let title = gtk::Label::builder()
        .label("Document Generator")
        .css_classes(["title-2"])
        .xalign(0.0)
        .build();

    let title_entry = gtk::Entry::builder()
        .placeholder_text("Document Title...")
        .build();

    let text_view = gtk::TextView::builder()
        .vexpand(true)
        .hexpand(true)
        .build();

    let gen_btn = gtk::Button::with_label("Export DOCX");
    gen_btn.add_css_class("suggested-action");

    vbox.append(&title);
    vbox.append(&title_entry);
    vbox.append(&text_view);
    vbox.append(&gen_btn);

    vbox.upcast()
}
