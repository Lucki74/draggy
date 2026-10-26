use adw::prelude::*;

pub fn build_step(title: &str, subtitle: &str, icon_name: &str) -> gtk::Box {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .build();

    let icon = gtk::Image::from_icon_name(icon_name);
    icon.set_pixel_size(64);

    let title_lbl = gtk::Label::builder()
        .label(title)
        .css_classes(["title-1"])
        .build();

    let sub_lbl = gtk::Label::builder()
        .label(subtitle)
        .css_classes(["body", "dim-label"])
        .wrap(true)
        .justify(gtk::Justification::Center)
        .build();

    vbox.append(&icon);
    vbox.append(&title_lbl);
    vbox.append(&sub_lbl);
    vbox
}
