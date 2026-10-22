//! The main window: a split view with the sections on the left and the section's page on the right.

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gio, glib};
use std::rc::Rc;

use crate::chat_view::DraggyChat;
use crate::settings_dialog::DraggySettings;
use crate::state::AppState;
use draggy_linux::conversations::{Store, Summary};

mod imp {
    use super::*;

    #[derive(Default, gtk::CompositeTemplate)]
    #[template(resource = "/com/draggy/Draggy/window.ui")]
    pub struct DraggyWindow {
        pub state: Rc<AppState>,
        #[template_child]
        pub toasts: TemplateChild<adw::ToastOverlay>,
        #[template_child]
        pub split: TemplateChild<adw::NavigationSplitView>,
        #[template_child]
        pub sections: TemplateChild<gtk::ListBox>,
        #[template_child]
        pub history: TemplateChild<gtk::ListBox>,
        #[template_child]
        pub pages: TemplateChild<gtk::Stack>,
        #[template_child]
        pub chat: TemplateChild<DraggyChat>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for DraggyWindow {
        const NAME: &'static str = "DraggyWindow";
        type Type = super::DraggyWindow;
        type ParentType = adw::ApplicationWindow;

        fn class_init(class: &mut Self::Class) {
            DraggyChat::ensure_type();
            class.bind_template();
        }

        fn instance_init(object: &glib::subclass::InitializingObject<Self>) {
            object.init_template();
        }
    }

    impl ObjectImpl for DraggyWindow {
        fn constructed(&self) {
            self.parent_constructed();
            let pages = self.pages.clone();
            let split = self.split.clone();
            self.sections.connect_row_selected(move |_, row| {
                if let Some(row) = row {
                    pages.set_visible_child_name(&row.widget_name());
                    split.set_show_content(true);
                }
            });
            if let Some(first) = self.sections.row_at_index(0) {
                self.sections.select_row(Some(&first));
            }
        }
    }

    impl WidgetImpl for DraggyWindow {}
    impl WindowImpl for DraggyWindow {}
    impl ApplicationWindowImpl for DraggyWindow {}
    impl AdwApplicationWindowImpl for DraggyWindow {}
}

glib::wrapper! {
    pub struct DraggyWindow(ObjectSubclass<imp::DraggyWindow>)
        @extends adw::ApplicationWindow, gtk::ApplicationWindow, gtk::Window, gtk::Widget,
        @implements gio::ActionGroup, gio::ActionMap, gtk::Accessible, gtk::Buildable,
            gtk::ConstraintTarget, gtk::Native, gtk::Root, gtk::ShortcutManager;
}

impl DraggyWindow {
    pub fn new(app: &adw::Application) -> Self {
        let window: Self = glib::Object::builder().property("application", app).build();
        window.install_actions();
        window.attach_chat();
        window.attach_servers();
        window.attach_models();
        window.stop_servers_on_close();
        window.install_history();
        window.refresh_history();
        window
    }

    fn attach_chat(&self) {
        let weak = self.downgrade();
        self.imp().chat.attach(
            &self.imp().state,
            {
                let weak = weak.clone();
                move |text| {
                    if let Some(window) = weak.upgrade() {
                        window.toast(text);
                    }
                }
            },
            move || {
                // Deferred: the change can come from a row's own handler, which must not lose its row meanwhile.
                let weak = weak.clone();
                glib::idle_add_local_once(move || {
                    if let Some(window) = weak.upgrade() {
                        window.refresh_history();
                    }
                });
            },
        );
    }

    fn attach_servers(&self) {
        let weak = self.downgrade();
        let page = crate::servers_view::build(&self.imp().state, move |text| {
            if let Some(window) = weak.upgrade() {
                window.toast(text);
            }
        });
        self.imp().pages.add_named(&page, Some("servers"));
    }

    fn attach_models(&self) {
        let weak = self.downgrade();
        let page = crate::models_view::build(&self.imp().state, move |text| {
            if let Some(window) = weak.upgrade() {
                window.toast(text);
            }
        });
        self.imp().pages.add_named(&page, Some("models"));
    }

