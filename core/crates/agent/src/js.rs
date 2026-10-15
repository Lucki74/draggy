//! JavaScript string rules the TypeScript reference relies on: `\s` and `trim`, UTF-16 lengths, and regular
//! expressions with JavaScript's flags, translated to `fancy-regex` so lookaround and backreferences work.

use std::fmt::Write as _;
use std::sync::OnceLock;

use crate::AgentError;

/// JavaScript's `\s` set: WhiteSpace and LineTerminator. Rust's `char::is_whitespace` differs (it has U+0085, not U+FEFF).
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
pub fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// `String.prototype.trimStart`.
pub fn trim_start_js(text: &str) -> &str {
    text.trim_start_matches(is_js_space)
}

/// `String.prototype.trimEnd`.
pub fn trim_end_js(text: &str) -> &str {
    text.trim_end_matches(is_js_space)
}

/// The length JavaScript reports for a string: UTF-16 code units.
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// The last `units` UTF-16 code units of `text`. A surrogate pair cut by the window is left out, which is
/// safe for ASCII matching: the JavaScript slice keeps only a lone low surrogate there, and no ASCII match includes it.
pub fn utf16_suffix(text: &str, units: usize) -> &str {
    let mut used = 0;
    let mut start = text.len();
    for (index, c) in text.char_indices().rev() {
        let width = c.len_utf16();
        if used + width > units {
            break;
        }
        used += width;
        start = index;
    }
    &text[start..]
}

/// JavaScript's `Canonicalize` for a non-Unicode case-insensitive match: ASCII folds, other letters fold only when
/// their uppercase stays out of ASCII.
fn js_canonical(c: char) -> char {
    if c.is_ascii() {
        return c.to_ascii_uppercase();
    }
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(u), None) if u.len_utf16() == 1 && !u.is_ascii() => u,
        _ => c,
    }
}

/// Matches `needle` at byte `at` of `text`, comparing characters the way JavaScript's `i` flag does without `u`.
/// Returns the byte index just past the match.
pub fn match_js_ci(text: &str, at: usize, needle: &str) -> Option<usize> {
    let mut rest = text.get(at..)?.char_indices();
    let mut end = at;
    for expected in needle.chars() {
        let (offset, actual) = rest.next()?;
        if js_canonical(actual) != js_canonical(expected) {
            return None;
        }
        end = at + offset + actual.len_utf8();
    }
    Some(end)
}

/// Escapes `text` for use as a literal inside a JavaScript regular expression source.
pub fn escape_js_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(
            c,
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// How the `i` flag behaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaseFold {
    /// No `i` flag.
    Off,
    /// `i` without `u`: ASCII letters fold to each other, so each letter is written as a two-letter class. A non-ASCII
    /// letter lists its case forms outside a class; inside one it is refused, since the forms cannot be spelled out there.
    AsciiOnly,
    /// `i` with `u`: Unicode simple case folding, which is what `fancy-regex` does.
    Unicode,
}

/// The flags a JavaScript regex is compiled with. `g` is the caller's choice of `find_all` or `find`.
#[derive(Debug, Clone, Copy)]
pub struct Flags {
    pub case: CaseFold,
    /// The `s` flag: `.` also matches line terminators.
    pub dot_all: bool,
}

/// `\s` as a class body, JavaScript's whitespace set.
const SPACE_BODY: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// The characters `fancy-regex` treats as syntax, so they need a backslash to be literal.
const REGEX_META: &str = ".+*?()|[]{}^$#&-~\\";

/// JavaScript's `[\s\S]`, which matches any character; written as `(?s:.)` for `fancy-regex`.
const ANY_CHAR_CLASS: [char; 6] = ['[', '\\', 's', '\\', 'S', ']'];

/// A JavaScript regular expression, compiled once.
#[derive(Debug)]
pub struct JsRegex {
    regex: fancy_regex::Regex,
}

impl JsRegex {
    /// Compiles JavaScript regex source with the given flags. Fails on syntax this translation does not cover.
    pub fn new(source: &str, flags: Flags) -> Result<Self, AgentError> {
        let translated = translate(source, flags)?;
        let regex = fancy_regex::Regex::new(&translated)?;
        Ok(Self { regex })
    }

