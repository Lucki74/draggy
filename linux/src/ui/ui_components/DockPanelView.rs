use adw::prelude::*;

pub fn build_dock() -> gtk::Widget {
    let hbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .halign(gtk::Align::Center)
        .css_classes(["dock-panel"])
        .build();

    let chat_btn = gtk::Button::from_icon_name("chat-message-new-symbolic");
    let browser_btn = gtk::Button::from_icon_name("web-browser-symbolic");
    let term_btn = gtk::Button::from_icon_name("terminal-symbolic");

    hbox.append(&chat_btn);
    hbox.append(&browser_btn);
    hbox.append(&term_btn);

    hbox.upcast()
}
