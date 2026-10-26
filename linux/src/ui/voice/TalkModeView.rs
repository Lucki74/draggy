use adw::prelude::*;

use super::TalkCaptions::build_captions;
use super::TalkControls::build_controls;
use super::VoiceHeatView::build_heat_indicator;

pub fn build() -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(24)
        .valign(gtk::Align::Center)
        .vexpand(true)
        .hexpand(true)
        .build();

    let heat = build_heat_indicator();
    let captions = build_captions();
    let controls = build_controls();

    main_box.append(&heat);
    main_box.append(&captions);
    main_box.append(&controls);

    main_box.upcast()
}
