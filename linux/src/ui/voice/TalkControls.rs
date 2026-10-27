use adw::prelude::*;

pub fn build_controls() -> gtk::Box {
    let hbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(16)
        .halign(gtk::Align::Center)
        .build();

    let mic_btn = gtk::Button::from_icon_name("audio-input-microphone-symbolic");
    mic_btn.add_css_class("circular");

    let end_btn = gtk::Button::from_icon_name("call-stop-symbolic");
    end_btn.add_css_class("destructive-action");
    end_btn.add_css_class("circular");

    hbox.append(&mic_btn);
    hbox.append(&end_btn);
    hbox
}
