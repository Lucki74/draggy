//! JavaScript behaviours the Electron store relies on, so values read and written match byte for byte.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serializer, de::DeserializeOwned};
use serde_json::{Map, Value};

const MS_PER_DAY: i64 = 86_400_000;

/// `text.slice(0, units)` in JavaScript counts UTF-16 code units; a cut inside a pair keeps U+FFFD.
pub(crate) fn utf16_prefix(text: &str, units: usize) -> String {
    // A UTF-8 byte is never fewer than a UTF-16 unit, so a short text needs no counting.
    if text.len() <= units {
        return text.to_string();
    }
    let kept: Vec<u16> = text.encode_utf16().take(units).collect();
    String::from_utf16_lossy(&kept)
}

/// JavaScript `Number(text)`: blank is zero, `Infinity` and the 0x, 0o and 0b forms parse, and anything else is NaN.
pub(crate) fn number_from_str(text: &str) -> f64 {
    let trimmed = js_trim(text);
    if trimmed.is_empty() {
        return 0.0;
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
            return radix_value(digits, radix);
        }
    }
    let (sign, unsigned) = match trimmed.as_bytes().first() {
        Some(b'-') => (-1.0, &trimmed[1..]),
        Some(b'+') => (1.0, &trimmed[1..]),
        _ => (1.0, trimmed),
    };
    if unsigned == "Infinity" {
        return sign * f64::INFINITY;
    }
    if is_decimal_literal(unsigned) {
        return unsigned
            .parse::<f64>()
            .map_or(f64::NAN, |value| sign * value);
    }
    f64::NAN
}

/// The digits of a 0x, 0o or 0b literal, read as a float. Empty or foreign digits are NaN.
fn radix_value(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    digits
        .chars()
        .try_fold(0.0_f64, |value, digit| {
            digit
                .to_digit(radix)
                .map(|d| value * f64::from(radix) + f64::from(d))
        })
        .unwrap_or(f64::NAN)
}

/// `StrUnsignedDecimalLiteral` without `Infinity`: digits, an optional fraction, then an optional exponent.
fn is_decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut at = 0;
    let mut int_digits = 0;
    while at < bytes.len() && bytes[at].is_ascii_digit() {
        at += 1;
        int_digits += 1;
    }
    let mut frac_digits = 0;
    if at < bytes.len() && bytes[at] == b'.' {
        at += 1;
        while at < bytes.len() && bytes[at].is_ascii_digit() {
            at += 1;
            frac_digits += 1;
        }
    }
    if int_digits + frac_digits == 0 {
        return false;
    }
    if at < bytes.len() && (bytes[at] == b'e' || bytes[at] == b'E') {
        at += 1;
        if at < bytes.len() && (bytes[at] == b'+' || bytes[at] == b'-') {
            at += 1;
        }
        let exp_start = at;
        while at < bytes.len() && bytes[at].is_ascii_digit() {
            at += 1;
        }
        if at == exp_start {
            return false;
        }
    }
    at == bytes.len()
}

/// Trims what JavaScript trims: the white space and line terminators, plus the byte order mark.
pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// JavaScript `Number.prototype.toString()` in base ten: `1`, `1.5`, `1e+21` and `1e-7`, never `1.0`.
pub(crate) fn number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let Some((mantissa, exponent)) = scientific.split_once('e') else {
        return value.to_string();
    };
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    let n = exponent + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(n as usize);
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let exp_sign = if e < 0 { "-" } else { "+" };
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{rest}e{exp_sign}{}", e.abs())
    };
    format!("{sign}{body}")
}

/// SQLite's text for a REAL, which is how a bound JavaScript number is stored in a text column: `%!.15g`,
/// so 5 reads as `5.0`, 1.5 as `1.5` and 1e21 as `1.0e+21`.
pub(crate) fn sqlite_real_text(value: f64) -> String {
    if value.is_infinite() {
        return if value > 0.0 { "Inf" } else { "-Inf" }.to_string();
    }
    if value == 0.0 {
        return if value.is_sign_negative() {
            "-0.0"
        } else {
            "0.0"
        }
        .to_string();
    }
    let scientific = format!("{value:.14e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let text = if (-4..15).contains(&exponent) {
        let decimals = usize::try_from(14 - exponent).unwrap_or(0);
        trim_fraction(&format!("{value:.decimals$}"))
    } else {
        let sign = if exponent < 0 { '-' } else { '+' };
        format!("{}e{sign}{:02}", trim_fraction(mantissa), exponent.abs())
    };
    with_point(text)
}

