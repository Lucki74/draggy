//! Filters what a shell prints before the renderer sees it. Titles, clipboard writes and device strings are dropped;
//! colours, cursor moves and hyperlinks (OSC 8, checked by the renderer) pass. A sequence split across chunks is held.

use std::sync::LazyLock;

use regex::{Captures, Regex};

/// An unfinished escape sequence is held back for the next chunk, up to this many bytes.
const MAX_PENDING_ESCAPE: usize = 8192;

static OSC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)").expect("osc"));
static STRING_SEQUENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b[P_^X][^\x1b]*\x1b\\").expect("string"));
static UNFINISHED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b(?:[\]P_^X][^\x1b\x07]*)?$").expect("open"));
static C1: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\u{80}-\u{9f}]").expect("c1"));

#[derive(Debug, Default)]
pub struct Sanitizer {
    pending: String,
}

impl Sanitizer {
    pub fn feed(&mut self, chunk: &str) -> String {
        let mut text = std::mem::take(&mut self.pending) + chunk;
        if let Some(open) = UNFINISHED.find(&text) {
            let held = text[open.start()..].to_string();
            text.truncate(open.start());
            if held.len() <= MAX_PENDING_ESCAPE {
                self.pending = held;
            }
        }
        let text = OSC.replace_all(&text, |caps: &Captures| {
            if caps[1].starts_with("8;") {
                caps[0].to_string()
            } else {
                String::new()
            }
        });
        let text = STRING_SEQUENCE.replace_all(&text, "");
        C1.replace_all(&text, "").into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(chunks: &[&str]) -> String {
        let mut sanitizer = Sanitizer::default();
        chunks.iter().map(|chunk| sanitizer.feed(chunk)).collect()
    }

    #[test]
    fn passes_colours_cursor_moves_and_hyperlinks() {
        let text = "\x1b[31mred\x1b[0m \x1b[2;3H\x1b]8;;https://example.com\x07link\x1b]8;;\x07";
        assert_eq!(clean(&[text]), text);
    }

    #[test]
    fn drops_clipboard_writes_window_titles_and_other_osc_strings() {
        assert_eq!(clean(&["a\x1b]0;title\x07b"]), "ab");
        assert_eq!(clean(&["a\x1b]52;c;aGk=\x1b\\b"]), "ab");
    }

    #[test]
    fn drops_device_strings_and_8_bit_controls() {
        assert_eq!(clean(&["a\x1bP+q544e\x1b\\b"]), "ab");
        assert_eq!(clean(&["a\u{9b}31mb"]), "a31mb");
    }

    #[test]
    fn holds_a_sequence_split_between_two_chunks_until_it_ends() {
        assert_eq!(clean(&["ok \x1b]0;ti", "tle\x07done"]), "ok done");
    }

    #[test]
    fn does_not_hold_an_endless_string_forever() {
        let endless = format!("\x1b]0;{}", "x".repeat(MAX_PENDING_ESCAPE + 1));
        let mut sanitizer = Sanitizer::default();
        assert_eq!(sanitizer.feed(&endless), "");
        assert_eq!(sanitizer.feed("visible"), "visible");
    }
}
