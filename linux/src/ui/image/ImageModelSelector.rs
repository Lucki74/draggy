use adw::prelude::*;
use crate::services::image_model_manager::available_image_models;

pub fn build_selector() -> gtk::DropDown {
    let models = available_image_models();
    let names: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();
    gtk::DropDown::from_strings(&names)
}