    /// `RegExp.prototype.test`. A matching error is logged and reads as no match.
    pub fn is_match(&self, text: &str) -> bool {
        match self.regex.is_match(text) {
            Ok(found) => found,
            Err(error) => {
                tracing::warn!(target: "agent.regex", error = %error, "match failed");
                false
            }
        }
    }

    /// The first match as byte offsets, like `String.prototype.match` without captures.
    pub fn find(&self, text: &str) -> Option<(usize, usize)> {
        match self.regex.find(text) {
            Ok(found) => found.map(|m| (m.start(), m.end())),
            Err(error) => {
                tracing::warn!(target: "agent.regex", error = %error, "find failed");
                None
            }
        }
    }

    /// The first match with its groups, where group 0 is the whole match. Unmatched groups are `None`.
    pub fn captures<'t>(&self, text: &'t str) -> Option<Vec<Option<&'t str>>> {
        match self.regex.captures(text) {
            Ok(found) => found.map(|caps| {
                (0..caps.len())
                    .map(|i| caps.get(i).map(|m| m.as_str()))
                    .collect()
            }),
            Err(error) => {
                tracing::warn!(target: "agent.regex", error = %error, "captures failed");
                None
            }
        }
    }

    /// Every non-overlapping match as byte offsets, like the `g` flag.
    pub fn find_all(&self, text: &str) -> Vec<(usize, usize)> {
        let mut spans = Vec::new();
        for found in self.regex.find_iter(text) {
            match found {
                Ok(m) => spans.push((m.start(), m.end())),
                Err(error) => {
                    tracing::warn!(target: "agent.regex", error = %error, "find_iter failed");
                    break;
                }
            }
        }
        spans
    }

    /// `String.prototype.replace` with the `g` flag and a literal replacement.
    pub fn replace_all(&self, text: &str, with: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for (start, end) in self.find_all(text) {
            out.push_str(&text[last..start]);
            out.push_str(with);
            last = end;
        }
        out.push_str(&text[last..]);
        out
    }
}

/// A built-in pattern, compiled on first use and kept for the process. A pattern that fails to compile is logged
/// once and never matches; the fixtures compile every built-in pattern, so this does not happen in a build that passes.
pub fn cached(
    cell: &'static OnceLock<Option<JsRegex>>,
    source: &str,
    flags: Flags,
) -> Option<&'static JsRegex> {
    cell.get_or_init(|| match JsRegex::new(source, flags) {
        Ok(regex) => Some(regex),
        Err(error) => {
            tracing::error!(target: "agent.regex", error = %error, "built-in pattern did not compile");
            None
        }
    })
    .as_ref()
}

/// Rewrites JavaScript regex syntax into `fancy-regex` syntax with the same matches.
fn translate(source: &str, flags: Flags) -> Result<String, AgentError> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len() + 16);
    if flags.case == CaseFold::Unicode {
        out.push_str("(?i)");
    }

    let mut in_class = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        match c {
            '\\' => {
                let next = *chars
                    .get(i)
                    .ok_or_else(|| unsupported(source, "trailing backslash"))?;
                i += 1;
                translate_escape(source, &chars, &mut i, next, in_class, &mut out)?;
            }
            '[' if in_class => out.push_str("\\["),
            '[' => {
                if chars[i - 1..].starts_with(&ANY_CHAR_CLASS) {
                    out.push_str("(?s:.)");
                    i += ANY_CHAR_CLASS.len() - 1;
                } else {
                    in_class = true;
                    out.push('[');
                    if chars.get(i) == Some(&'^') {
                        out.push('^');
                        i += 1;
                    }
                }
            }
            ']' => {
                in_class = false;
                out.push(']');
            }
            '.' if in_class => out.push('.'),
            '.' if flags.dot_all => out.push_str("(?s:.)"),
            '.' => out.push_str("[^\\n\\r\\x{2028}\\x{2029}]"),
            '&' | '~' if in_class => {
                out.push('\\');
                out.push(c);
            }
            c if in_class
                && c.is_ascii()
                && flags.case == CaseFold::AsciiOnly
                && !matches!(c, '\\' | ']' | '[') =>
            {
                fold_class_item(&chars, &mut i, c, &mut out);
            }
            c if c.is_ascii_alphabetic() && !in_class && flags.case == CaseFold::AsciiOnly => {
                let _ = write!(
                    out,
                    "[{}{}]",
                    c.to_ascii_lowercase(),
                    c.to_ascii_uppercase()
                );
            }
            c if !c.is_ascii() && flags.case == CaseFold::AsciiOnly => {
                let variants = case_variants(c);
                if variants.len() == 1 {
                    out.push(c);
                } else if in_class {
                    return Err(unsupported(
                        source,
                        "non-ASCII letter in a class under the i flag",
                    ));
                } else {
                    out.push('[');
                    out.extend(variants);
                    out.push(']');
                }
            }
            c => out.push(c),
        }
    }
    Ok(out)
}

