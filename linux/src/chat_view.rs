//! The chat page: the transcript, the composer, and the turn that runs between them.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gdk, glib};

use crate::state::{AppState, SERVER_KEY};
use draggy_core::{ApprovalChoice, ApprovalRecord, CancelToken, Session};
use draggy_linux::chat::{
    metrics_line, start_turn, step_label, ChatMessage, Entry, Role, Transcript,
};
use draggy_linux::runtime::runtime;
use draggy_linux::settings::Settings;

/// The labels of the reply being written, kept so each batch of events updates them in place.
#[derive(Clone)]
struct ReplyParts {
    text: gtk::Label,
    steps: gtk::Label,
    meta: gtk::Label,
}

/// The conversation's session with the settings it was built from. A change in the settings starts a new one.
struct Live {
    settings: Settings,
    session: Arc<Session>,
}

mod imp {
    use super::*;

    #[derive(Default, gtk::CompositeTemplate)]
    #[template(resource = "/com/draggy/Draggy/chat.ui")]
    pub struct DraggyChat {
        #[template_child]
        pub scroller: TemplateChild<gtk::ScrolledWindow>,
        #[template_child]
        pub transcript: TemplateChild<gtk::Box>,
        #[template_child]
        pub input: TemplateChild<gtk::TextView>,
        #[template_child]
        pub send: TemplateChild<gtk::Button>,
        #[template_child]
        pub stop: TemplateChild<gtk::Button>,
        pub state: RefCell<Option<Rc<AppState>>>,
        pub toast: RefCell<Option<Rc<dyn Fn(&str)>>>,
        pub log: RefCell<Transcript>,
        pub reply: RefCell<Option<ReplyParts>>,
        pub live: RefCell<Option<Live>>,
        pub cancel: RefCell<Option<Arc<CancelToken>>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for DraggyChat {
        const NAME: &'static str = "DraggyChat";
        type Type = super::DraggyChat;
        type ParentType = gtk::Box;

        fn class_init(class: &mut Self::Class) {
            class.bind_template();
        }

        fn instance_init(object: &glib::subclass::InitializingObject<Self>) {
            object.init_template();
        }
    }

    impl ObjectImpl for DraggyChat {
        fn constructed(&self) {
            self.parent_constructed();
            let chat = self.obj();

            let weak = chat.downgrade();
            self.send.connect_clicked(move |_| {
                if let Some(chat) = weak.upgrade() {
                    chat.submit();
                }
            });

            let weak = chat.downgrade();
            self.stop.connect_clicked(move |_| {
                if let Some(chat) = weak.upgrade() {
                    chat.stop_turn();
                }
            });

            // Enter sends; Shift+Enter adds a line.
            let keys = gtk::EventControllerKey::new();
            let weak = chat.downgrade();
            keys.connect_key_pressed(move |_, key, _, modifiers| {
                let enter = matches!(key, gdk::Key::Return | gdk::Key::KP_Enter);
                if enter && !modifiers.contains(gdk::ModifierType::SHIFT_MASK) {
                    if let Some(chat) = weak.upgrade() {
                        chat.submit();
                    }
                    return glib::Propagation::Stop;
                }
                glib::Propagation::Proceed
            });
            self.input.add_controller(keys);
        }
    }

    impl WidgetImpl for DraggyChat {}
    impl BoxImpl for DraggyChat {}
}

glib::wrapper! {
    pub struct DraggyChat(ObjectSubclass<imp::DraggyChat>)
        @extends gtk::Box, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::Orientable;
}

impl DraggyChat {
    /// Gives the page the state it reads the settings and the key from, and a way to show short messages.
    pub fn attach(&self, state: &Rc<AppState>, toast: impl Fn(&str) + 'static) {
        let imp = self.imp();
        *imp.state.borrow_mut() = Some(Rc::clone(state));
        *imp.toast.borrow_mut() = Some(Rc::new(toast));
    }

    fn toast(&self, text: &str) {
        if let Some(toast) = self.imp().toast.borrow().as_ref() {
            toast(text);
        }
    }

    fn set_busy(&self, busy: bool) {
        let imp = self.imp();
        imp.send.set_visible(!busy);
        imp.stop.set_visible(busy);
        imp.input.set_editable(!busy);
    }

    fn stop_turn(&self) {
        if let Some(cancel) = self.imp().cancel.borrow().as_ref() {
            cancel.cancel();
        }
    }

