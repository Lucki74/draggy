use adw::prelude::*;
use std::rc::Rc;

use super::SkillCardView::build_skill_row;
use crate::services::extension_store::ExtensionStore;
use crate::services::skill_definition::SkillDefinition;

pub fn build(store: Rc<ExtensionStore>, skills: &[SkillDefinition]) -> gtk::Widget {
    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .build();
    list_box.add_css_class("boxed-list");

    let enabled = store.enabled_skills.lock().unwrap();
    for skill in skills {
        let is_en = enabled.contains(&skill.id);
        let row = build_skill_row(skill, is_en);
        list_box.append(&row);
    }

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&list_box)
        .build();

    scroll.upcast()
}
