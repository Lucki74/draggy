//! JavaScript string semantics the reference relies on: `\s` and `trim()` for whitespace, and `.length` and `slice()`
//! counting UTF-16 units. Rust counts characters, so the limits and trims go through here to match Electron.

/// Whitespace and line terminators as ECMAScript defines them. Unlike `char::is_whitespace`, this includes U+FEFF and
/// leaves out U+0085.
pub(crate) fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// The length a JavaScript string reports: UTF-16 code units.
pub(crate) fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// `text.slice(0, limit)` by UTF-16 units.
// TS quirk: slice() can split a surrogate pair and keep the lone half. Rust text cannot hold one, so it shows U+FFFD.
pub(crate) fn take_units(text: &str, limit: usize) -> String {
    let mut units = 0;
    let mut out = String::new();
    for c in text.chars() {
        if units + c.len_utf16() > limit {
            if units < limit {
                out.push('\u{FFFD}');
            }
            break;
        }
        units += c.len_utf16();
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_follows_ecmascript_not_rust() {
        assert_eq!(trim("\u{feff}a\u{feff}"), "a");
        assert_eq!(trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
        assert!(is_space('\u{2028}'));
    }

    #[test]
    fn length_and_cuts_count_utf16_units() {
        let emoji = "\u{1F642}";
        assert_eq!(utf16_len(&format!("a{emoji}")), 3);
        assert_eq!(take_units(&format!("a{emoji}b"), 3), format!("a{emoji}"));
        assert_eq!(take_units(&format!("a{emoji}b"), 2), "a\u{FFFD}");
    }
}