    /// Takes the typed message and starts a turn, or says what is missing.
    fn submit(&self) {
        let imp = self.imp();
        if imp.log.borrow().is_busy() {
            return;
        }
        let buffer = imp.input.buffer();
        let text = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), false)
            .trim()
            .to_owned();
        if text.is_empty() {
            return;
        }
        let Some(state) = imp.state.borrow().clone() else {
            return;
        };
        let settings = state.settings.borrow().clone();
        let chat = self.clone();
        glib::spawn_future_local(async move {
            let Some(session) = chat.session_for(&state, &settings).await else {
                return;
            };
            chat.imp().input.buffer().set_text("");
            chat.run_turn(session, text);
        });
    }

    /// The session for these settings: the one in use, or a new one with the stored key. A new session means a new
    /// conversation, so the transcript is cleared.
    async fn session_for(&self, state: &Rc<AppState>, settings: &Settings) -> Option<Arc<Session>> {
        let imp = self.imp();
        if let Some(live) = imp.live.borrow().as_ref() {
            if &live.settings == settings {
                return Some(Arc::clone(&live.session));
            }
        }
        let secrets = Arc::clone(&state.secrets);
        // Without a keyring the server is tried with no key; a server that needs one answers with an error.
        let key = runtime()
            .spawn(async move { secrets.get(SERVER_KEY).await })
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
        let config = match settings.session_config(key) {
            Ok(config) => config,
            Err(error) => {
                self.toast(&error.to_string());
                return None;
            }
        };
        let session = match Session::new(config) {
            Ok(session) => session,
            Err(error) => {
                self.toast(&error.to_string());
                return None;
            }
        };
        if imp.live.borrow().is_some() {
            self.toast("The settings changed, so this is a new conversation.");
        }
        self.clear_transcript();
        *imp.live.borrow_mut() = Some(Live {
            settings: settings.clone(),
            session: Arc::clone(&session),
        });
        Some(session)
    }

    fn clear_transcript(&self) {
        let imp = self.imp();
        *imp.log.borrow_mut() = Transcript::default();
        *imp.reply.borrow_mut() = None;
        while let Some(child) = imp.transcript.first_child() {
            imp.transcript.remove(&child);
        }
    }

    fn run_turn(&self, session: Arc<Session>, text: String) {
        let imp = self.imp();
        imp.log.borrow_mut().begin_turn(&text);
        {
            let log = imp.log.borrow();
            let entries = log.entries();
            let [.., user, reply] = entries else { return };
            imp.transcript.append(&entry_row(user).0);
            let (row, parts) = entry_row(reply);
            imp.transcript.append(&row);
            *imp.reply.borrow_mut() = Some(parts);
        }
        self.set_busy(true);
        self.scroll_to_end();

        let (tx, rx) = async_channel::unbounded();
        *imp.cancel.borrow_mut() = Some(start_turn(session, text, tx));
        let chat = self.clone();
        glib::spawn_future_local(async move {
            while let Ok(message) = rx.recv().await {
                match message {
                    ChatMessage::Events(events) => {
                        chat.imp().log.borrow_mut().apply(&events);
                        chat.refresh_reply();
                    }
                    ChatMessage::Approval { request, reply } => {
                        chat.ask_approval(request, reply);
                    }
                    ChatMessage::Finished(result) => {
                        chat.imp().log.borrow_mut().finish(result);
                        chat.refresh_reply();
                        *chat.imp().cancel.borrow_mut() = None;
                        chat.set_busy(false);
                        chat.imp().input.grab_focus();
                        break;
                    }
                }
            }
        });
    }

    fn refresh_reply(&self) {
        let imp = self.imp();
        let log = imp.log.borrow();
        if let (Some(entry), Some(parts)) = (log.entries().last(), imp.reply.borrow().as_ref()) {
            fill(parts, entry);
        }
        drop(log);
        self.scroll_to_end();
    }

    fn scroll_to_end(&self) {
        let adjustment = self.imp().scroller.vadjustment();
        // The new height is known after the next layout.
        glib::idle_add_local_once(move || adjustment.set_value(adjustment.upper()));
    }

    fn ask_approval(
        &self,
        request: ApprovalRecord,
        reply: std::sync::mpsc::Sender<ApprovalChoice>,
    ) {
        let body = match &request.target {
            Some(target) => format!("{}\n\n{}", request.reason, target),
            None => request.reason.clone(),
        };
        let dialog = adw::AlertDialog::new(Some(&format!("Allow {}?", request.tool)), Some(&body));
        dialog.add_responses(&[
            ("no", "Deny"),
            ("once", "Allow once"),
            ("task", "Allow for this reply"),
            ("workspace", "Allow for this session"),
        ]);
        dialog.set_default_response(Some("no"));
        dialog.set_close_response("no");
        dialog.choose(self, gtk::gio::Cancellable::NONE, move |response| {
            let choice = match response.as_str() {
                "once" => ApprovalChoice::Once,
                "task" => ApprovalChoice::Task,
                "workspace" => ApprovalChoice::Workspace,
                _ => ApprovalChoice::No,
            };
            // The turn's thread has stopped waiting if the turn was stopped; nothing more to do then.
            drop(reply.send(choice));
        });
    }
}

