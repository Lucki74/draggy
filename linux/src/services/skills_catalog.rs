use super::skill_definition::SkillDefinition;
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
pub struct SkillsCatalog {
    pub skills: Arc<Mutex<Vec<SkillDefinition>>>,
}

impl SkillsCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_skills(&self, skills: Vec<SkillDefinition>) {
        *self.skills.lock().unwrap() = skills;
    }

    pub fn search(&self, query: &str) -> Vec<SkillDefinition> {
        let q = query.to_lowercase();
        self.skills
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.name.to_lowercase().contains(&q) || s.description.to_lowercase().contains(&q))
            .cloned()
            .collect()
    }
}
