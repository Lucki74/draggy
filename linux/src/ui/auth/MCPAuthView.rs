use adw::prelude::*;

pub fn build(server_name: &str) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(16)
        .margin_bottom(16)
        .build();

    let title = gtk::Label::builder()
        .label(&format!("Authenticate with {}", server_name))
        .css_classes(["title-3"])
        .build();

    let desc = gtk::Label::builder()
        .label("Sign in to authorize MCP server capabilities.")
        .css_classes(["dim-label"])
        .build();

    let btn = gtk::Button::with_label("Open Browser to Login");
    btn.add_css_class("suggested-action");

    vbox.append(&title);
    vbox.append(&desc);
    vbox.append(&btn);

    vbox.upcast()
}
