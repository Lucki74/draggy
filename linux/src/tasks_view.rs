//! The Tasks list of a chat: each background command with its state, runtime and last line, and a Stop button on the
//! running ones. It opens from the chip under the last reply.

use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use draggy_core::TaskRecord;
use draggy_linux::tasks::task_meta;

/// The widgets of one task. A refresh with the same tasks in the same states only changes their labels.
struct Row {
    id: String,
    status: String,
    widget: gtk::ListBoxRow,
    meta: gtk::Label,
    last_line: gtk::Label,
    stop: gtk::Button,
}

/// The Tasks dialog. `on_stop` receives the id of a task the person asked to stop.
pub struct TasksList {
    dialog: adw::Dialog,
    list: gtk::ListBox,
    empty: gtk::Label,
    rows: RefCell<Vec<Row>>,
    on_stop: Rc<dyn Fn(String)>,
}

impl TasksList {
    pub fn new(on_stop: Rc<dyn Fn(String)>) -> Self {
        let list = gtk::ListBox::builder()
            .selection_mode(gtk::SelectionMode::None)
            .css_classes(["boxed-list"])
            .build();
        let empty = gtk::Label::builder()
            .label("No background tasks in this chat.")
            .css_classes(["dim-label"])
            .margin_top(24)
            .margin_bottom(24)
            .build();
        let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
        content.set_margin_top(12);
        content.set_margin_bottom(12);
        content.set_margin_start(12);
        content.set_margin_end(12);
        content.append(&list);
        content.append(&empty);
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .child(&content)
            .build();
        let view = adw::ToolbarView::new();
        view.add_top_bar(&adw::HeaderBar::new());
        view.set_content(Some(&scroller));
        let dialog = adw::Dialog::builder()
            .title("Tasks")
            .content_width(520)
            .content_height(380)
            .child(&view)
            .build();
        Self {
            dialog,
            list,
            empty,
            rows: RefCell::new(Vec::new()),
            on_stop,
        }
    }

    /// The dialog itself, to present it and to hear when it closes.
    pub fn dialog(&self) -> &adw::Dialog {
        &self.dialog
    }

    /// Brings the list up to date. The rows are rebuilt only when a task was added, removed or changed state, so a
    /// running task's clock and last line update in place.
    pub fn refresh(&self, tasks: &[TaskRecord]) {
        let same_rows = {
            let rows = self.rows.borrow();
            rows.len() == tasks.len()
                && rows
                    .iter()
                    .zip(tasks)
                    .all(|(row, task)| row.id == task.id && row.status == task.status)
        };
        if same_rows {
            for (row, task) in self.rows.borrow().iter().zip(tasks) {
                update_labels(row, task);
            }
        } else {
            self.rebuild(tasks);
        }
        self.empty.set_visible(tasks.is_empty());
        self.list.set_visible(!tasks.is_empty());
    }

    fn rebuild(&self, tasks: &[TaskRecord]) {
        while let Some(child) = self.list.first_child() {
            self.list.remove(&child);
        }
        let rows: Vec<Row> = tasks
            .iter()
            .map(|task| {
                let row = build_row(task, Rc::clone(&self.on_stop));
                self.list.append(&row.widget);
                row
            })
            .collect();
        *self.rows.borrow_mut() = rows;
    }
}

fn build_row(task: &TaskRecord, on_stop: Rc<dyn Fn(String)>) -> Row {
    let command = gtk::Label::builder()
        .label(&task.command)
        .xalign(0.0)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .tooltip_text(task.command.as_str())
        .css_classes(["code"])
        .build();
    let meta = gtk::Label::builder()
        .xalign(0.0)
        .css_classes(["caption", "dim-label"])
        .build();
    let last_line = gtk::Label::builder()
        .xalign(0.0)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .css_classes(["caption", "dim-label", "code"])
        .build();
    let text = gtk::Box::new(gtk::Orientation::Vertical, 2);
    text.set_hexpand(true);
    text.append(&command);
    text.append(&meta);
    text.append(&last_line);
    let stop = gtk::Button::builder()
        .label("Stop")
        .valign(gtk::Align::Center)
        .build();
    let body = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    body.set_margin_top(10);
    body.set_margin_bottom(10);
    body.set_margin_start(12);
    body.set_margin_end(12);
    body.append(&text);
    body.append(&stop);
    let widget = gtk::ListBoxRow::builder()
        .activatable(false)
        .selectable(false)
        .child(&body)
        .build();
    let id = task.id.clone();
    stop.connect_clicked(move |button| {
        button.set_sensitive(false);
        on_stop(id.clone());
    });
    let row = Row {
        id: task.id.clone(),
        status: task.status.clone(),
        widget,
        meta,
        last_line,
        stop,
    };
    update_labels(&row, task);
    row
}

fn update_labels(row: &Row, task: &TaskRecord) {
    row.meta.set_text(&task_meta(task));
    row.last_line.set_text(&task.last_line);
    row.last_line.set_visible(!task.last_line.is_empty());
    row.stop.set_visible(task.status == "running");
    row.stop.set_sensitive(true);
}