/// A class item under `i` without `u`, which folds ASCII letters only: `c` alone, or a range `c-end` when a literal
/// end follows. The letters it covers also match their other case, so `[a-c]` also matches `B`.
fn fold_class_item(chars: &[char], i: &mut usize, c: char, out: &mut String) {
    let end = match (chars.get(*i), chars.get(*i + 1)) {
        (Some('-'), Some(&end)) if !matches!(end, ']' | '\\' | '[' | '&' | '~') => {
            *i += 2;
            end
        }
        _ => c,
    };
    out.push(c);
    if end != c {
        out.push('-');
        out.push(end);
    }
    push_other_case(out, c, end);
}

/// The characters the `i` flag without `u` treats as equal to a non-ASCII `c`: `c` and its single-character lower and
/// upper forms that canonicalise the same. A letter with several lower-case forms, such as sigma, is not fully covered.
fn case_variants(c: char) -> Vec<char> {
    let canonical = js_canonical(c);
    let lower = single_char(c.to_lowercase());
    let upper = single_char(c.to_uppercase());
    let upper_of_lower = lower.and_then(|l| single_char(l.to_uppercase()));
    let mut variants = vec![c];
    for candidate in [lower, upper, upper_of_lower].into_iter().flatten() {
        if !variants.contains(&candidate) && js_canonical(candidate) == canonical {
            variants.push(candidate);
        }
    }
    variants
}

fn single_char(mut chars: impl Iterator<Item = char>) -> Option<char> {
    let first = chars.next()?;
    chars.next().is_none().then_some(first)
}

/// Writes the other-case partners of the ASCII letters in `lo..=hi`, as letter ranges that need no escaping.
fn push_other_case(out: &mut String, lo: char, hi: char) {
    let (lo, hi) = (u32::from(lo), u32::from(hi));
    let upper = lo.max(u32::from('A'))..=hi.min(u32::from('Z'));
    let lower = lo.max(u32::from('a'))..=hi.min(u32::from('z'));
    if !upper.is_empty() {
        push_letters(out, upper.start() + 32, upper.end() + 32);
    }
    if !lower.is_empty() {
        push_letters(out, lower.start() - 32, lower.end() - 32);
    }
}

fn push_letters(out: &mut String, from: u32, to: u32) {
    if let (Some(first), Some(last)) = (char::from_u32(from), char::from_u32(to)) {
        out.push(first);
        if first != last {
            out.push('-');
            out.push(last);
        }
    }
}

