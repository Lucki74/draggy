//! The JavaScript string rules the CJS code relies on: trim, String() coercion, encodeURIComponent and slice.

use std::borrow::Cow;

use serde_json::Value;

/// `String.prototype.trim`. It strips U+FEFF but keeps U+0085, which Rust's `trim` would do the other way round.
pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

fn is_js_space(ch: char) -> bool {
    matches!(
        ch,
        '\t' | '\u{0B}'
            | '\u{0C}'
            | ' '
            | '\u{A0}'
            | '\u{FEFF}'
            | '\n'
            | '\r'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

/// JavaScript truthiness of a parsed JSON value.
pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(value)` for a parsed JSON value, coerced the way JavaScript does.
pub(crate) fn to_js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number_text(number),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    to_js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `String(value || "")`: a falsy value becomes the empty string.
pub(crate) fn text_or_empty(value: &Value) -> String {
    if truthy(value) {
        to_js_string(value)
    } else {
        String::new()
    }
}

/// `String(number)`. Every number is a double in JavaScript, so integers past 2^53 are rounded before they print.
fn number_text(number: &serde_json::Number) -> String {
    js_number_text(number.as_f64().unwrap_or_default())
}

/// `Number.prototype.toString` for a finite double: the shortest digits that round-trip, laid out the way JavaScript picks.
fn js_number_text(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let exponent: i32 = exponent.parse().unwrap_or_default();
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let point = exponent + 1;
    let body = if count <= point && point <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(point - count).unwrap_or_default())
        )
    } else if 0 < point && point <= 21 {
        let split = usize::try_from(point).unwrap_or_default();
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if -6 < point && point <= 0 {
        format!(
            "0.{}{digits}",
            "0".repeat(usize::try_from(-point).unwrap_or_default())
        )
    } else {
        let shown = if count == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        let power = point - 1;
        let power_sign = if power < 0 { '-' } else { '+' };
        format!("{shown}e{power_sign}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// `encodeURIComponent`: keeps letters, digits and `-_.!~*'()`, and percent-encodes the rest as UTF-8.
pub(crate) fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `text.slice(0, units)` counted in UTF-16 code units. A character split in half keeps its first unit, which a Rust
/// string cannot hold, so that unit becomes U+FFFD and the length still matches. TS quirk: the reference keeps the lone surrogate.
pub(crate) fn utf16_prefix(text: &str, units: usize) -> Cow<'_, str> {
    let mut count = 0;
    for (index, ch) in text.char_indices() {
        let width = ch.len_utf16();
        if count + width > units {
            let mut kept = text[..index].to_owned();
            if count < units {
                kept.push('\u{FFFD}');
            }
            return Cow::Owned(kept);
        }
        count += width;
    }
    Cow::Borrowed(text)
}
