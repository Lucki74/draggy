use adw::prelude::*;
use std::rc::Rc;

use super::UsageChartView::build_chart;
use crate::services::stats_store::StatsStore;

pub fn build(store: Rc<StatsStore>) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let title = gtk::Label::builder()
        .label("Hardware & Session Stats")
        .css_classes(["title-2"])
        .xalign(0.0)
        .build();

    main_box.append(&title);

    let prompt = *store.total_prompt.lock().unwrap();
    let comp = *store.total_completion.lock().unwrap();

    let cards_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(12)
        .build();

    let prompt_card = adw::ActionRow::builder()
        .title("Prompt Tokens")
        .subtitle(&prompt.to_string())
        .build();

    let comp_card = adw::ActionRow::builder()
        .title("Completion Tokens")
        .subtitle(&comp.to_string())
        .build();

    cards_box.append(&prompt_card);
    cards_box.append(&comp_card);
    main_box.append(&cards_box);

    let history = store.history.lock().unwrap().clone();
    let chart = build_chart(&history);
    main_box.append(&chart);

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&main_box)
        .build();

    scroll.upcast()
}
