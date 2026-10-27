use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageModel {
    pub id: String,
    pub name: String,
    pub filename: String,
}

pub fn available_image_models() -> Vec<ImageModel> {
    vec![
        ImageModel {
            id: "sd-turbo".to_string(),
            name: "SD Turbo (Fast)".to_string(),
            filename: "sd_turbo.gguf".to_string(),
        },
        ImageModel {
            id: "sd-1.5".to_string(),
            name: "Stable Diffusion 1.5".to_string(),
            filename: "sd15.gguf".to_string(),
        },
    ]
}
