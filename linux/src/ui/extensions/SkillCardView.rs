use crate::services::skill_definition::SkillDefinition;
use adw::prelude::*;

pub fn build_skill_row(skill: &SkillDefinition, is_enabled: bool) -> adw::ActionRow {
    let row = adw::ActionRow::builder()
        .title(&skill.name)
        .subtitle(&skill.description)
        .build();

    let toggle = gtk::Switch::builder()
        .active(is_enabled)
        .valign(gtk::Align::Center)
        .build();

    row.add_suffix(&toggle);
    row
}
