//! The JavaScript string and number rules the reference relies on: what `trim` and `\s` match, `Math.round`,
//! `parseFloat`, and the regex helpers that treat a missing pattern as no match.

use std::sync::LazyLock;

use regex::{Captures, Regex};

/// The characters JavaScript's `\s` and `trim` match, as the body of a regex class.
pub const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// `.` in a JavaScript regex, which does not match a carriage return or the two line separators either.
pub const JS_DOT: &str = r"[^\n\r\x{2028}\x{2029}]";

/// A compiled pattern, or None when it fails to compile. Every pattern here is a constant that the tests compile.
pub type Pattern = LazyLock<Option<Regex>>;

/// Compiles a pattern, replacing `{S}` with the JavaScript whitespace class body.
pub fn compile(source: &str) -> Option<Regex> {
    Regex::new(&source.replace("{S}", JS_SPACE)).ok()
}

/// Whether the pattern matches anywhere in `text`.
pub fn is_match(pattern: &Pattern, text: &str) -> bool {
    pattern.as_ref().is_some_and(|re| re.is_match(text))
}

/// The first match of the pattern in `text`, with its groups.
pub fn captures<'t>(pattern: &Pattern, text: &'t str) -> Option<Captures<'t>> {
    pattern.as_ref()?.captures(text)
}

/// Replaces every match of the pattern, calling `replacer` for each.
pub fn replace_all(
    pattern: &Pattern,
    text: &str,
    replacer: impl FnMut(&Captures) -> String,
) -> String {
    match pattern.as_ref() {
        Some(re) => re.replace_all(text, replacer).into_owned(),
        None => text.to_owned(),
    }
}

/// Replaces the first match of the pattern, calling `replacer` for it.
pub fn replace_first(
    pattern: &Pattern,
    text: &str,
    replacer: impl FnMut(&Captures) -> String,
) -> String {
    match pattern.as_ref() {
        Some(re) => re.replace(text, replacer).into_owned(),
        None => text.to_owned(),
    }
}

/// The regex for a word with each ASCII letter matched in either case. Unicode folding would also match the long
/// s, which JavaScript's `/i` without the `u` flag does not, so the letters are spelled out.
pub fn ci(word: &str) -> String {
    word.chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
            } else {
                regex::escape(&c.to_string())
            }
        })
        .collect()
}

/// Whether a character is in JavaScript's whitespace set, which `trim` also strips.
pub fn is_js_space(c: char) -> bool {
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

/// `String.prototype.trim`.
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// `Math.round`, which rounds a half toward positive infinity.
pub fn round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `parseFloat` for text that has already matched a number pattern. NaN when no number leads the text.
pub fn parse_float(text: &str) -> f64 {
    static LEADING_NUMBER: Pattern =
        LazyLock::new(|| compile(r"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)"));
    captures(&LEADING_NUMBER, text)
        .and_then(|caps| caps.get(0))
        .and_then(|found| found.as_str().parse::<f64>().ok())
        .unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_strips_the_javascript_set_only() {
        assert_eq!(trim("\u{FEFF} a \u{2028}"), "a");
        assert_eq!(trim("\u{85}a"), "\u{85}a");
    }

    #[test]
    fn round_halves_go_up() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-0.4), 0.0);
        assert!(round(f64::NAN).is_nan());
    }

    #[test]
    fn parse_float_reads_the_leading_number() {
        assert_eq!(parse_float("1.2.3"), 1.2);
        assert_eq!(parse_float("1."), 1.0);
        assert_eq!(parse_float(".5"), 0.5);
        assert!(parse_float(".").is_nan());
        assert!(parse_float("..5").is_nan());
    }

    #[test]
    fn every_shared_pattern_compiles() {
        assert!(compile(r"^[{S}]*$").is_some());
        assert!(compile(JS_DOT).is_some());
    }
}
