//! The Servers page: the MCP catalogue with a search box, and a button to start or stop each server.

use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use draggy_core::{McpManager, mcp_catalogue};
use draggy_linux::runtime::runtime;
use draggy_linux::servers::{action_label, subtitle};
use gtk::glib;

use crate::state::AppState;

/// Builds the page. `notify` shows a short message, such as a server that failed to start.
pub fn build(state: &Rc<AppState>, notify: impl Fn(&str) + 'static) -> gtk::Widget {
    let search = gtk::SearchEntry::builder()
        .placeholder_text("Search servers")
        .margin_top(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&list)
        .build();
    let page = gtk::Box::new(gtk::Orientation::Vertical, 0);
    page.append(&search);
    page.append(&scroll);

    let notify: Rc<dyn Fn(&str)> = Rc::new(notify);
    let refresh = Rc::new({
        let state = state.clone();
        let list = list.clone();
        let search = search.clone();
        move || fill(&state, &list, &search, notify.clone())
    });
    search.connect_search_changed({
        let refresh = refresh.clone();
        move |_| refresh()
    });
    page.connect_map(move |_| refresh());
    page.upcast()
}

/// Rebuilds the rows from the catalogue and the servers now running.
fn fill(
    state: &Rc<AppState>,
    list: &gtk::ListBox,
    search: &gtk::SearchEntry,
    notify: Rc<dyn Fn(&str)>,
) {
    let Some(mcp) = state.mcp() else {
        replace(list, &[message_row("The MCP manager could not start.")]);
        return;
    };
    let query = search.text().to_string();
    let list = list.clone();
    let search = search.clone();
    let state = state.clone();
    glib::spawn_future_local(async move {
        let manager = mcp.clone();
        let running: HashSet<String> = runtime()
            .spawn(async move { manager.list().await })
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|server| server.status == "running")
            .map(|server| server.id)
            .collect();
        let rows: Vec<gtk::Widget> = mcp_catalogue(query)
            .into_iter()
            .map(|server| {
                let on = running.contains(&server.id);
                let row = adw::ActionRow::builder()
                    .title(glib::markup_escape_text(&server.name))
                    .subtitle(glib::markup_escape_text(&subtitle(
                        &server.description,
                        server.caution.as_deref(),
                    )))
                    .subtitle_lines(0)
                    .build();
                let button = gtk::Button::builder()
                    .label(action_label(on))
                    .valign(gtk::Align::Center)
                    .css_classes([if on {
                        "destructive-action"
                    } else {
                        "suggested-action"
                    }])
                    .build();
                let (mcp, notify, state, list, search) = (
                    mcp.clone(),
                    notify.clone(),
                    state.clone(),
                    list.clone(),
                    search.clone(),
                );
                let id = server.id;
                button.connect_clicked(move |button| {
                    button.set_sensitive(false);
                    toggle(&mcp, id.clone(), on, &notify, &state, &list, &search);
                });
                row.add_suffix(&button);
                row.upcast()
            })
            .collect();
        if rows.is_empty() {
            replace(&list, &[message_row("No server matches.")]);
        } else {
            replace(&list, &rows);
        }
    });
}

/// Starts or stops one server, then redraws the page.
fn toggle(
    mcp: &Arc<McpManager>,
    id: String,
    running: bool,
    notify: &Rc<dyn Fn(&str)>,
    state: &Rc<AppState>,
    list: &gtk::ListBox,
    search: &gtk::SearchEntry,
) {
    let (mcp, notify, state, list, search) = (
        mcp.clone(),
        notify.clone(),
        state.clone(),
        list.clone(),
        search.clone(),
    );
    glib::spawn_future_local(async move {
        let manager = mcp.clone();
        let target = id.clone();
        let outcome = runtime()
            .spawn(async move {
                if running {
                    manager.stop(target).await;
                    None
                } else {
                    let started = manager.start(target, None).await;
                    (started.status != "running").then(|| started.error.unwrap_or(started.status))
                }
            })
            .await;
        if let Ok(Some(reason)) = outcome {
            notify(&format!("{id} did not start: {reason}"));
        }
        fill(&state, &list, &search, notify);
    });
}

fn replace(list: &gtk::ListBox, rows: &[impl IsA<gtk::Widget>]) {
    while let Some(child) = list.first_child() {
        list.remove(&child);
    }
    for row in rows {
        list.append(row);
    }
}

fn message_row(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .margin_top(24)
        .margin_bottom(24)
        .css_classes(["dim-label"])
        .build()
}