/// A row for one message, and the labels a reply keeps updating.
fn entry_row(entry: &Entry) -> (gtk::Box, ReplyParts) {
    let row = gtk::Box::new(gtk::Orientation::Vertical, 4);
    let text = gtk::Label::builder()
        .wrap(true)
        .wrap_mode(gtk::pango::WrapMode::WordChar)
        .xalign(0.0)
        .selectable(true)
        .css_classes(["message-text"])
        .build();
    let steps = gtk::Label::builder()
        .wrap(true)
        .xalign(0.0)
        .selectable(true)
        .css_classes(["caption", "dim-label", "code"])
        .build();
    let meta = gtk::Label::builder()
        .wrap(true)
        .xalign(0.0)
        .css_classes(["caption", "dim-label"])
        .build();
    row.append(&text);
    row.append(&steps);
    row.append(&meta);
    match entry.role {
        Role::User => {
            row.add_css_class("message-user");
            row.set_halign(gtk::Align::End);
            text.set_xalign(1.0);
        }
        Role::Assistant => row.add_css_class("message-assistant"),
    }
    let parts = ReplyParts { text, steps, meta };
    fill(&parts, entry);
    (row, parts)
}

fn fill(parts: &ReplyParts, entry: &Entry) {
    if entry.streaming && entry.text.is_empty() {
        parts.text.set_text("…");
    } else {
        parts.text.set_text(&entry.text);
    }
    let steps: Vec<String> = entry.steps.iter().filter_map(step_label).collect();
    parts.steps.set_visible(!steps.is_empty());
    parts.steps.set_text(&steps.join("\n"));
    let mut meta = Vec::new();
    if let Some(note) = &entry.note {
        meta.push(note.clone());
    }
    if let (false, Some(metrics)) = (entry.streaming, &entry.metrics) {
        meta.push(metrics_line(metrics));
    }
    parts.meta.set_visible(!meta.is_empty());
    parts.meta.set_text(&meta.join(" · "));
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_core::TurnEventRecord;

    fn ready() -> bool {
        if adw::init().is_err() {
            return false;
        }
        gtk::gio::resources_register_include!("draggy.gresource").expect("resources");
        true
    }

    #[test]
    fn the_page_builds_and_a_streamed_reply_shows_in_the_labels() {
        // Needs a display (run under xvfb-run); with none there is nothing to check.
        if !ready() {
            return;
        }
        let chat: DraggyChat = glib::Object::new();
        let mut log = Transcript::default();
        log.begin_turn("hello");
        let (_, parts) = entry_row(&log.entries()[1]);
        assert_eq!(parts.text.text(), "…");
        log.apply(&[TurnEventRecord::Patch {
            content: String::new(),
            text_content: "Hi there".to_owned(),
            steps: Vec::new(),
        }]);
        fill(&parts, &log.entries()[1]);
        assert_eq!(parts.text.text(), "Hi there");
        assert!(!parts.steps.is_visible());
        assert!(chat.imp().send.is_visible());
        assert!(!chat.imp().stop.is_visible());
        chat.set_busy(true);
        assert!(!chat.imp().send.is_visible());
        assert!(chat.imp().stop.is_visible());
    }

    #[test]
    fn a_new_reply_row_for_the_user_is_right_aligned() {
        if !ready() {
            return;
        }
        let mut log = Transcript::default();
        log.begin_turn("hello");
        let (row, parts) = entry_row(&log.entries()[0]);
        assert_eq!(row.halign(), gtk::Align::End);
        assert_eq!(parts.text.text(), "hello");
    }
}
