//! XML text helpers for Office parts. Office writes a small, regular subset of XML, so patterns are enough.

use std::sync::LazyLock;

use regex::Regex;

use crate::office_error::OfficeError;

static NUMERIC_ENTITY: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"&#([0-9]+);").ok());

/// Decodes the entities Office emits. The order matters: `&amp;` goes last, so `&amp;lt;` stays `&lt;`.
pub fn decode_xml_entities(value: &str) -> String {
    let named = value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    let mut pieces = Vec::new();
    let mut last = 0;
    if let Some(regex) = NUMERIC_ENTITY.as_ref() {
        for caps in regex.captures_iter(&named) {
            let Some(whole) = caps.get(0) else { continue };
            if whole.start() > last {
                pieces.push(Piece::Text(&named[last..whole.start()]));
            }
            pieces.push(Piece::Unit(code_unit(
                caps.get(1).map_or("0", |m| m.as_str()),
            )));
            last = whole.end();
        }
    }
    if last < named.len() {
        pieces.push(Piece::Text(&named[last..]));
    }
    join_pieces(&pieces).replace("&amp;", "&")
}

/// Decoded text or a UTF-16 code unit from a numeric entity, kept apart until the units are joined.
enum Piece<'a> {
    Text(&'a str),
    Unit(u16),
}

/// Joins the pieces into a string. A high surrogate entity followed by a low one is one character, as in JavaScript;
/// a lone surrogate cannot be held in a Rust string and becomes U+FFFD. // TS quirk: the reference keeps it.
fn join_pieces(pieces: &[Piece<'_>]) -> String {
    let mut out = String::new();
    let mut index = 0;
    while index < pieces.len() {
        match &pieces[index] {
            Piece::Text(text) => out.push_str(text),
            Piece::Unit(high) if (0xD800..0xDC00).contains(high) => {
                if let Some(Piece::Unit(low)) = pieces.get(index + 1)
                    && (0xDC00..0xE000).contains(low)
                {
                    let code =
                        0x10000 + ((u32::from(*high) - 0xD800) << 10) + (u32::from(*low) - 0xDC00);
                    out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                    index += 2;
                    continue;
                }
                out.push('\u{FFFD}');
            }
            Piece::Unit(unit) => out.push(char::from_u32(u32::from(*unit)).unwrap_or('\u{FFFD}')),
        }
        index += 1;
    }
    out
}

/// A numeric entity's value as JavaScript's `fromCharCode` keeps it: the low 16 bits, so a larger number wraps.
fn code_unit(digits: &str) -> u16 {
    let value = digits.parse::<f64>().unwrap_or(0.0);
    value.trunc().rem_euclid(65536.0) as u16
}

/// The text of every `text_tag` element in order, with `break_tag` standing for a line break.
pub fn xml_to_text(xml: &str, text_tag: &str, break_tag: &str) -> Result<String, OfficeError> {
    let pattern = format!(
        r"<{tag}(?:\s[^>]*)?>([\s\S]*?)</{tag}>|{brk}",
        tag = regex::escape(text_tag),
        brk = regex::escape(break_tag),
    );
    let regex = Regex::new(&pattern).map_err(|error| OfficeError::Corrupt(error.to_string()))?;
    let mut text = String::new();
    for found in regex.captures_iter(xml) {
        match found.get(1) {
            Some(raw) => text.push_str(&decode_xml_entities(raw.as_str())),
            None => text.push('\n'),
        }
    }
    Ok(text)
}

/// Escapes text for an XML element or attribute value.
pub fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}