/// Removes trailing zeros after a decimal point, and the point too when nothing follows it.
fn trim_fraction(text: &str) -> String {
    if !text.contains('.') {
        return text.to_string();
    }
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Adds the `.0` that SQLite's alternate form puts after a whole mantissa, as in `5.0` or `1.0e+21`.
fn with_point(text: String) -> String {
    let (mantissa, rest) = match text.split_once('e') {
        Some((mantissa, exponent)) => (mantissa.to_string(), format!("e{exponent}")),
        None => (text.clone(), String::new()),
    };
    if mantissa.contains('.') {
        text
    } else {
        format!("{mantissa}.0{rest}")
    }
}

/// JavaScript `Number` as a JSON value: a whole number within range is written as an integer, as JSON.stringify does.
pub(crate) fn js_number(value: f64) -> Value {
    match whole_i64(value) {
        Some(whole) => Value::from(whole),
        None => serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number),
    }
}

fn whole_i64(value: f64) -> Option<i64> {
    // Two to the fifty-third: every whole number below it is exact as a float.
    const EXACT: f64 = 9_007_199_254_740_992.0;
    (value.is_finite() && value.fract() == 0.0 && value.abs() < EXACT).then_some(value as i64)
}

/// Writes a timestamp or count the way the reference reads it back: whole numbers without a fraction.
pub(crate) fn ser_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    match whole_i64(*value) {
        Some(whole) => serializer.serialize_i64(whole),
        None => serializer.serialize_f64(*value),
    }
}

/// `ser_number` for a value that may be absent: none is written as null.
pub(crate) fn ser_optional_number<S: Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(number) => ser_number(number, serializer),
        None => serializer.serialize_none(),
    }
}

/// Text the way `String(value || "")` writes it, for a field that may be absent.
pub(crate) fn text_or_empty(value: Option<&Value>) -> String {
    match value {
        Some(value) if is_truthy(value) => js_text(value),
        _ => String::new(),
    }
}

/// A flag the way JavaScript reads it: any truthy value is true, so `1` and `"yes"` count.
pub(crate) fn de_flag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Value::deserialize(deserializer).map(|value| is_truthy(&value))
}

/// A list the way `Array.isArray(value) ? value : []` reads it: anything that is not an array is empty.
pub(crate) fn de_items<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Value>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(items) => items,
        _ => Vec::new(),
    })
}

/// JavaScript `String(value)` for a stored or sent JSON value, as `Array.prototype.join` writes its items.
pub(crate) fn js_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.as_f64().map_or_else(String::new, number_text),
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(js_text).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JavaScript `Number(value)` for a JSON value: null is zero, text is parsed, and an object is NaN.
pub(crate) fn to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => number_from_str(text),
        Value::Array(_) | Value::Object(_) => number_from_str(&js_text(value)),
    }
}

/// The store's `measure`: a finite number above zero, otherwise zero.
pub(crate) fn measure(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

/// JavaScript truthiness for a JSON value, which decides whether a stored field is written at all.
pub(crate) fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `JSON.parse` for a stored column: only an object or an array counts; anything else is None.
pub(crate) fn parse_json(text: Option<&str>) -> Option<Value> {
    let text = text.filter(|text| !text.is_empty())?;
    parse_any::<Value>(text)
        .ok()
        .filter(|value| value.is_object() || value.is_array())
}

/// Parses JSON without serde_json's depth limit: JSON.parse accepts payloads nested far past 128 levels, and so
/// must the reader. serde_stacker grows the stack as the nesting deepens, so a deep payload cannot overflow it.
pub(crate) fn parse_any<T: DeserializeOwned>(text: &str) -> Result<T, serde_json::Error> {
    let mut json = serde_json::Deserializer::from_str(text);
    json.disable_recursion_limit();
    let value = T::deserialize(serde_stacker::Deserializer::new(&mut json))?;
    json.end()?;
    Ok(value)
}

/// The keys of an object in the order JavaScript lists them: array-index keys ascending, then the rest as stored.
pub(crate) fn key_order(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut indexed: Vec<(u32, (&String, &Value))> = Vec::new();
    let mut named = Vec::new();
    for (key, value) in map {
        match array_index(key) {
            Some(index) => indexed.push((index, (key, value))),
            None => named.push((key, value)),
        }
    }
    indexed.sort_by_key(|(index, _)| *index);
    indexed
        .into_iter()
        .map(|(_, entry)| entry)
        .chain(named)
        .collect()
}

/// A canonical array index: digits with no leading zero, below 2^32 - 1.
fn array_index(key: &str) -> Option<u32> {
    let canonical = !key.is_empty()
        && key.bytes().all(|byte| byte.is_ascii_digit())
        && (key == "0" || !key.starts_with('0'));
    if !canonical {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index < u32::MAX)
}

/// Reads a JSON number the way `Number(value)` does, for fields the store measures.
pub(crate) fn de_number<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    Value::deserialize(deserializer).map(|value| to_number(&value))
}

