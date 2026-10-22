//! Text for the MCP servers page, kept apart from the widgets so it can be tested without a display.

/// The line under a server's name: what it does, then the warning when it has one.
pub fn subtitle(description: &str, caution: Option<&str>) -> String {
    match caution {
        Some(text) if !text.trim().is_empty() => format!("{description}\nCaution: {text}"),
        _ => description.to_owned(),
    }
}

/// The text of a server's button.
pub fn action_label(running: bool) -> &'static str {
    if running { "Stop" } else { "Start" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_caution_follows_the_description() {
        assert_eq!(
            subtitle("Files", Some("Reads disk")),
            "Files\nCaution: Reads disk"
        );
    }

    #[test]
    fn a_blank_caution_is_dropped() {
        assert_eq!(subtitle("Files", Some("  ")), "Files");
        assert_eq!(subtitle("Files", None), "Files");
    }

    #[test]
    fn the_button_names_the_next_step() {
        assert_eq!(action_label(false), "Start");
        assert_eq!(action_label(true), "Stop");
    }
}
