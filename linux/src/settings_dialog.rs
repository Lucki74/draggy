//! The settings dialog. Server, model and folder are held in memory; the key goes to the keyring on request.

use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gio, glib};

use crate::state::{AppState, SERVER_KEY};
use draggy_linux::runtime::runtime;

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/com/draggy/Draggy/settings.ui")]
    pub struct DraggySettings {
        #[template_child]
        pub server: TemplateChild<adw::EntryRow>,
        #[template_child]
        pub model: TemplateChild<adw::EntryRow>,
        #[template_child]
        pub key: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub save_key: TemplateChild<gtk::Button>,
        #[template_child]
        pub remove_key: TemplateChild<gtk::Button>,
        #[template_child]
        pub folder_row: TemplateChild<adw::ActionRow>,
        #[template_child]
        pub choose_folder: TemplateChild<gtk::Button>,
        #[template_child]
        pub commands: TemplateChild<adw::SwitchRow>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for DraggySettings {
        const NAME: &'static str = "DraggySettings";
        type Type = super::DraggySettings;
        type ParentType = adw::PreferencesDialog;

        fn class_init(class: &mut Self::Class) {
            class.bind_template();
        }

        fn instance_init(object: &glib::subclass::InitializingObject<Self>) {
            object.init_template();
        }
    }

    impl ObjectImpl for DraggySettings {}
    impl WidgetImpl for DraggySettings {}
    impl AdwDialogImpl for DraggySettings {}
    impl PreferencesDialogImpl for DraggySettings {}
}

glib::wrapper! {
    pub struct DraggySettings(ObjectSubclass<imp::DraggySettings>)
        @extends adw::PreferencesDialog, adw::Dialog, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::ShortcutManager;
}

impl DraggySettings {
    /// A dialog showing the current values. Edits go back to `state` as they are made.
    pub fn new(state: &Rc<AppState>, toast: impl Fn(&str) + Clone + 'static) -> Self {
        let dialog: Self = glib::Object::new();
        let imp = dialog.imp();
        {
            let settings = state.settings.borrow();
            imp.server.set_text(&settings.server_url);
            imp.model.set_text(&settings.model);
            imp.commands.set_active(settings.allow_commands);
            dialog.show_folder(&settings.folder);
        }

        let keep = Rc::clone(state);
        imp.server.connect_changed(move |row| {
            keep.settings.borrow_mut().server_url = row.text().to_string();
        });
        let keep = Rc::clone(state);
        imp.model.connect_changed(move |row| {
            keep.settings.borrow_mut().model = row.text().to_string();
        });
        let keep = Rc::clone(state);
        imp.commands.connect_active_notify(move |row| {
            keep.settings.borrow_mut().allow_commands = row.is_active();
        });

        let state_for_folder = Rc::clone(state);
        let weak = dialog.downgrade();
        imp.choose_folder.connect_clicked(move |_| {
            let Some(dialog) = weak.upgrade() else { return };
            let chooser = gtk::FileDialog::builder()
                .title("Choose the project folder")
                .modal(true)
                .build();
            let state = Rc::clone(&state_for_folder);
            let weak = dialog.downgrade();
            let parent = dialog.root().and_downcast::<gtk::Window>();
            chooser.select_folder(parent.as_ref(), gio::Cancellable::NONE, move |result| {
                let Ok(file) = result else { return };
                let Some(path) = file.path() else { return };
                let text = path.to_string_lossy().into_owned();
                state.settings.borrow_mut().folder = text.clone();
                if let Some(dialog) = weak.upgrade() {
                    dialog.show_folder(&text);
                }
            });
        });

        let secrets = Arc::clone(&state.secrets);
        let weak = dialog.downgrade();
        let notify = toast.clone();
        imp.save_key.connect_clicked(move |_| {
            let Some(dialog) = weak.upgrade() else { return };
            let value = dialog.imp().key.text().to_string();
            if value.is_empty() {
                notify("Type the key first.");
                return;
            }
            let secrets = Arc::clone(&secrets);
            let notify = notify.clone();
            let weak = dialog.downgrade();
            glib::spawn_future_local(async move {
                let outcome = runtime()
                    .spawn(async move { secrets.set(SERVER_KEY, &value).await })
                    .await;
                match outcome {
                    Ok(Ok(())) => {
                        if let Some(dialog) = weak.upgrade() {
                            // The field is cleared so the key is not left on screen or in the widget.
                            dialog.imp().key.set_text("");
                        }
                        notify("The key is stored in your keyring.");
                    }
                    Ok(Err(error)) => notify(&error.to_string()),
                    Err(_) => notify("The keyring request was interrupted."),
                }
            });
        });

        let secrets = Arc::clone(&state.secrets);
        let notify = toast;
        imp.remove_key.connect_clicked(move |_| {
            let secrets = Arc::clone(&secrets);
            let notify = notify.clone();
            glib::spawn_future_local(async move {
                let outcome = runtime()
                    .spawn(async move { secrets.clear(SERVER_KEY).await })
                    .await;
                match outcome {
                    Ok(Ok(())) => notify("The stored key was removed."),
                    Ok(Err(error)) => notify(&error.to_string()),
                    Err(_) => notify("The keyring request was interrupted."),
                }
            });
        });
        dialog
    }

    fn show_folder(&self, folder: &str) {
        let row = &self.imp().folder_row;
        if folder.is_empty() {
            row.set_subtitle("None chosen");
        } else {
            row.set_subtitle(folder);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_linux::settings::Settings;

    #[test]
    fn the_dialog_builds_shows_the_state_and_writes_edits_back() {
        // Needs a display (run under xvfb-run); with none there is nothing to check.
        if adw::init().is_err() {
            return;
        }
        gio::resources_register_include!("draggy.gresource").expect("resources");
        let state = Rc::new(AppState::new());
        *state.settings.borrow_mut() = Settings {
            server_url: "http://127.0.0.1:8080".into(),
            model: "qwen".into(),
            folder: "/tmp/project".into(),
            allow_commands: true,
        };
        let dialog = DraggySettings::new(&state, |_| {});
        let imp = dialog.imp();
        assert_eq!(imp.server.text(), "http://127.0.0.1:8080");
        assert_eq!(imp.folder_row.subtitle().as_deref(), Some("/tmp/project"));
        assert!(imp.commands.is_active());
        imp.model.set_text("llama");
        imp.commands.set_active(false);
        assert_eq!(state.settings.borrow().model, "llama");
        assert!(!state.settings.borrow().allow_commands);
    }
}
