//! String helpers that follow JavaScript's rules, so the Rust lines match the Electron ones byte for byte.

use sha2::{Digest, Sha256};

/// JavaScript counts a string in UTF-16 code units, so an emoji is two.
pub(crate) fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The first `max` UTF-16 units. TS quirk: a cut through a pair leaves a lone surrogate, which Node writes as U+FFFD.
/// Divergence: JSON.stringify escapes that lone surrogate as `\ud83d`; a Rust string cannot hold it, so U+FFFD stays.
pub(crate) fn cut16(text: &str, max: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(max).collect();
    String::from_utf16_lossy(&units)
}

/// The first four bytes of the SHA-256 as hex. Enough to match two lines to one value, not enough to recover it.
pub(crate) fn sha8(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The characters JavaScript's `\s` and `String.prototype.trim` take: Unicode spaces, tabs and line terminators.
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `trim()` as JavaScript does it, which also removes the byte order mark that Rust's `trim` keeps.
pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

#[cfg(test)]
mod tests {
    use super::{cut16, is_js_space, js_len, js_trim, sha8};

    #[test]
    fn counts_and_cuts_in_utf16_units() {
        assert_eq!(js_len("😀"), 2);
        assert_eq!(js_len("café"), 4);
        assert_eq!(cut16("ab😀cd", 3), "ab\u{FFFD}");
        assert_eq!(cut16("ab😀cd", 4), "ab😀");
    }

    #[test]
    fn hashes_the_empty_string_to_the_known_prefix() {
        assert_eq!(sha8(""), "e3b0c442");
    }

    #[test]
    fn trim_removes_the_byte_order_mark_and_keeps_next_line() {
        assert_eq!(js_trim("\u{FEFF} a \u{0085}"), "a \u{0085}");
        assert!(is_js_space('\u{2028}'));
        assert!(!is_js_space('\u{0085}'));
    }
}
