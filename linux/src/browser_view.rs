//! The Browser page: a WebKit view with an address bar and back, forward and reload.

use std::rc::Rc;

use adw::prelude::*;
use draggy_linux::browser::{normalize, permits};
use webkit6::prelude::*;
use webkit6::{PolicyDecisionType, WebView};

/// Loads the shared ad and tracker rules into the view. Pages load without them until the rules are compiled.
fn block_ads(view: &WebView) {
    let Some(manager) = view.user_content_manager() else { return };
    let store = webkit6::UserContentFilterStore::new(&gtk::glib::user_cache_dir().join("draggy/adblock").to_string_lossy());
    gtk::glib::spawn_future_local(async move {
        let rules = gtk::glib::Bytes::from_owned(draggy_core::adblock::adblock_rules().into_bytes());
        if let Ok(filter) = store.save_future("draggy-adblock", &rules).await {
            manager.add_filter(&filter);
        }
    });
}

pub fn build(notify: impl Fn(&str) + 'static) -> gtk::Widget {
    let view = WebView::new();
    view.set_vexpand(true);
    block_ads(&view);
    let back = gtk::Button::from_icon_name("go-previous-symbolic");
    let forward = gtk::Button::from_icon_name("go-next-symbolic");
    let reload = gtk::Button::from_icon_name("view-refresh-symbolic");
    back.set_tooltip_text(Some("Back"));
    forward.set_tooltip_text(Some("Forward"));
    reload.set_tooltip_text(Some("Reload"));
    let address = gtk::Entry::builder()
        .hexpand(true)
        .placeholder_text("Type an address")
        .input_purpose(gtk::InputPurpose::Url)
        .build();
    let bar = gtk::Box::builder()
        .spacing(6)
        .margin_top(6)
        .margin_bottom(6)
        .margin_start(6)
        .margin_end(6)
        .build();
    bar.append(&back);
    bar.append(&forward);
    bar.append(&reload);
    bar.append(&address);
    let page = gtk::Box::new(gtk::Orientation::Vertical, 0);
    page.append(&bar);
    page.append(&view);

    let notify = Rc::new(notify);
    back.connect_clicked({
        let view = view.clone();
        move |_| view.go_back()
    });
    forward.connect_clicked({
        let view = view.clone();
        move |_| view.go_forward()
    });
    reload.connect_clicked({
        let view = view.clone();
        move |_| view.reload()
    });
    address.connect_activate({
        let view = view.clone();
        let notify = notify.clone();
        move |entry| {
            let target = normalize(entry.text().as_str());
            if target.is_empty() {
                return;
            }
            if permits(&target) {
                view.load_uri(&target);
            } else {
                notify("Only http and https addresses open here.");
            }
        }
    });
    // Links and redirects obey the same rule as the address bar.
    view.connect_decide_policy({
        let notify = notify.clone();
        move |_, decision, kind| {
            if !matches!(
                kind,
                PolicyDecisionType::NavigationAction | PolicyDecisionType::NewWindowAction
            ) {
                return false;
            }
            let Some(action) = decision
                .clone()
                .downcast::<webkit6::NavigationPolicyDecision>()
                .ok()
                .and_then(|d| d.navigation_action())
                .and_then(|a| a.request())
                .and_then(|r| r.uri())
            else {
                return false;
            };
            if permits(action.as_str()) {
                false
            } else {
                decision.ignore();
                notify("Only http and https addresses open here.");
                true
            }
        }
    });
    view.connect_uri_notify({
        let address = address.clone();
        move |view| {
            if let Some(uri) = view.uri() {
                address.set_text(uri.as_str());
            }
        }
    });
    view.connect_load_changed({
        let (back, forward) = (back.clone(), forward.clone());
        move |view, _| {
            back.set_sensitive(view.can_go_back());
            forward.set_sensitive(view.can_go_forward());
        }
    });
    back.set_sensitive(false);
    forward.set_sensitive(false);
    page.upcast()
}
