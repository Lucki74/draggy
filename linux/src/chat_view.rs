//! The chat page: the transcript, the composer, and the turn that runs between them.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gdk, gio, glib};

use crate::state::{AppState, BRAVE_KEY, SERVER_KEY};
use draggy_core::{
    ApprovalChoice, ApprovalRecord, CancelToken, ImageRecord, Session, read_document,
};
use draggy_linux::chat::{
    ChatMessage, Entry, Role, Transcript, metrics_line, start_turn, step_label, to_records,
    to_saved, with_document,
};
use draggy_linux::conversations::{self, Conversation, Store};
use draggy_linux::markdown::{self, Block};
use draggy_linux::preview;
use draggy_linux::runtime::runtime;
use draggy_linux::settings::Settings;
use draggy_linux::speech;

type Toast = Rc<dyn Fn(&str)>;

/// The parts of a message kept so each batch of events updates them in place. `shown` is the text the body was drawn
/// from, so a batch that changes nothing in it skips the redraw.
#[derive(Clone)]
pub struct ReplyParts {
    body: gtk::Box,
    steps: gtk::Label,
    meta: gtk::Label,
    shown: RefCell<Option<String>>,
}

/// The conversation's session with the settings it was built from. A change in the settings starts a new one.
pub struct Live {
    settings: Settings,
    session: Arc<Session>,
    /// The id the conversation is saved under.
    id: String,
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
        pub plan: TemplateChild<gtk::Box>,
        #[template_child]
        pub plan_title: TemplateChild<gtk::Label>,
        #[template_child]
        pub plan_clear: TemplateChild<gtk::Button>,
        #[template_child]
        pub plan_steps: TemplateChild<gtk::Box>,
        #[template_child]
        pub speak: TemplateChild<gtk::ToggleButton>,
        #[template_child]
        pub input: TemplateChild<gtk::TextView>,
        #[template_child]
        pub attach: TemplateChild<gtk::Button>,
        #[template_child]
        pub send: TemplateChild<gtk::Button>,
        #[template_child]
        pub stop: TemplateChild<gtk::Button>,
        pub state: RefCell<Option<Rc<AppState>>>,
        pub toast: RefCell<Option<Toast>>,
        pub log: RefCell<Transcript>,
        pub reply: RefCell<Option<ReplyParts>>,
        pub live: RefCell<Option<Live>>,
        /// A saved conversation shown but not yet restored into a session. The next message resumes it.
        pub pending: RefCell<Option<Conversation>>,
        pub cancel: RefCell<Option<Arc<CancelToken>>>,
        /// Pictures waiting to go with the next message.
        pub images: RefCell<Vec<ImageRecord>>,
        /// Runs when the saved conversations change, so the sidebar list can refresh.
        pub changed: RefCell<Option<Rc<dyn Fn()>>>,
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

            let weak = chat.downgrade();
            self.speak.connect_toggled(move |button| {
                if !button.is_active() {
                    speech::stop();
                } else if let Some(chat) = weak.upgrade()
                    && !speech::available()
                {
                    button.set_active(false);
                    chat.toast("Install speech-dispatcher to hear replies.");
                }
            });

            let weak = chat.downgrade();
            self.plan_clear.connect_clicked(move |_| {
                if let Some(chat) = weak.upgrade() {
                    chat.clear_plan();
                }
            });

