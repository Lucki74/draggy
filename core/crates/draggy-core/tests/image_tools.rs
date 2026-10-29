use draggy_core::tools::image_definitions;

fn names(vision: bool) -> Vec<String> {
    image_definitions(vision)
        .into_iter()
        .map(|tool| tool.function.name)
        .collect()
}

#[test]
fn view_image_needs_a_vision_model() {
    assert_eq!(names(false), ["generate_image"]);
    assert_eq!(names(true), ["generate_image", "view_image"]);
}

#[test]
fn generate_image_takes_a_reference() {
    let tool = &image_definitions(false)[0];
    assert!(tool.function.parameters["properties"]["reference_image"].is_object());
    assert_eq!(
        tool.function.parameters["required"],
        serde_json::json!(["prompt"])
    );
}
