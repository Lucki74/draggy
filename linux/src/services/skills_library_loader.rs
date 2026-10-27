use super::skill_definition::SkillDefinition;
use std::fs;
use std::path::Path;

pub struct SkillsLibraryLoader;

impl SkillsLibraryLoader {
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Vec<SkillDefinition>, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }
}