    /// Stops the MCP servers and the local engine when the window closes, so no child process outlives the app.
    fn stop_servers_on_close(&self) {
        self.connect_close_request(|window| {
            if let Some(mcp) = window.imp().state.mcp() {
                draggy_linux::runtime::runtime().block_on(mcp.stop_all());
            }
            if let Some(engine) = window.imp().state.engine_if_started() {
                draggy_linux::runtime::runtime().block_on(engine.stop());
            }
            glib::Propagation::Proceed
        });
    }

    fn install_actions(&self) {
        let settings = gio::SimpleAction::new("settings", None);
        let weak = self.downgrade();
        settings.connect_activate(move |_, _| {
            let Some(window) = weak.upgrade() else { return };
            let notify = {
                let weak = window.downgrade();
                move |text: &str| {
                    if let Some(window) = weak.upgrade() {
                        window.toast(text);
                    }
                }
            };
            DraggySettings::new(&window.imp().state, notify).present(Some(&window));
        });
        self.add_action(&settings);

        let new_conversation = gio::SimpleAction::new("new-conversation", None);
        let weak = self.downgrade();
        new_conversation.connect_activate(move |_, _| {
            if let Some(window) = weak.upgrade() {
                window.imp().chat.new_conversation();
            }
        });
        self.add_action(&new_conversation);
    }

    /// Makes a click on a history row open that conversation in the chat page, and sets the empty-list text.
    fn install_history(&self) {
        let imp = self.imp();
        let empty = gtk::Label::builder()
            .label("No saved conversations yet.")
            .wrap(true)
            .xalign(0.0)
            .margin_start(12)
            .margin_end(12)
            .css_classes(["caption", "dim-label"])
            .build();
        imp.history.set_placeholder(Some(&empty));
        let weak = self.downgrade();
        imp.history.connect_row_activated(move |_, row| {
            let Some(window) = weak.upgrade() else {
                return;
            };
            if let Some(chat_row) = window.imp().sections.row_at_index(0) {
                window.imp().sections.select_row(Some(&chat_row));
            }
            window.imp().chat.open_conversation(&row.widget_name());
        });
    }

    /// Rebuilds the history list from the saved conversations, newest first, and marks the one on screen.
    pub fn refresh_history(&self) {
        let imp = self.imp();
        while let Some(child) = imp.history.first_child() {
            imp.history.remove(&child);
        }
        let summaries = Store::in_data_dir()
            .and_then(|store| store.list().ok())
            .unwrap_or_default();
        let current = imp.chat.current_id();
        for summary in &summaries {
            let row = self.history_row(summary);
            imp.history.append(&row);
            if current.as_deref() == Some(summary.id.as_str()) {
                imp.history.select_row(Some(&row));
            }
        }
    }

    fn history_row(&self, summary: &Summary) -> gtk::ListBoxRow {
        let row = gtk::ListBoxRow::new();
        row.set_widget_name(&summary.id);
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        let title = gtk::Label::builder()
            .label(summary.title.as_str())
            .tooltip_text(summary.title.as_str())
            .xalign(0.0)
            .hexpand(true)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .build();
        let delete = gtk::Button::builder()
            .icon_name("user-trash-symbolic")
            .tooltip_text("Delete conversation")
            .valign(gtk::Align::Center)
            .css_classes(["flat"])
            .build();
        let weak = self.downgrade();
        let id = summary.id.clone();
        delete.connect_clicked(move |_| {
            if let Some(window) = weak.upgrade() {
                window.ask_delete(id.clone());
            }
        });
        line.append(&title);
        line.append(&delete);
        row.set_child(Some(&line));
        row
    }

    fn ask_delete(&self, id: String) {
        let dialog = adw::AlertDialog::new(
            Some("Delete this conversation?"),
            Some("It is removed from this computer. This cannot be undone."),
        );
        dialog.add_responses(&[("cancel", "Cancel"), ("delete", "Delete")]);
        dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
        dialog.set_default_response(Some("cancel"));
        dialog.set_close_response("cancel");
        let weak = self.downgrade();
        dialog.choose(Some(self), gio::Cancellable::NONE, move |response| {
            if response.as_str() != "delete" {
                return;
            }
            if let Some(window) = weak.upgrade() {
                window.imp().chat.delete_conversation(&id);
            }
        });
    }

    /// Shows a short message at the bottom of the window.
    pub fn toast(&self, text: &str) {
        self.imp().toasts.add_toast(adw::Toast::new(text));
    }
}