/// Like `de_number` for a field that may be absent: a present value is always a number, even when it is NaN.
pub(crate) fn de_optional_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    Value::deserialize(deserializer).map(|value| Some(to_number(&value)))
}

/// Text the way `String(value || "")` writes it: a falsy value is empty.
pub(crate) fn de_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Value::deserialize(deserializer).map(|value| {
        if is_truthy(&value) {
            js_text(&value)
        } else {
            String::new()
        }
    })
}

/// Text the way `value ? String(value) : null` writes it: a falsy value is absent.
pub(crate) fn de_optional_text<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Value::deserialize(deserializer).map(|value| is_truthy(&value).then(|| js_text(&value)))
}

/// A tool-count map as `Object.entries` reads it: an object's entries, an array's indexes, and nothing else.
pub(crate) fn de_entries<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Map<String, Value>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Object(map) => map,
        Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item))
            .collect(),
        _ => Map::new(),
    })
}

/// `Date.now()`: milliseconds since the Unix epoch.
pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// `new Date(millis).toISOString()`, for example `2026-10-12T09:00:00.000Z`.
pub(crate) fn iso_timestamp(millis: i64) -> String {
    let days = millis.div_euclid(MS_PER_DAY);
    let within = millis.rem_euclid(MS_PER_DAY);
    let (year, month, day) = civil_from_days(days);
    let hours = within / 3_600_000;
    let minutes = within % 3_600_000 / 60_000;
    let seconds = within % 60_000 / 1_000;
    let fraction = within % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{fraction:03}Z")
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day), after Howard Hinnant's algorithm.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_by_utf16_units_like_slice() {
        assert_eq!(utf16_prefix("abcdef", 4), "abcd");
        assert_eq!(utf16_prefix("😀😀", 2), "😀");
        assert_eq!(utf16_prefix("😀😀", 1), "\u{FFFD}");
    }

    #[test]
    fn formats_like_to_iso_string() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_760_263_200_123), "2025-10-12T10:00:00.123Z");
    }

    #[test]
    fn writes_numbers_the_way_javascript_does() {
        assert_eq!(number_text(1.0), "1");
        assert_eq!(number_text(-0.0), "0");
        assert_eq!(number_text(1.5), "1.5");
        assert_eq!(number_text(1e20), "100000000000000000000");
        assert_eq!(number_text(1e21), "1e+21");
        assert_eq!(number_text(0.000001), "0.000001");
        assert_eq!(number_text(1e-7), "1e-7");
        assert_eq!(number_text(-2.5e-8), "-2.5e-8");
    }

    #[test]
    fn reads_text_numbers_the_way_javascript_does() {
        assert_eq!(number_from_str(""), 0.0);
        assert_eq!(number_from_str(" 7 "), 7.0);
        assert_eq!(number_from_str("1e3"), 1000.0);
        assert_eq!(number_from_str("0x10"), 16.0);
        assert_eq!(number_from_str("0o17"), 15.0);
        assert_eq!(number_from_str("0b101"), 5.0);
        assert_eq!(number_from_str("-Infinity"), f64::NEG_INFINITY);
        for text in ["inf", "infinity", "nan", "0x", "1e", "+-1", "1_000"] {
            assert!(number_from_str(text).is_nan(), "{text} should read as NaN");
        }
    }

    #[test]
    fn to_number_reads_each_json_value_as_javascript_does() {
        assert_eq!(to_number(&Value::Null), 0.0);
        assert_eq!(to_number(&Value::Bool(true)), 1.0);
        assert_eq!(to_number(&serde_json::json!([7])), 7.0);
        assert!(to_number(&serde_json::json!({})).is_nan());
    }

    #[test]
    fn lists_index_keys_first_in_javascript_order() {
        let mut map = Map::new();
        for key in ["b", "10", "a", "2", "4294967295", "01"] {
            map.insert(key.to_string(), Value::Null);
        }
        let keys: Vec<&str> = key_order(&map)
            .into_iter()
            .map(|(key, _)| key.as_str())
            .collect();
        assert_eq!(keys, ["2", "10", "b", "a", "4294967295", "01"]);
    }

    #[test]
    fn measures_only_positive_finite_numbers() {
        assert_eq!(measure(-1.0), 0.0);
        assert_eq!(measure(f64::NAN), 0.0);
        assert_eq!(measure(2.5), 2.5);
    }
}
