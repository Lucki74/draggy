//! The settings dialog. Server, model and folder are held in memory; the key goes to the keyring on request.

use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gio, glib};

use crate::state::{AppState, BRAVE_KEY, SERVER_KEY};
use draggy_linux::research::{self, DEPTHS, KEEPS, t};
use draggy_linux::runtime::runtime;
use draggy_linux::settings::PROVIDERS;

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
        #[template_child]
        pub web: TemplateChild<adw::SwitchRow>,
        #[template_child]
        pub provider: TemplateChild<adw::ComboRow>,
        #[template_child]
        pub searxng: TemplateChild<adw::EntryRow>,
        #[template_child]
        pub brave_key: TemplateChild<adw::PasswordEntryRow>,
        #[template_child]
        pub research_group: TemplateChild<adw::PreferencesGroup>,
        #[template_child]
        pub research_runs: TemplateChild<adw::PreferencesGroup>,
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
            imp.web.set_active(settings.web);
            imp.searxng.set_text(&settings.searxng_url);
            let chosen = PROVIDERS
                .iter()
                .position(|id| *id == settings.search_provider)
                .unwrap_or(0);
            imp.provider.set_selected(chosen as u32);
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

        let keep = Rc::clone(state);
        imp.web.connect_active_notify(move |row| {
            keep.settings.borrow_mut().web = row.is_active();
        });
        let keep = Rc::clone(state);
        imp.searxng.connect_changed(move |row| {
            keep.settings.borrow_mut().searxng_url = row.text().to_string();
        });
        let keep = Rc::clone(state);
        imp.provider.connect_selected_notify(move |row| {
            let id = PROVIDERS
                .get(row.selected() as usize)
                .copied()
                .unwrap_or("");
            keep.settings.borrow_mut().search_provider = id.to_owned();
        });
        // The key is stored when the apply button is pressed, and the field is then cleared.
        let secrets = Arc::clone(&state.secrets);
        let notify = toast.clone();
        imp.brave_key.connect_apply(move |row| {
            let value = row.text().to_string();
            let secrets = Arc::clone(&secrets);
            let notify = notify.clone();
            let row = row.clone();
            glib::spawn_future_local(async move {
                let outcome = runtime()
                    .spawn(async move {
                        if value.is_empty() {
                            secrets.clear(BRAVE_KEY).await
                        } else {
                            secrets.set(BRAVE_KEY, &value).await
                        }
                    })
                    .await;
                match outcome {
                    Ok(Ok(())) => {
                        row.set_text("");
                        notify("The search key was updated in your keyring.");
                    }
                    Ok(Err(error)) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request failed");
                        notify(&error.to_string())
                    }
                    Err(error) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request task interrupted");
                        notify("The keyring request was interrupted.")
                    }
                }
            });
        });

        dialog.build_research(state);

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
                    Ok(Err(error)) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request failed");
                        notify(&error.to_string())
                    }
                    Err(error) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request task interrupted");
                        notify("The keyring request was interrupted.")
                    }
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
                    Ok(Err(error)) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request failed");
                        notify(&error.to_string())
                    }
                    Err(error) => {
                        tracing::error!(target: "linux.settings", error = %error, "keyring request task interrupted");
                        notify("The keyring request was interrupted.")
                    }
                }
            });
        });
        dialog
    }

    /// The research group, built here so its words follow the system language, and the list of past runs.
    fn build_research(&self, state: &Rc<AppState>) {
        let imp = self.imp();
        imp.research_group.set_title(&t("researchPage"));
        let current = state.research.borrow().clone();

        let start = adw::SwitchRow::builder()
            .title(t("researchModelStart"))
            .subtitle(t("researchModelStartHint"))
            .active(current.model_start)
            .build();
        let keep = Rc::clone(state);
        start.connect_active_notify(move |row| {
            keep.research.borrow_mut().model_start = row.is_active()
        });
        imp.research_group.add(&start);

        let depth_labels: Vec<String> = DEPTHS
            .iter()
            .map(|depth| t(&format!("researchDepth{}", capital(depth))))
            .collect();
        let depth = adw::ComboRow::builder()
            .title(t("researchMaxDepth"))
            .model(&gtk::StringList::new(
                &depth_labels.iter().map(String::as_str).collect::<Vec<_>>(),
            ))
            .selected(
                DEPTHS
                    .iter()
                    .position(|id| *id == current.max_depth)
                    .unwrap_or(2) as u32,
            )
            .build();
        let keep = Rc::clone(state);
        depth.connect_selected_notify(move |row| {
            let id = DEPTHS
                .get(row.selected() as usize)
                .copied()
                .unwrap_or("deep");
            keep.research.borrow_mut().max_depth = id.to_owned();
        });
        imp.research_group.add(&depth);

        let keep_labels = [t("keepForever"), t("keep90"), t("keep30")];
        let retention = adw::ComboRow::builder()
            .title(t("researchKeep"))
            .model(&gtk::StringList::new(
                &keep_labels.iter().map(String::as_str).collect::<Vec<_>>(),
            ))
            .selected(KEEPS.iter().position(|id| *id == current.keep).unwrap_or(0) as u32)
            .build();
        let kept = Rc::clone(state);
        retention.connect_selected_notify(move |row| {
            let id = KEEPS
                .get(row.selected() as usize)
                .copied()
                .unwrap_or("forever");
            kept.research.borrow_mut().keep = id.to_owned();
            if let Some(storage) = kept.storage() {
                if let Err(error) =
                    storage.apply_research_retention(draggy_storage::retention_days(id), now_ms())
                {
                    tracing::error!(target: "linux.settings", error = ?error, "research retention could not be applied");
                }
            }
        });
        imp.research_group.add(&retention);

        let runs = state
            .storage()
            .and_then(|storage| match storage.list_research_runs(None, 50) {
                Ok(runs) => Some(runs),
                Err(error) => {
                    tracing::warn!(target: "linux.settings", error = ?error, "research runs could not be listed");
                    None
                }
            })
            .unwrap_or_default();
        if runs.is_empty() {
            imp.research_runs
                .add(&adw::ActionRow::builder().title(t("researchEmpty")).build());
        }
        for run in runs {
            let row = adw::ActionRow::builder()
                .title(glib::markup_escape_text(&run.question))
                .subtitle(research::past_run_line(
                    &run.depth,
                    run.source_count,
                    run.started_at,
                ))
                .build();
            imp.research_runs.add(&row);
        }
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// `quick` as `Quick`, to build a text key.
fn capital(word: &str) -> String {
    let mut chars = word.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_linux::settings::Settings;

    #[test]
    fn the_dialog_builds_shows_the_state_and_writes_edits_back() {
        // Needs a display (run under xvfb-run); with none there is nothing to check.
        crate::gtk_test::run(dialog_body);
    }

    fn dialog_body() {
        let state = Rc::new(AppState::new());
        *state.settings.borrow_mut() = Settings {
            server_url: "http://127.0.0.1:8080".into(),
            model: "qwen".into(),
            folder: "/tmp/project".into(),
            allow_commands: true,
            ..Settings::default()
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
