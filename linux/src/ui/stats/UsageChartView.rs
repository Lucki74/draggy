use crate::services::stats_store::{DayCost, UsageHistoryItem, format_money};
use adw::prelude::*;

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

/// The cost of each day as a bar, scaled to the most expensive day. Each bar's tooltip gives its day and figure.
pub fn build_cost_chart(days: &[DayCost], estimated: bool) -> gtk::Widget {
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
        .label("Cost per day")
        .css_classes(["heading"])
        .xalign(0.0)
        .build();

    vbox.append(&title);

    let peak = days.iter().map(|day| day.micros).max().unwrap_or(0);
    if peak <= 0 {
        let empty = gtk::Label::builder()
            .label(format!("No cost recorded in the last {} days", days.len()))
            .css_classes(["dim-label"])
            .xalign(0.0)
            .build();
        vbox.append(&empty);
    } else {
        let bar_box = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(4)
            .height_request(60)
            .build();

        for day in days {
            let bar = gtk::ProgressBar::builder()
                .orientation(gtk::Orientation::Vertical)
                .inverted(true)
                .fraction(day.micros as f64 / peak as f64)
                .hexpand(true)
                .build();
            let tip = format!("{}: {}", day.label, format_money(day.micros, estimated));
            bar.set_tooltip_text(Some(tip.as_str()));
            bar_box.append(&bar);
        }
        vbox.append(&bar_box);
    }

    frame.set_child(Some(&vbox));
    frame.upcast()
}
