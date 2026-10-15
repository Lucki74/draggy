//! The JavaScript coercions the reference relies on, so JSON values read the way they do in Node.

use serde_json::{Number, Value};

/// `Boolean(value)`, where a missing value counts as falsy.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// `String(value || "")`: a falsy value becomes the empty text.
pub fn text(value: Option<&Value>) -> String {
    if truthy(value) {
        value.map(to_js_string).unwrap_or_default()
    } else {
        String::new()
    }
}

/// `String(value)` for a value that is present. Arrays join with commas, and an object is `[object Object]`.
pub fn to_js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number_text(number),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => to_js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `Number(value)` for JSON input. Anything that does not read as a number is NaN.
pub fn number_of(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => text_number(text),
        Some(_) => f64::NAN,
    }
}

/// The first truthy operand of a `||` chain, or the last one when none is truthy.
pub fn or<'a>(operands: &[Option<&'a Value>]) -> Option<&'a Value> {
    let mut last = None;
    for operand in operands {
        if truthy(*operand) {
            return *operand;
        }
        last = *operand;
    }
    last
}

/// The length of a text in UTF-16 units, which is what the reference counts.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The first `count` UTF-16 units of a text. A cut through a surrogate pair leaves U+FFFD where the reference keeps a lone half.
pub fn utf16_prefix(text: &str, count: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(count).collect();
    String::from_utf16_lossy(&units)
}

fn number_text(number: &Number) -> String {
    match number.as_f64() {
        Some(x) => number_to_string(x),
        None => "NaN".to_owned(),
    }
}

/// `String(x)` for a double: the shortest digits that read back, in exponent form only past 1e21 or below 1e-6.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x == 0.0 {
        return "0".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }

    let sign = if x < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", x.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let count = digits.len() as i32;
    let point = exponent + 1;
    let split = point.max(0) as usize;

    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let shown = if count == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        let e = point - 1;
        let e_sign = if e < 0 { "-" } else { "+" };
        format!("{shown}e{e_sign}{}", e.abs())
    };
    format!("{sign}{body}")
}

/// `JSON.stringify(value)`: keys that are array indices come first in numeric order, and numbers read as JavaScript does.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

fn write_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&number_text(number)),
        Value::String(text) => out.push_str(&quoted(text)),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by_key(|(key, _)| match array_index(key) {
                Some(index) => (0, index),
                None => (1, 0),
            });
            out.push('{');
            for (index, (key, item)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&quoted(key));
                out.push(':');
                write_json(item, out);
            }
            out.push('}');
        }
    }
}

fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default()
}

/// The value of a canonical array index (0 to 2^32 - 2), which JavaScript orders before every other key.
fn array_index(key: &str) -> Option<u64> {
    let canonical = !key.is_empty()
        && key.bytes().all(|byte| byte.is_ascii_digit())
        && (key == "0" || !key.starts_with('0'));
    if !canonical {
        return None;
    }
    key.parse::<u64>()
        .ok()
        .filter(|index| *index <= 4_294_967_294)
}

/// `String.prototype.trim`: JavaScript's whitespace set, which keeps U+0085 and drops the byte-order mark.
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

fn is_js_space(c: char) -> bool {
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

/// `Number(text)` for a string: blank is zero, hex, octal and binary literals read, and only the spelled-out infinities.
fn text_number(text: &str) -> f64 {
    let trimmed = trim(text);
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).map_or(f64::NAN, |value| value as f64);
        }
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E'))
    {
        return trimmed.parse::<f64>().unwrap_or(f64::NAN);
    }
    f64::NAN
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn numbers_read_as_javascript_writes_them() {
        assert_eq!(number_to_string(0.0), "0");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(100.0), "100");
        assert_eq!(number_to_string(123.456), "123.456");
        assert_eq!(number_to_string(0.000001), "0.000001");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(1.5e300), "1.5e+300");
        assert_eq!(number_to_string(1e-7), "1e-7");
        assert_eq!(number_to_string(-2.5e-9), "-2.5e-9");
        assert_eq!(number_to_string(f64::INFINITY), "Infinity");
    }

    #[test]
    fn stringify_puts_index_keys_first_in_numeric_order() {
        let value = json!({"b": 1, "10": 2, "2": 3, "a": {"y": 0, "1": 9}});
        assert_eq!(
            stringify(&value),
            r#"{"2":3,"10":2,"b":1,"a":{"1":9,"y":0}}"#
        );
    }

    #[test]
    fn a_key_past_the_array_index_range_keeps_its_place() {
        // 4294967295 is not an array index, so it is an ordinary key in insertion order.
        let value = json!({"x": 1, "4294967295": 2, "0": 3});
        assert_eq!(stringify(&value), r#"{"0":3,"x":1,"4294967295":2}"#);
    }

    #[test]
    fn a_key_with_a_leading_zero_is_not_an_index() {
        let value = json!({"b": 1, "01": 2, "0": 3});
        assert_eq!(stringify(&value), r#"{"0":3,"b":1,"01":2}"#);
    }

    #[test]
    fn stringify_writes_whole_floats_without_a_point() {
        assert_eq!(stringify(&json!([3.0, 0.5, 1e21])), "[3,0.5,1e+21]");
    }

    #[test]
    fn trim_drops_the_byte_order_mark_and_keeps_next_line() {
        assert_eq!(trim("\u{FEFF} a \u{FEFF}"), "a");
        assert_eq!(trim("\u{0085}a"), "\u{0085}a");
        assert_eq!(trim("\u{3000}\u{A0}a\u{2028}"), "a");
    }
}
