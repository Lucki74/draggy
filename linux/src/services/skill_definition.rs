use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillParameter {
    pub name: String,
    pub r#type: String,
    pub description: String,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub parameters: Vec<SkillParameter>,
    pub prompt_template: Option<String>,
}
