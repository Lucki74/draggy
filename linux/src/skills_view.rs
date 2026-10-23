//! The Skills page: the skills the model may load, with a button to add a folder and one to remove each.

use std::rc::Rc;

use adw::prelude::*;
use draggy_core::{install_skill, list_skills, remove_skill};
use draggy_linux::models::skills_dir;
use gtk::gio;

type Notify = Rc<dyn Fn(&str)>;

pub fn build(notify: impl Fn(&str) + 'static) -> gtk::Widget {
    let notify: Notify = Rc::new(notify);
    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    let hint = gtk::Label::builder()
        .label("Pick a folder that holds a SKILL.md. The model loads a skill when a request matches its description.")
        .wrap(true)
        .xalign(0.0)
        .css_classes(["dim-label"])
        .build();
    let add = gtk::Button::with_label("Add a skill folder");
    add.set_halign(gtk::Align::Start);
    let page = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(18)
        .margin_bottom(18)
        .margin_start(18)
        .margin_end(18)
        .build();
    page.append(&hint);
    page.append(&add);
    page.append(&list);
    fill(&list, &notify);

    add.connect_clicked({
        let (list, notify) = (list.clone(), notify.clone());
        move |button| {
            let dialog = gtk::FileDialog::new();
            dialog.set_title("Add a skill folder");
            let window = button.root().and_downcast::<gtk::Window>();
            let (list, notify) = (list.clone(), notify.clone());
            dialog.select_folder(window.as_ref(), gio::Cancellable::NONE, move |result| {
                let Some(path) = result.ok().and_then(|file| file.path()) else {
                    return;
                };
                let Some(dir) = skills_dir() else {
                    notify("The skills folder could not be found.");
                    return;
                };
                match install_skill(
                    dir.to_string_lossy().into_owned(),
                    path.to_string_lossy().into_owned(),
                ) {
                    Ok(id) => notify(&format!("Added {id}")),
                    Err(error) => notify(&error.to_string()),
                }
                fill(&list, &notify);
            });
        }
    });
    gtk::ScrolledWindow::builder()
        .child(&page)
        .vexpand(true)
        .build()
        .upcast()
}

/// Rebuilds the rows from the skills folder.
fn fill(list: &gtk::ListBox, notify: &Notify) {
    while let Some(row) = list.first_child() {
        list.remove(&row);
    }
    let Some(dir) = skills_dir() else {
        return;
    };
    let dir = dir.to_string_lossy().into_owned();
    let skills = list_skills(dir.clone());
    if skills.is_empty() {
        list.append(
            &adw::ActionRow::builder()
                .title("No skills installed")
                .build(),
        );
    }
    for skill in skills {
        let row = adw::ActionRow::builder()
            .title(gtk::glib::markup_escape_text(&skill.name))
            .subtitle(gtk::glib::markup_escape_text(&skill.description))
            .build();
        let remove = gtk::Button::from_icon_name("user-trash-symbolic");
        remove.set_valign(gtk::Align::Center);
        remove.set_tooltip_text(Some("Remove"));
        remove.add_css_class("flat");
        row.add_suffix(&remove);
        let (shelf, notify, dir, id) = (list.clone(), notify.clone(), dir.clone(), skill.id);
        remove.connect_clicked(move |_| {
            match remove_skill(dir.clone(), id.clone()) {
                Ok(()) => notify("Skill removed"),
                Err(error) => notify(&error.to_string()),
            }
            fill(&shelf, &notify);
        });
        list.append(&row);
    }
}