/// One escape after a backslash. `next` is already consumed; `i` points past it.
fn translate_escape(
    source: &str,
    chars: &[char],
    i: &mut usize,
    next: char,
    in_class: bool,
    out: &mut String,
) -> Result<(), AgentError> {
    match next {
        's' if in_class => out.push_str(SPACE_BODY),
        's' => {
            out.push('[');
            out.push_str(SPACE_BODY);
            out.push(']');
        }
        'd' if in_class => out.push_str("0-9"),
        'd' => out.push_str("[0-9]"),
        'n' | 'r' | 't' | 'f' => {
            out.push('\\');
            out.push(next);
        }
        '/' => out.push('/'),
        'u' => {
            let hex: String = chars.get(*i..*i + 4).unwrap_or_default().iter().collect();
            if hex.len() != 4 || !hex.chars().all(|h| h.is_ascii_hexdigit()) {
                return Err(unsupported(source, "\\u needs four hex digits"));
            }
            *i += 4;
            let _ = write!(out, "\\x{{{hex}}}");
        }
        'p' | 'P' if chars.get(*i) == Some(&'{') => {
            let close = chars[*i..]
                .iter()
                .position(|&c| c == '}')
                .ok_or_else(|| unsupported(source, "unclosed \\p{"))?;
            let name: String = chars[*i..*i + close + 1].iter().collect();
            *i += close + 1;
            out.push('\\');
            out.push(next);
            out.push_str(&name);
        }
        c if c.is_ascii_punctuation() && REGEX_META.contains(c) => {
            out.push('\\');
            out.push(c);
        }
        c if c.is_ascii_punctuation() => out.push(c),
        _ => {
            return Err(unsupported(
                source,
                "escape not covered by the JavaScript translation",
            ));
        }
    }
    Ok(())
}

fn unsupported(source: &str, reason: &str) -> AgentError {
    AgentError::Unsupported {
        pattern: source.to_string(),
        reason: reason.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASCII: Flags = Flags {
        case: CaseFold::AsciiOnly,
        dot_all: false,
    };

    #[test]
    fn a_surrogate_pair_cut_by_the_window_is_left_out() {
        assert_eq!(utf16_suffix("a🙂b", 3), "🙂b");
        assert_eq!(utf16_suffix("a🙂b", 2), "b");
    }

    #[test]
    fn ascii_folding_does_not_fold_the_kelvin_sign_or_the_long_s() {
        assert_eq!(match_js_ci("\u{212A}", 0, "k"), None);
        assert_eq!(match_js_ci("\u{17F}", 0, "s"), None);
        assert_eq!(match_js_ci("K", 0, "k"), Some(1));
    }

    #[test]
    fn js_whitespace_differs_from_rust_whitespace() {
        assert!(is_js_space('\u{FEFF}'));
        assert!(!is_js_space('\u{85}'));
        assert_eq!(trim_js("\u{FEFF}x\u{A0}"), "x");
    }

    #[test]
    fn letters_inside_a_class_match_their_other_case_under_ascii_folding() {
        let whole = JsRegex::new("^[a-z]$", ASCII).expect("pattern compiles");
        assert!(whole.is_match("A"));
        assert!(whole.is_match("q"));
        let lower = JsRegex::new("^[b-c]$", ASCII).expect("pattern compiles");
        assert!(lower.is_match("B") && lower.is_match("C"));
        assert!(!lower.is_match("d"));
        let kelvin = JsRegex::new("^[k]$", ASCII).expect("pattern compiles");
        assert!(!kelvin.is_match("\u{212A}"));
        assert!(kelvin.is_match("K"));
    }

    #[test]
    fn non_ascii_letters_fold_through_their_case_forms_only() {
        let accented = JsRegex::new("^ä$", ASCII).expect("pattern compiles");
        assert!(accented.is_match("Ä") && accented.is_match("ä"));
        let long_s = JsRegex::new("^s$", ASCII).expect("pattern compiles");
        assert!(!long_s.is_match("\u{17F}"));
        assert!(JsRegex::new("[ä]", ASCII).is_err());
        assert!(JsRegex::new("[à-ö]", ASCII).is_err());
    }

    #[test]
    fn ascii_folding_spells_out_letters_and_leaves_the_rest_literal() {
        let regex = JsRegex::new("ab", ASCII).expect("pattern compiles");
        assert!(regex.is_match("AB"));
        assert!(!regex.is_match("\u{212A}b"));
    }

    #[test]
    fn syntax_outside_the_translation_is_an_error() {
        let flags = Flags {
            case: CaseFold::Off,
            dot_all: false,
        };
        assert!(JsRegex::new(r"\w+", flags).is_err());
    }

    #[test]
    fn replace_all_keeps_the_text_between_matches() {
        let regex = JsRegex::new(
            r"\d+",
            Flags {
                case: CaseFold::Off,
                dot_all: false,
            },
        )
        .expect("pattern compiles");
        assert_eq!(regex.replace_all("a1b22c", "#"), "a#b#c");
    }
}
