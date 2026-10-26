use adw::prelude::*;
use crate::services::plan_store::{PlanStep, StepStatus};

pub fn build_step_row(step: &PlanStep) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    let hbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(8)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let icon_name = match step.status {
        StepStatus::Pending => "checkbox-symbolic",
        StepStatus::InProgress => "process-working-symbolic",
        StepStatus::Completed => "emblem-ok-symbolic",
        StepStatus::Failed => "dialog-error-symbolic",
    };

    let icon = gtk::Image::from_icon_name(icon_name);
    let label = gtk::Label::builder()
        .label(&step.title)
        .xalign(0.0)
        .hexpand(true)
        .build();

    if step.status == StepStatus::Completed {
        label.add_css_class("dim-label");
    }

    hbox.append(&icon);
    hbox.append(&label);
    row.set_child(Some(&hbox));

    row
}
