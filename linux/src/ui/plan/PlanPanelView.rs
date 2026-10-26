use adw::prelude::*;
use std::rc::Rc;

use super::PlanStepView::build_step_row;
use crate::services::plan_store::PlanStore;

pub fn build(store: Rc<PlanStore>) -> gtk::Widget {
    let container = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();

    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(4)
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let title = gtk::Label::builder()
        .label("Execution Plan")
        .css_classes(["title-3"])
        .xalign(0.0)
        .build();

    let goal_label = gtk::Label::builder()
        .label("No active plan")
        .css_classes(["body"])
        .xalign(0.0)
        .build();

    header.append(&title);
    header.append(&goal_label);

    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .build();
    list_box.add_css_class("boxed-list");

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&list_box)
        .build();

    container.append(&header);
    container.append(&scroll);

    if let Some(ref plan) = *store.current_plan.lock().unwrap() {
        goal_label.set_label(&plan.goal);
        for step in &plan.steps {
            let row = build_step_row(step);
            list_box.append(&row);
        }
    }

    container.upcast()
}
