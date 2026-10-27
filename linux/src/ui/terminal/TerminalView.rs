use adw::prelude::*;
use gtk::glib;
use std::cell::RefCell;
use std::rc::Rc;

use crate::services::shell_session::ShellSession;

pub struct TerminalViewWidget {
    pub container: gtk::Box,
    pub session: Rc<RefCell<Option<ShellSession>>>,
}

impl TerminalViewWidget {
    pub fn new() -> Self {
        let container = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .vexpand(true)
            .hexpand(true)
            .build();

        let text_view = gtk::TextView::builder()
            .editable(false)
            .cursor_visible(false)
            .monospace(true)
            .wrap_mode(gtk::WrapMode::Char)
            .build();

        text_view.add_css_class("terminal-output");

        let scroll = gtk::ScrolledWindow::builder()
            .vexpand(true)
            .hexpand(true)
            .child(&text_view)
            .build();

        let input_entry = gtk::Entry::builder()
            .placeholder_text("Enter command...")
            .hexpand(true)
            .build();

        let send_btn = gtk::Button::with_label("Send");

        let input_box = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(6)
            .margin_top(4)
            .margin_bottom(4)
            .margin_start(6)
            .margin_end(6)
            .build();

        input_box.append(&input_entry);
        input_box.append(&send_btn);

        container.append(&scroll);
        container.append(&input_box);

        let buffer = text_view.buffer();
        let session_cell = Rc::new(RefCell::new(None));
        let session = ShellSession::new("default".to_string(), None);

        let buf_clone = buffer.clone();
        let (sender, receiver) = async_channel::unbounded::<String>();

        let _ = session.start(move |out| {
            let _ = sender.send_blocking(out);
        });

        glib::spawn_future_local(async move {
            while let Ok(text) = receiver.recv().await {
                let mut end = buf_clone.end_iter();
                buf_clone.insert(&mut end, &text);
            }
        });

        *session_cell.borrow_mut() = Some(session);

        let session_for_input = Rc::clone(&session_cell);
        let entry_clone = input_entry.clone();
        input_entry.connect_activate(move |_| {
            let text = entry_clone.text().to_string();
            if !text.is_empty() {
                if let Some(ref sess) = *session_for_input.borrow() {
                    let _ = sess.write_input(&format!("{}\n", text));
                }
                entry_clone.set_text("");
            }
        });

        let session_for_btn = Rc::clone(&session_cell);
        let entry_for_btn = input_entry.clone();
        send_btn.connect_clicked(move |_| {
            let text = entry_for_btn.text().to_string();
            if !text.is_empty() {
                if let Some(ref sess) = *session_for_btn.borrow() {
                    let _ = sess.write_input(&format!("{}\n", text));
                }
                entry_for_btn.set_text("");
            }
        });

        Self {
            container,
            session: session_cell,
        }
    }

    pub fn widget(&self) -> gtk::Widget {
        self.container.clone().upcast()
    }
}
