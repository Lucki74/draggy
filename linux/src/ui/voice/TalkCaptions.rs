use adw::prelude::*;

pub fn build_captions() -> gtk::Box {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .halign(gtk::Align::Center)
        .build();

    let user_lbl = gtk::Label::builder()
        .label("")
        .css_classes(["dim-label"])
        .wrap(true)
        .build();

    let assistant_lbl = gtk::Label::builder()
        .label("Listening...")
        .css_classes(["title-3"])
        .wrap(true)
        .build();

    vbox.append(&user_lbl);
    vbox.append(&assistant_lbl);
    vbox
}