            let weak = chat.downgrade();
            self.attach.connect_clicked(move |_| {
                if let Some(chat) = weak.upgrade() {
                    chat.choose_document();
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

const MAX_PICTURE: usize = 10_000_000;

/// The image type for a picture file, or `None` for anything else.
fn picture_type(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

impl DraggyChat {
    /// Gives the page the state it reads the settings and the key from, a way to show short messages, and a callback
    /// for when the saved conversations change.
    pub fn attach(
        &self,
        state: &Rc<AppState>,
        toast: impl Fn(&str) + 'static,
        changed: impl Fn() + 'static,
    ) {
        let imp = self.imp();
        *imp.state.borrow_mut() = Some(Rc::clone(state));
        *imp.toast.borrow_mut() = Some(Rc::new(toast));
        *imp.changed.borrow_mut() = Some(Rc::new(changed));
        self.open_latest();
    }

    /// The id of the conversation on screen, whether it is saved yet or not.
    pub fn current_id(&self) -> Option<String> {
        let imp = self.imp();
        if let Some(live) = imp.live.borrow().as_ref() {
            return Some(live.id.clone());
        }
        imp.pending
            .borrow()
            .as_ref()
            .map(|conversation| conversation.id.clone())
    }

    /// Starts an empty conversation. The one before stays saved.
    pub fn new_conversation(&self) {
        if self.busy_refusal() {
            return;
        }
        self.clear_transcript();
        self.clear_current();
        self.notify_changed();
    }

    /// Opens a saved conversation. The next message continues it.
    pub fn open_conversation(&self, id: &str) {
        if self.current_id().as_deref() == Some(id) || self.busy_refusal() {
            return;
        }
        let Some(store) = Store::in_data_dir() else {
            return;
        };
        match store.load(id) {
            Ok(conversation) => self.show(conversation),
            Err(_) => self.toast("The saved conversation could not be opened."),
        }
        self.notify_changed();
    }

    /// Deletes a saved conversation. A conversation on screen is cleared with it.
    pub fn delete_conversation(&self, id: &str) {
        let on_screen = self.current_id().as_deref() == Some(id);
        if on_screen && self.busy_refusal() {
            return;
        }
        let Some(store) = Store::in_data_dir() else {
            return;
        };
        if store.delete(id).is_err() {
            self.toast("The conversation could not be deleted.");
            return;
        }
        if on_screen {
            self.clear_transcript();
            self.clear_current();
        }
        self.notify_changed();
    }

    /// True while a reply is still arriving. The user is told to wait, since switching now would lose that reply.
    fn busy_refusal(&self) -> bool {
        let busy = self.imp().log.borrow().is_busy();
        if busy {
            self.toast("Wait for the reply to finish.");
        }
        busy
    }

    /// Forgets the session and the saved conversation the page was continuing.
    fn clear_current(&self) {
        let imp = self.imp();
        *imp.live.borrow_mut() = None;
        *imp.pending.borrow_mut() = None;
        self.refresh_plan();
    }

    fn notify_changed(&self) {
        let changed = self.imp().changed.borrow().clone();
        if let Some(changed) = changed {
            changed();
        }
    }

    /// Shows the most recent saved conversation, ready to be continued. With none saved the page starts empty.
    fn open_latest(&self) {
        let Some(store) = Store::in_data_dir() else {
            return;
        };
        let latest = match store.list() {
            Ok(list) => list.into_iter().next(),
            Err(_) => {
                self.toast("The saved conversations could not be read.");
                return;
            }
        };
        let Some(summary) = latest else {
            return;
        };
        match store.load(&summary.id) {
            Ok(conversation) => self.show(conversation),
            Err(_) => self.toast("The saved conversation could not be opened."),
        }
    }

    /// Shows a saved conversation. The next message restores it into a session and continues it.
    fn show(&self, conversation: Conversation) {
        let imp = self.imp();
        self.clear_transcript();
        *imp.log.borrow_mut() = Transcript::from_saved(&conversation.messages);
        {
            let log = imp.log.borrow();
            for entry in log.entries() {
                imp.transcript.append(&entry_row(entry).0);
            }
        }
        *imp.live.borrow_mut() = None;
        *imp.pending.borrow_mut() = Some(conversation);
        self.scroll_to_end();
    }

    /// Saves the conversation the session holds. Called after every turn, so a crash loses at most the turn running.
    fn save_turn(&self) {
        let imp = self.imp();
        let (id, messages) = {
            let live = imp.live.borrow();
            let Some(live) = live.as_ref() else {
                return;
            };
            (live.id.clone(), to_saved(&live.session.messages()))
        };
        let conversation = Conversation {
            title: conversations::title_for(&messages),
            updated: conversations::now(),
            id,
            messages,
        };
        let saved = Store::in_data_dir().is_some_and(|store| store.save(&conversation).is_ok());
        if !saved {
            self.toast("The conversation could not be saved.");
        }
        self.notify_changed();
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
        imp.attach.set_sensitive(!busy);
        imp.input.set_editable(!busy);
    }

    /// Asks for a Word, PowerPoint, Excel or PDF file and reads it into the message being typed.
    fn choose_document(&self) {
        let filter = gtk::FileFilter::new();
        filter.set_name(Some("Documents and pictures"));
        for suffix in [
            "docx", "pptx", "xlsx", "pdf", "png", "jpg", "jpeg", "gif", "webp",
        ] {
            filter.add_suffix(suffix);
        }
        let filters = gio::ListStore::new::<gtk::FileFilter>();
        filters.append(&filter);
        let dialog = gtk::FileDialog::new();
        dialog.set_title("Attach a document or picture");
        dialog.set_filters(Some(&filters));
        let window = self.root().and_downcast::<gtk::Window>();
        let chat = self.clone();
        dialog.open(window.as_ref(), gio::Cancellable::NONE, move |result| {
            let Some(path) = result.ok().and_then(|file| file.path()) else {
                return;
            };
            match picture_type(&path) {
                Some(mime) => chat.attach_picture(&path, mime),
                None => chat.attach_document(path),
            }
        });
    }

    /// Keeps a picture for the next message.
    fn attach_picture(&self, path: &std::path::Path, mime: &str) {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        match std::fs::read(path) {
            Ok(data) if data.len() > MAX_PICTURE => self.toast("The picture is larger than 10 MB."),
            Ok(data) => {
                let mut images = self.imp().images.borrow_mut();
                images.push(ImageRecord {
                    name: name.clone(),
                    mime: mime.to_owned(),
                    data,
                });
                let count = images.len();
                drop(images);
                self.toast(&format!("Added {name} ({count} waiting)"));
            }
            Err(_) => self.toast("The file could not be read."),
        }
    }

    /// Reads the document on the runtime and adds its text to the composer, so the user sees it before sending.
    fn attach_document(&self, path: std::path::PathBuf) {
        let chat = self.clone();
        glib::spawn_future_local(async move {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let read = runtime()
                .spawn(read_document(path.to_string_lossy().into_owned()))
                .await;
            match read {
                Ok(Ok(text)) => {
                    let buffer = chat.imp().input.buffer();
                    let typed = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false);
                    buffer.set_text(&with_document(&typed, &name, &text));
                }
                Ok(Err(error)) => chat.toast(&error.to_string()),
                Err(_) => chat.toast("The document could not be read."),
            }
        });
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
            let images = chat.imp().images.take();
            chat.run_turn(session, text, images);
        });
    }

    /// The session for these settings: the one in use, or a new one with the stored key. A shown saved conversation
    /// is restored into the new session. Otherwise a new session starts a new conversation.
    async fn session_for(&self, state: &Rc<AppState>, settings: &Settings) -> Option<Arc<Session>> {
        let imp = self.imp();
        if let Some(live) = imp.live.borrow().as_ref()
            && &live.settings == settings
        {
            return Some(Arc::clone(&live.session));
        }
        let secrets = Arc::clone(&state.secrets);
        // Without a keyring the server is tried with no key; a server that needs one answers with an error.
        let key = runtime()
            .spawn(async move { secrets.get(SERVER_KEY).await })
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
        let brave = if settings.web {
            let secrets = Arc::clone(&state.secrets);
            runtime()
                .spawn(async move { secrets.get(BRAVE_KEY).await })
                .await
                .ok()
                .and_then(Result::ok)
                .flatten()
        } else {
            None
        };
        let config = match settings.session_config(key) {
            Ok(mut config) => {
                config.web = settings.web_config(brave);
                config
            }
            Err(error) => {
                self.toast(&error.to_string());
                return None;
            }
        };
        let created = match state.mcp() {
            Some(mcp) => Session::with_mcp(config, mcp),
            None => Session::new(config),
        };
        let session = match created {
            Ok(session) => session,
            Err(error) => {
                self.toast(&error.to_string());
                return None;
            }
        };
        let resume = imp.pending.borrow().clone();
        let id = match &resume {
            Some(conversation) => {
                if !conversation.messages.is_empty()
                    && let Err(error) = session.restore(to_records(&conversation.messages))
                {
                    self.toast(&error.to_string());
                    return None;
                }
                conversation.id.clone()
            }
            None => {
                if imp.live.borrow().is_some() {
                    self.toast("The settings changed, so this is a new conversation.");
                    self.clear_transcript();
                }
                conversations::new_id()
            }
        };
        *imp.pending.borrow_mut() = None;
        *imp.live.borrow_mut() = Some(Live {
            settings: settings.clone(),
            session: Arc::clone(&session),
            id,
        });
        Some(session)
    }

    /// Shows the session's plan above the composer, or hides the strip while there is none.
    fn refresh_plan(&self) {
        let imp = self.imp();
        let steps = match imp.live.borrow().as_ref() {
            Some(live) => live.session.plan(),
            None => Vec::new(),
        };
        while let Some(child) = imp.plan_steps.first_child() {
            imp.plan_steps.remove(&child);
        }
        imp.plan.set_visible(!steps.is_empty());
        let done = steps.iter().filter(|step| step.status == "done").count();
        imp.plan_title
            .set_label(&format!("Plan · {done} of {}", steps.len()));
        for step in &steps {
            let mark = match step.status.as_str() {
                "done" => "✓",
                "doing" => "▶",
                _ => "○",
            };
            let label = gtk::Label::new(Some(&format!("{mark}  {}", step.text)));
            label.set_xalign(0.0);
            label.set_wrap(true);
            if step.status == "done" {
                label.add_css_class("dim-label");
            }
            imp.plan_steps.append(&label);
        }
    }

    /// Reads the finished reply aloud while the speaker button is on.
    fn read_aloud(&self) {
        let imp = self.imp();
        if !imp.speak.is_active() {
            return;
        }
        let text = imp.log.borrow().entries().last().map(|e| e.text.clone());
        if let Some(text) = text {
            speech::speak(&text);
        }
    }

    fn clear_plan(&self) {
        if let Some(live) = self.imp().live.borrow().as_ref() {
            live.session.clear_plan();
        }
        self.refresh_plan();
    }

    fn clear_transcript(&self) {
        let imp = self.imp();
        *imp.log.borrow_mut() = Transcript::default();
        *imp.reply.borrow_mut() = None;
        while let Some(child) = imp.transcript.first_child() {
            imp.transcript.remove(&child);
        }
    }

    fn run_turn(&self, session: Arc<Session>, text: String, images: Vec<ImageRecord>) {
        let imp = self.imp();
        let shown = images.iter().fold(text.clone(), |shown, image| {
            format!("{shown}\n[{}]", image.name)
        });
        imp.log.borrow_mut().begin_turn(&shown);
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
        *imp.cancel.borrow_mut() = Some(start_turn(session, text, images, tx));
        let chat = self.clone();
        glib::spawn_future_local(async move {
            while let Ok(message) = rx.recv().await {
                match message {
                    ChatMessage::Events(events) => {
                        chat.imp().log.borrow_mut().apply(&events);
                        chat.refresh_reply();
                        chat.refresh_plan();
                    }
                    ChatMessage::Approval { request, reply } => {
                        chat.ask_approval(request, reply);
                    }
                    ChatMessage::Finished(result) => {
                        chat.imp().log.borrow_mut().finish(result);
                        chat.refresh_reply();
                        chat.refresh_plan();
                        chat.read_aloud();
                        chat.save_turn();
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
        dialog.choose(Some(self), gtk::gio::Cancellable::NONE, move |response| {
            let choice = match response.as_str() {
                "once" => ApprovalChoice::Once,
                "task" => ApprovalChoice::Task,
                "workspace" => ApprovalChoice::Workspace,
                _ => ApprovalChoice::No,
            };
            // The turn's thread has stopped waiting if the turn was stopped; nothing more to do then.
            let _ = reply.send(choice);
        });
    }
}

/// A row for one message, and the labels a reply keeps updating.
fn entry_row(entry: &Entry) -> (gtk::Box, ReplyParts) {
    let row = gtk::Box::new(gtk::Orientation::Vertical, 4);
    let body = gtk::Box::new(gtk::Orientation::Vertical, 8);
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
    row.append(&body);
    row.append(&steps);
    row.append(&meta);
    match entry.role {
        Role::User => {
            row.add_css_class("message-user");
            row.set_halign(gtk::Align::End);
        }
        Role::Assistant => row.add_css_class("message-assistant"),
    }
    let parts = ReplyParts {
        body,
        steps,
        meta,
        shown: RefCell::new(None),
    };
    fill(&parts, entry);
    (row, parts)
}

fn fill(parts: &ReplyParts, entry: &Entry) {
    let shown = if entry.streaming && entry.text.is_empty() {
        "…".to_owned()
    } else {
        entry.text.clone()
    };
    if parts.shown.borrow().as_deref() != Some(shown.as_str()) {
        draw_body(&parts.body, entry, &shown);
        *parts.shown.borrow_mut() = Some(shown);
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

/// Replaces the body with the text drawn for its role: plain for the user, Markdown blocks for the assistant.
fn draw_body(body: &gtk::Box, entry: &Entry, text: &str) {
    while let Some(child) = body.first_child() {
        body.remove(&child);
    }
    match entry.role {
        Role::User => {
            let label = markup_label(&markdown::escape(text), "message-text");
            label.set_xalign(1.0);
            body.append(&label);
        }
        Role::Assistant => {
            for block in markdown::parse(text) {
                body.append(&block_widget(&block));
            }
        }
    }
}

/// The widget that draws one Markdown block of a reply.
fn block_widget(block: &Block) -> gtk::Widget {
    match block {
        Block::Paragraph(markup) => markup_label(markup, "message-text").upcast(),
        Block::Heading(markup) => markup_label(markup, "markdown-heading").upcast(),
        Block::Quote(markup) => markup_label(markup, "markdown-quote").upcast(),
        Block::Item { marker, markup } => {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            let bullet = gtk::Label::builder()
                .label(marker.as_str())
                .valign(gtk::Align::Start)
                .css_classes(["message-text", "dim-label"])
                .build();
            row.append(&bullet);
            row.append(&markup_label(markup, "message-text"));
            row.upcast()
        }
        Block::Code { language, code } => code_block(language, code).upcast(),
    }
}

/// A selectable label that reads its text as Pango markup. The markup comes from `markdown`, which escapes it.
fn markup_label(markup: &str, class: &str) -> gtk::Label {
    gtk::Label::builder()
        .use_markup(true)
        .label(markup)
        .wrap(true)
        .wrap_mode(gtk::pango::WrapMode::WordChar)
        .xalign(0.0)
        .hexpand(true)
        .selectable(true)
        .css_classes([class])
        .build()
}

/// Opens the model's HTML in a window that runs no scripts and follows no links.
fn show_preview(button: &gtk::Button, html: &str) {
    use webkit6::prelude::*;
    let view = webkit6::WebView::new();
    if let Some(settings) = webkit6::prelude::WebViewExt::settings(&view) {
        settings.set_enable_javascript(false);
    }
    view.connect_decide_policy(|_, decision, kind| {
        if kind == webkit6::PolicyDecisionType::NavigationAction {
            let is_load = decision
                .clone()
                .downcast::<webkit6::NavigationPolicyDecision>()
                .ok()
                .and_then(|d| d.navigation_action())
                .and_then(|a| a.request())
                .and_then(|r| r.uri())
                .is_some_and(|uri| uri.as_str() != "about:blank");
            if is_load {
                decision.ignore();
                return true;
            }
        }
        false
    });
    view.load_html(html, None);
    let window = adw::Window::builder()
        .title("Preview")
        .default_width(720)
        .default_height(520)
        .content(&view)
        .build();
    window.set_transient_for(button.root().and_downcast::<gtk::Window>().as_ref());
    window.present();
}

/// A code block with its language and a button that copies the code. A long line scrolls sideways.
fn code_block(language: &str, code: &str) -> gtk::Box {
    let frame = gtk::Box::new(gtk::Orientation::Vertical, 0);
    frame.add_css_class("markdown-code");
    let header = gtk::Box::new(gtk::Orientation::Horizontal, 4);
    let name = gtk::Label::builder()
        .label(if language.is_empty() {
            "code"
        } else {
            language
        })
        .xalign(0.0)
        .hexpand(true)
        .css_classes(["caption", "dim-label"])
        .build();
    let copy = gtk::Button::builder()
        .icon_name("edit-copy-symbolic")
        .tooltip_text("Copy code")
        .css_classes(["flat"])
        .build();
    let text = code.to_owned();
    copy.connect_clicked(move |button| button.clipboard().set_text(&text));
    header.append(&name);
    if preview::is_html(language) {
        let show = gtk::Button::builder()
            .icon_name("view-reveal-symbolic")
            .tooltip_text("Preview")
            .css_classes(["flat"])
            .build();
        let html = preview::page(code);
        show.connect_clicked(move |button| show_preview(button, &html));
        header.append(&show);
    }
    header.append(&copy);
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Automatic)
        .vscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .build();
    let label = gtk::Label::builder()
        .label(code)
        .xalign(0.0)
        .selectable(true)
        .css_classes(["code"])
        .build();
    scroller.set_child(Some(&label));
    frame.append(&header);
    frame.append(&scroller);
    frame
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
        assert_eq!(body_text(&parts), "…");
        log.apply(&[TurnEventRecord::Patch {
            content: String::new(),
            text_content: "Hi there".to_owned(),
            steps: Vec::new(),
        }]);
        fill(&parts, &log.entries()[1]);
        assert_eq!(body_text(&parts), "Hi there");
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
        assert_eq!(body_text(&parts), "hello");
    }

    #[test]
    fn the_plan_strip_stays_hidden_until_there_is_a_plan() {
        if !ready() {
            return;
        }
        let chat: DraggyChat = glib::Object::new();
        chat.refresh_plan();
        assert!(!chat.imp().plan.is_visible());
        assert!(chat.imp().plan_steps.first_child().is_none());
    }

    #[test]
    fn the_read_aloud_toggle_starts_off() {
        if !ready() {
            return;
        }
        let chat: DraggyChat = glib::Object::new();
        assert!(!chat.imp().speak.is_active());
        // With the toggle off a finished reply is not read.
        chat.read_aloud();
    }

    #[test]
    fn a_code_block_shows_its_language_and_a_preview_button_only_for_html() {
        if !ready() {
            return;
        }
        let buttons = |language: &str| {
            let block = code_block(language, "<p>hi</p>");
            let mut count = 0;
            let mut child = block.first_child();
            while let Some(widget) = child {
                count += widget_buttons(&widget);
                child = widget.next_sibling();
            }
            count
        };
        assert!(buttons("html") > buttons("rust"));
    }

    /// The buttons inside a widget, itself included.
    fn widget_buttons(widget: &gtk::Widget) -> usize {
        let mut count = usize::from(widget.is::<gtk::Button>());
        let mut child = widget.first_child();
        while let Some(inner) = child {
            count += widget_buttons(&inner);
            child = inner.next_sibling();
        }
        count
    }

    /// The text of a body that holds one label, such as a plain message or a single paragraph.
    fn body_text(parts: &ReplyParts) -> String {
        parts
            .body
            .first_child()
            .and_then(|child| child.downcast::<gtk::Label>().ok())
            .map(|label| label.text().to_string())
            .unwrap_or_default()
    }
}
