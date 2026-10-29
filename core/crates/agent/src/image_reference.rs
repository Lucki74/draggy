//! The picture index the model sees and the default strength of a reference, ported from
//! `win/src/images/imageTracker.ts`. `shared/fixtures/agent/imageReference.json` pins both.

/// How far a reference may move when nobody asked for a value.
pub const DEFAULT_REFERENCE_STRENGTH: f64 = 0.35;

/// How many characters of a prompt the index keeps.
const LABEL_LIMIT: usize = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageOrigin {
    Generated,
    Attached,
}

/// One picture of a chat.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackedImage {
    pub id: String,
    pub origin: ImageOrigin,
    /// The prompt of a generated picture, or the file name of an attached one.
    pub label: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// One line per picture, never its bytes. Empty when the chat has none.
pub fn image_index(images: &[TrackedImage]) -> String {
    if images.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = images
        .iter()
        .map(|image| {
            let origin = match image.origin {
                ImageOrigin::Attached => format!("attached by the user ({})", image.label),
                ImageOrigin::Generated => {
                    let size = match (image.width, image.height) {
                        (Some(w), Some(h)) if w > 0 && h > 0 => format!(", {w}x{h}"),
                        _ => String::new(),
                    };
                    let label: String = image.label.chars().take(LABEL_LIMIT).collect();
                    format!("generated: \"{label}\"{size}")
                }
            };
            format!("- {}: {origin}", image.id)
        })
        .collect();
    format!(
        "Pictures in this chat (pass an ID as reference_image to generate_image to change a detail of one and keep the rest):\n{}",
        lines.join("\n")
    )
}

/// The strength asked for, else the low default when a reference is in use.
pub fn reference_strength(has_reference: bool, explicit: Option<f64>) -> Option<f64> {
    explicit.or(has_reference.then_some(DEFAULT_REFERENCE_STRENGTH))
}

/// The tool result line for a reference the model could not use.
pub fn dropped_notice(reference_id: &str) -> String {
    format!(
        " The reference {reference_id} was not used, because this image model cannot start from a picture or the file was gone, so it was drawn from the prompt alone. Tell the user."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generated(id: &str, label: &str) -> TrackedImage {
        TrackedImage { id: id.into(), origin: ImageOrigin::Generated, label: label.into(), width: None, height: None }
    }

    #[test]
    fn empty_chat_has_no_index() {
        assert_eq!(image_index(&[]), "");
    }

    #[test]
    fn long_prompts_are_cut() {
        let index = image_index(&[generated("img_1", &"x".repeat(300))]);
        assert!(index.contains(&format!("\"{}\"", "x".repeat(120))));
    }

    #[test]
    fn strength_prefers_the_explicit_value() {
        assert_eq!(reference_strength(true, Some(0.8)), Some(0.8));
        assert_eq!(reference_strength(true, None), Some(0.35));
        assert_eq!(reference_strength(false, None), None);
    }

    #[test]
    fn notice_names_the_reference() {
        assert!(dropped_notice("img_2").contains("img_2"));
    }
}
