use adw::prelude::*;
use std::rc::Rc;

use super::UsageChartView::{build_chart, build_cost_chart};
use crate::services::stats_store::{CostSummary, Share, StatsStore, format_money};

/// The stats page. It is filled again each time it is shown, so the figures stay current.
pub fn build(store: Rc<StatsStore>) -> gtk::Widget {
    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    fill(&content, &store);

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&content)
        .build();

    let refresh = (content, store);
    scroll.connect_map(move |_| fill(&refresh.0, &refresh.1));

    scroll.upcast()
}

/// Replaces the page's contents with the current figures.
fn fill(content: &gtk::Box, store: &StatsStore) {
    while let Some(child) = content.first_child() {
        content.remove(&child);
    }

    let title = gtk::Label::builder()
        .label("Hardware & Session Stats")
        .css_classes(["title-2"])
        .xalign(0.0)
        .build();
    content.append(&title);

    let prompt = *store.total_prompt.lock().unwrap();
    let comp = *store.total_completion.lock().unwrap();
    content.append(&card_row(&[
        ("Prompt Tokens", prompt.to_string()),
        ("Completion Tokens", comp.to_string()),
    ]));

    let history = store.history.lock().unwrap().clone();
    content.append(&build_chart(&history));

    content.append(&heading("Cost"));
    match store.cost_summary() {
        Some(summary) => cost_section(content, &summary),
        None => content.append(&note("Costs are not kept: the local database did not open.")),
    }
}

/// The money figures, the cost of each day, and the breakdown tables.
fn cost_section(content: &gtk::Box, summary: &CostSummary) {
    let estimated = summary.estimated;
    content.append(&card_row(&[
        ("Spent on the API", format_money(summary.spent_micros, estimated)),
        (
            "Account logins, API-equivalent",
            format_money(summary.plan_value_micros, estimated),
        ),
        ("Saved on local models", format_money(summary.saved_micros, estimated)),
        ("Unpriced replies", summary.unpriced.to_string()),
    ]));
    content.append(&build_cost_chart(&summary.days, estimated));
    content.append(&share_group("By provider", &summary.providers, estimated));
    content.append(&share_group("By model", &summary.models, estimated));
    content.append(&share_group("By workspace", &summary.workspaces, estimated));
}

/// A row of figures, each a card with its name as the title and its value as the subtitle.
fn card_row(figures: &[(&str, String)]) -> gtk::Box {
    let row = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(12)
        .build();
    for (name, value) in figures {
        let card = adw::ActionRow::builder()
            .title(*name)
            .subtitle(value.as_str())
            .hexpand(true)
            .build();
        row.append(&card);
    }
    row
}

/// A breakdown table: one row per provider, model or workspace, with its reply count and cost.
fn share_group(title: &str, shares: &[Share], estimated: bool) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder().title(title).build();
    if shares.is_empty() {
        group.add(&adw::ActionRow::builder().title("No replies yet").build());
    }
    for share in shares {
        let noun = if share.replies == 1 { "reply" } else { "replies" };
        let unpriced = if share.unpriced > 0 {
            format!(" · {} unpriced", share.unpriced)
        } else {
            String::new()
        };
        let subtitle = format!(
            "{} {noun} · {}{unpriced}",
            share.replies,
            format_money(share.micros, estimated)
        );
        let row = adw::ActionRow::builder()
            .title(share.label.as_str())
            .subtitle(subtitle.as_str())
            .build();
        group.add(&row);
    }
    group
}

fn heading(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .css_classes(["title-3"])
        .xalign(0.0)
        .margin_top(6)
        .build()
}

fn note(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .css_classes(["dim-label"])
        .xalign(0.0)
        .wrap(true)
        .build()
}
