use adw::prelude::*;

pub fn build_heat_indicator() -> gtk::Widget {
    let circle = gtk::Box::builder()
        .width_request(80)
        .height_request(80)
        .halign(gtk::Align::Center)
        .valign(gtk::Align::Center)
        .css_classes(["voice-heat-circle"])
        .build();

    circle.upcast()
}
