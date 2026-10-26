use adw::prelude::*;
use crate::services::stats_store::UsageHistoryItem;

pub fn build_chart(history: &[UsageHistoryItem]) -> gtk::Widget {
    let frame = gtk::Frame::builder()
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .margin_start(8)
        .margin_end(8)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let title = gtk::Label::builder()
        .label("Token Usage Activity")
        .css_classes(["heading"])
        .xalign(0.0)
        .build();

    vbox.append(&title);

    if history.is_empty() {
        let empty = gtk::Label::builder()
            .label("No token usage recorded yet")
            .css_classes(["dim-label"])
            .build();
        vbox.append(&empty);
    } else {
        let bar_box = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(4)
            .height_request(60)
            .build();

        for item in history.iter().rev().take(20).rev() {
            let total = item.prompt_tokens + item.completion_tokens;
            let bar = gtk::ProgressBar::builder()
                .orientation(gtk::Orientation::Vertical)
                .inverted(true)
                .fraction((total as f64 / 4000.0).clamp(0.05, 1.0))
                .hexpand(true)
                .build();
            bar_box.append(&bar);
        }
        vbox.append(&bar_box);
    }

    frame.set_child(Some(&vbox));
    frame.upcast()
}
