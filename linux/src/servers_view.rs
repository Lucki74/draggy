//! The Servers page: the MCP catalogue with a search box, and a button to start or stop each server.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use draggy_core::{McpInputRecord, McpManager, mcp_catalogue};
use draggy_linux::runtime::runtime;
use draggy_linux::servers::{action_label, build_config, missing_required, secret_name, subtitle};
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
                let id = server.id.clone();
                let inputs = server.inputs.clone();
                if !inputs.is_empty() {
                    let gear = gtk::Button::builder()
                        .icon_name("emblem-system-symbolic")
                        .tooltip_text("Server settings")
                        .valign(gtk::Align::Center)
                        .css_classes(["flat"])
                        .build();
                    let (state, notify, list) = (state.clone(), notify.clone(), list.clone());
                    let (id, name, inputs) = (id.clone(), server.name.clone(), inputs.clone());
                    gear.connect_clicked(move |_| {
                        open_settings(&state, &id, &name, &inputs, &notify, &list);
                    });
                    row.add_suffix(&gear);
                }
                button.connect_clicked(move |button| {
                    button.set_sensitive(false);
                    let target = Target {
                        id: id.clone(),
                        inputs: inputs.clone(),
                        running: on,
                    };
                    toggle(&mcp, target, &notify, &state, &list, &search);
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

/// The server a button acts on.
struct Target {
    id: String,
    inputs: Vec<McpInputRecord>,
    running: bool,
}

/// Starts or stops one server, then redraws the page.
fn toggle(
    mcp: &Arc<McpManager>,
    target: Target,
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
        let Target {
            id,
            inputs,
            running,
        } = target;
        let mut config = None;
        if !running {
            let values = saved_values(&state, &id, &inputs).await;
            if let Some(label) = missing_required(&inputs, &values) {
                notify(&format!("{id} needs {label}. Open its settings first."));
                fill(&state, &list, &search, notify);
                return;
            }
            config = build_config(&inputs, &values);
        }
        let manager = mcp.clone();
        let name = id.clone();
        let outcome = runtime()
            .spawn(async move {
                if running {
                    manager.stop(name).await;
                    None
                } else {
                    let started = manager.start(name, config).await;
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

/// Every saved value of a server: plain ones from the file, secrets from the keyring.
async fn saved_values(
    state: &Rc<AppState>,
    id: &str,
    inputs: &[McpInputRecord],
) -> HashMap<String, String> {
    let mut values = state.plain.as_ref().map(|p| p.load(id)).unwrap_or_default();
    let secrets: Vec<(String, String)> = inputs
        .iter()
        .filter(|input| input.secret)
        .map(|input| (input.key.clone(), secret_name(id, &input.key)))
        .collect();
    if secrets.is_empty() {
        return values;
    }
    let store = state.secrets.clone();
    let found = runtime()
        .spawn(async move {
            let mut found = Vec::new();
            for (key, name) in secrets {
                if let Ok(Some(value)) = store.get(&name).await {
                    found.push((key, value));
                }
            }
            found
        })
        .await
        .unwrap_or_default();
    values.extend(found);
    values
}

/// Writes plain values to the file and secrets to the keyring. An empty secret is removed.
async fn save_values(
    state: &Rc<AppState>,
    id: &str,
    inputs: &[McpInputRecord],
    values: HashMap<String, String>,
) -> Result<(), String> {
    let secret_keys: HashSet<&str> = inputs
        .iter()
        .filter(|input| input.secret)
        .map(|input| input.key.as_str())
        .collect();
    let (secrets, plain): (HashMap<_, _>, HashMap<_, _>) = values
        .into_iter()
        .partition(|(key, _)| secret_keys.contains(key.as_str()));
    let plain: HashMap<String, String> = plain
        .into_iter()
        .filter(|(_, value)| !value.trim().is_empty())
        .collect();
    if let Some(file) = &state.plain {
        file.save(id, plain).map_err(|error| error.to_string())?;
    }
    let store = state.secrets.clone();
    let names: Vec<(String, String)> = inputs
        .iter()
        .filter(|input| input.secret)
        .map(|input| {
            let value = secrets.get(&input.key).cloned().unwrap_or_default();
            (secret_name(id, &input.key), value)
        })
        .collect();
    runtime()
        .spawn(async move {
            for (name, value) in names {
                let done = if value.trim().is_empty() {
                    store.clear(&name).await
                } else {
                    store.set(&name, value.trim()).await
                };
                done.map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .await
        .unwrap_or_else(|error| Err(error.to_string()))
}

/// A dialog with one field per input of the server. Secret fields are masked.
fn open_settings(
    state: &Rc<AppState>,
    id: &str,
    name: &str,
    inputs: &[McpInputRecord],
    notify: &Rc<dyn Fn(&str)>,
    parent: &gtk::ListBox,
) {
    let group = adw::PreferencesGroup::builder()
        .description("Values the server reads when it starts. Secrets go to the keyring.")
        .build();
    let mut fields: Vec<(String, gtk::Editable)> = Vec::new();
    for input in inputs {
        let title = glib::markup_escape_text(&if input.required {
            format!("{} (required)", input.label)
        } else {
            input.label.clone()
        });
        let field: gtk::Editable = if input.secret {
            let row = adw::PasswordEntryRow::builder().title(title).build();
            group.add(&row);
            row.upcast()
        } else {
            let row = adw::EntryRow::builder().title(title).build();
            group.add(&row);
            row.upcast()
        };
        fields.push((input.key.clone(), field));
    }
    let save = gtk::Button::builder()
        .label("Save")
        .halign(gtk::Align::End)
        .css_classes(["suggested-action"])
        .margin_top(12)
        .build();
    let body = gtk::Box::new(gtk::Orientation::Vertical, 0);
    body.set_margin_top(12);
    body.set_margin_bottom(12);
    body.set_margin_start(12);
    body.set_margin_end(12);
    body.append(&group);
    body.append(&save);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&body));
    let dialog = adw::Dialog::builder()
        .title(name)
        .content_width(440)
        .child(&view)
        .build();

    let fill_fields = fields.clone();
    glib::spawn_future_local({
        let (state, id, inputs) = (state.clone(), id.to_owned(), inputs.to_vec());
        async move {
            let values = saved_values(&state, &id, &inputs).await;
            for (key, field) in &fill_fields {
                if let Some(value) = values.get(key) {
                    field.set_text(value);
                }
            }
        }
    });
    save.connect_clicked({
        let (state, id, inputs, notify) = (
            state.clone(),
            id.to_owned(),
            inputs.to_vec(),
            notify.clone(),
        );
        let dialog = dialog.clone();
        move |button| {
            button.set_sensitive(false);
            let values: HashMap<String, String> = fields
                .iter()
                .map(|(key, field)| (key.clone(), field.text().to_string()))
                .collect();
            let (state, id, inputs, notify, dialog, button) = (
                state.clone(),
                id.clone(),
                inputs.clone(),
                notify.clone(),
                dialog.clone(),
                button.clone(),
            );
            glib::spawn_future_local(async move {
                match save_values(&state, &id, &inputs, values).await {
                    Ok(()) => {
                        dialog.close();
                    }
                    Err(reason) => {
                        notify(&format!("Settings of {id} were not saved: {reason}"));
                        button.set_sensitive(true);
                    }
                }
            });
        }
    });
    dialog.present(Some(parent));
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
