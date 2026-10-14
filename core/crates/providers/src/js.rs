//! The JavaScript coercions the reference relies on, so truthiness, `Number()` and `String()` read the same here.

use serde_json::Value;

/// JavaScript truthiness of a JSON value. An absent value is falsy, as `undefined` is.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `Number(value)`, with NaN where JavaScript gives NaN.
pub fn number(value: Option<&Value>) -> f64 {
    match value {
        None | Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => string_number(text.trim()),
        Some(_) => f64::NAN,
    }
}

/// `Number(text)` for a string already trimmed: hex, octal and binary integers, the signed Infinity, and decimal only.
fn string_number(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if let Some(digits) = text
            .get(..2)
            .filter(|p| p.eq_ignore_ascii_case(prefix))
            .and(text.get(2..))
        {
            return radix_number(digits, radix);
        }
    }
    match text {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        _ if is_decimal_literal(text) => text.parse::<f64>().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

/// An unsigned integer in the given radix, or NaN when any digit is not one of it.
fn radix_number(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
        return f64::NAN;
    }
    digits.chars().fold(0.0, |acc, c| {
        acc * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
    })
}

/// JavaScript's StrDecimalLiteral: an optional sign, digits with an optional point, and an optional exponent.
fn is_decimal_literal(text: &str) -> bool {
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    let mantissa_ok =
        (!whole.is_empty() || !fraction.is_empty()) && digits(whole) && digits(fraction);
    let exponent_ok = exponent.is_none_or(|e| {
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        !e.is_empty() && digits(e)
    });
    mantissa_ok && exponent_ok
}

/// `Number(value) || null` for a count: zero, NaN and an absent value all give None.
pub fn count_or_none(value: Option<&Value>) -> Option<u64> {
    let n = number(value);
    if n.is_finite() && n > 0.0 {
        Some(n as u64)
    } else {
        None
    }
}

/// `String(value)`, for the values a provider's listing or message may carry.
pub fn to_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(n) => number_text(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    to_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// A JavaScript number as text: whole numbers without a fraction, the rest in their shortest form.
pub fn number_text(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_owned()
    } else if n.is_infinite() {
        if n > 0.0 {
            "Infinity".to_owned()
        } else {
            "-Infinity".to_owned()
        }
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

/// `JSON.stringify(value)`. Object keys keep their insertion order, as the reference's do.
pub fn json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// `encodeURIComponent`: every byte outside the unreserved set becomes a percent escape.
pub fn encode_uri_component(text: &str) -> String {
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

/// `Number(x.toFixed(1))`: rounded to one decimal, a tie going to the larger value as JavaScript rounds it.
pub fn fixed_one(value: f64) -> f64 {
    if !value.is_finite() || value.abs() >= 1e21 {
        return value;
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // Sixty digits show the double's exact value closely enough to tell a tie from a near-tie.
    let text = format!("{:.60}", value.abs());
    let (whole, fraction) = text.split_once('.').unwrap_or((text.as_str(), ""));
    let mut digits: Vec<u8> = whole.bytes().map(|b| b - b'0').collect();
    digits.push(fraction.bytes().next().map_or(0, |b| b - b'0'));
    if fraction.as_bytes().get(1).is_some_and(|&b| b >= b'5') {
        let mut at = digits.len();
        loop {
            if at == 0 {
                digits.insert(0, 1);
                break;
            }
            at -= 1;
            if digits[at] == 9 {
                digits[at] = 0;
            } else {
                digits[at] += 1;
                break;
            }
        }
    }
    let tenth = digits.pop().unwrap_or(0);
    let whole: String = digits.iter().map(|d| char::from(b'0' + d)).collect();
    format!("{sign}{whole}.{tenth}")
        .parse::<f64>()
        .unwrap_or(value)
}

/// `text.slice(0, max)` counted in UTF-16 units, as the reference cuts its messages.
pub fn slice_units(text: &str, max: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() <= max {
        return text.to_owned();
    }
    String::from_utf16_lossy(&units[..max])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{fixed_one, number};

    /// Each row is `Number(text)` as Node gives it for the trimmed text.
    #[test]
    fn number_reads_a_string_as_javascript_does() {
        let rows = [
            ("", 0.0),
            ("0x1A", 26.0),
            ("0X1a", 26.0),
            ("0o17", 15.0),
            ("0b101", 5.0),
            ("0x", f64::NAN),
            ("-0x1A", f64::NAN),
            ("1e3", 1000.0),
            ("1.", 1.0),
            (".5", 0.5),
            ("inf", f64::NAN),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
            ("+Infinity", f64::INFINITY),
            ("infinity", f64::NAN),
            ("NaN", f64::NAN),
            ("12px", f64::NAN),
            ("1_000", f64::NAN),
            ("+7", 7.0),
            ("-2.5e-3", -0.0025),
            ("0x1g", f64::NAN),
        ];
        for (text, expected) in rows {
            let actual = number(Some(&json!(text)));
            assert!(
                actual == expected || (actual.is_nan() && expected.is_nan()),
                "Number({text:?}) = {actual}, expected {expected}"
            );
        }
        assert_eq!(number(Some(&json!(" 42 "))), 42.0);
    }

    /// Each row is `Number(((completed / total) * 100).toFixed(1))` as Node gives it.
    #[test]
    fn fixed_one_rounds_the_percent_as_javascript_does() {
        let rows = [
            (1.0 / 3.0 * 100.0, 33.3),
            (1.0 / 8.0 * 100.0, 12.5),
            (1.0 / 16.0 * 100.0, 6.3),
            (1.0 / 40.0 * 100.0, 2.5),
            (3.0 / 7.0 * 100.0, 42.9),
            (5.0 / 1000.0 * 100.0, 0.5),
            (999.0 / 1000.0 * 100.0, 99.9),
            (1.0 / 80.0 * 100.0, 1.3),
            (123456.0 / 1000000.0 * 100.0, 12.3),
            (1.0 / 3000.0 * 100.0, 0.0),
            (2.0 / 3.0 * 100.0, 66.7),
            (7.0 / 9.0 * 100.0, 77.8),
            (1.0 / 400.0 * 100.0, 0.3),
            (19.0 / 80.0 * 100.0, 23.8),
            (50.0, 50.0),
            (0.25, 0.3),
            (0.35, 0.3),
            (2.25, 2.3),
            (0.05, 0.1),
            (1.45, 1.4),
            (99.95, 100.0),
            (33.35, 33.4),
            (66.65, 66.7),
            (12.5, 12.5),
        ];
        for (value, expected) in rows {
            assert_eq!(fixed_one(value), expected, "toFixed(1) of {value}");
        }
    }
}
