//! The Google page: signing in to the Antigravity CLI, behind the terms warning, and routing chat through it.

use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use draggy_core::{AgyAccount, AgyStatus, agy_terms_warning};
use draggy_linux::runtime::runtime;

use crate::state::AppState;

struct Ui {
    state: Rc<AppState>,
    account: Arc<AgyAccount>,
    status: adw::ActionRow,
    sign_in: gtk::Button,
    sign_out: gtk::Button,
    route: adw::SwitchRow,
    model: adw::EntryRow,
    models: adw::ActionRow,
    notify: Box<dyn Fn(&str)>,
}

fn status_text(status: &AgyStatus) -> String {
    match (status.signed_in, &status.version) {
        (true, Some(version)) => format!("Signed in ({version})"),
        (true, None) => "Signed in".to_owned(),
        _ => "Not signed in".to_owned(),
    }
}

/// The page. `notify` shows a short message.
pub fn build(state: &Rc<AppState>, notify: impl Fn(&str) + 'static) -> gtk::Widget {
    let account = state.agy();
    let group = adw::PreferencesGroup::builder()
        .title("Google account")
        .description("Uses the Antigravity CLI (agy), which you sign in to yourself. Draggy never sees your Google credentials, and the CLI's own tools stay off.")
        .build();
    let status = adw::ActionRow::builder().title("Status").build();
    let sign_in = gtk::Button::builder()
        .label("Sign in")
        .valign(gtk::Align::Center)
        .css_classes(["suggested-action"])
        .build();
    let sign_out = gtk::Button::builder()
        .label("Sign out")
        .valign(gtk::Align::Center)
        .build();
    status.add_suffix(&sign_in);
    status.add_suffix(&sign_out);
    let route = adw::SwitchRow::builder()
        .title("Chat through Antigravity")
        .subtitle("Replies come from your Google account instead of the model server.")
        .build();
    let model = adw::EntryRow::builder().title("Model (optional)").build();
    let models = adw::ActionRow::builder().title("Models").build();
    let list = gtk::Button::builder()
        .label("List")
        .valign(gtk::Align::Center)
        .build();
    models.add_suffix(&list);
    group.add(&status);
    group.add(&route);
    group.add(&model);
    group.add(&models);

    let clamp = adw::Clamp::builder()
        .maximum_size(720)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .child(&group)
        .build();
    let page = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&clamp)
        .build();

    let ui = Rc::new(Ui {
        state: state.clone(),
        account,
        status,
        sign_in: sign_in.clone(),
        sign_out: sign_out.clone(),
        route: route.clone(),
        model: model.clone(),
        models: models.clone(),
        notify: Box::new(notify),
    });
    show(&ui, &ui.account.status());

    sign_in.connect_clicked({
        let ui = ui.clone();
        move |button| ask_then_sign_in(&ui, button)
    });
    sign_out.connect_clicked({
        let ui = ui.clone();
        move |_| match ui.account.sign_out() {
            Ok(status) => {
                ui.state.settings.borrow_mut().agy = None;
                show(&ui, &status);
            }
            Err(error) => (ui.notify)(&error.to_string()),
        }
    });
    route.connect_active_notify({
        let ui = ui.clone();
        move |_| apply_route(&ui)
    });
    model.connect_changed({
        let ui = ui.clone();
        move |_| {
            if ui.route.is_active() {
                apply_route(&ui);
            }
        }
    });
    list.connect_clicked({
        let ui = ui.clone();
        move |_| list_models(&ui)
    });
    page.upcast()
}

fn show(ui: &Ui, status: &AgyStatus) {
    ui.status.set_subtitle(&status_text(status));
    ui.sign_in.set_visible(!status.signed_in);
    ui.sign_out.set_visible(status.signed_in);
    ui.route.set_sensitive(status.signed_in);
    ui.model.set_sensitive(status.signed_in);
    if !status.signed_in && ui.route.is_active() {
        ui.route.set_active(false);
    }
}

/// Shows the warning and signs in only when it is accepted. Declining changes nothing.
fn ask_then_sign_in(ui: &Rc<Ui>, button: &gtk::Button) {
    let dialog = adw::AlertDialog::new(Some("Before you sign in"), Some(&agy_terms_warning()));
    dialog.add_responses(&[("cancel", "Cancel"), ("accept", "I accept the risk")]);
    dialog.set_response_appearance("accept", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");
    let ui = ui.clone();
    let parent = button.clone();
    glib::spawn_future_local(async move {
        if dialog.choose_future(&parent).await != "accept" {
            return;
        }
        ui.sign_in.set_sensitive(false);
        ui.status.set_subtitle("Checking the Antigravity CLI...");
        let account = Arc::clone(&ui.account);
        let task = runtime().spawn(async move { account.sign_in(true).await });
        let result = task.await;
        ui.sign_in.set_sensitive(true);
        match result {
            Ok(Ok(status)) => show(&ui, &status),
            Ok(Err(error)) => {
                (ui.notify)(&error.to_string());
                show(&ui, &ui.account.status());
            }
            Err(_) => {
                (ui.notify)("The sign-in was interrupted.");
                show(&ui, &ui.account.status());
            }
        }
    });
}

/// Turns the chat route on or off in the settings the chat reads.
fn apply_route(ui: &Ui) {
    if !ui.route.is_active() {
        ui.state.settings.borrow_mut().agy = None;
        return;
    }
    let text = ui.model.text();
    let model = Some(text.trim().to_owned()).filter(|m| !m.is_empty());
    match ui.account.config(model) {
        Ok(config) => ui.state.settings.borrow_mut().agy = Some(config),
        Err(error) => {
            (ui.notify)(&error.to_string());
            ui.route.set_active(false);
        }
    }
}

fn list_models(ui: &Rc<Ui>) {
    let account = Arc::clone(&ui.account);
    ui.models.set_subtitle("Asking the CLI...");
    let ui = ui.clone();
    let task = runtime().spawn(async move { account.models().await });
    glib::spawn_future_local(async move {
        match task.await {
            Ok(Ok(names)) if names.is_empty() => ui.models.set_subtitle("The CLI listed none."),
            Ok(Ok(names)) => ui
                .models
                .set_subtitle(&glib::markup_escape_text(&names.join(", "))),
            Ok(Err(error)) => {
                ui.models.set_subtitle("");
                (ui.notify)(&error.to_string());
            }
            Err(_) => ui.models.set_subtitle(""),
        }
    });
}
