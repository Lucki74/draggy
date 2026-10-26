use adw::prelude::*;
use std::rc::Rc;

use super::RemoteServersView;
use super::SkillsTabView;
use crate::services::extension_store::ExtensionStore;
use crate::services::skill_definition::SkillDefinition;

pub fn build(store: Rc<ExtensionStore>, skills: &[SkillDefinition]) -> gtk::Widget {
    let notebook = gtk::Notebook::builder()
        .show_tabs(true)
        .show_border(false)
        .build();

    let skills_tab = SkillsTabView::build(Rc::clone(&store), skills);
    let servers_tab = RemoteServersView::build(Rc::clone(&store));

    notebook.append_page(&skills_tab, Some(&gtk::Label::new(Some("Skills"))));
    notebook.append_page(&servers_tab, Some(&gtk::Label::new(Some("Remote Servers"))));

    notebook.upcast()
}
