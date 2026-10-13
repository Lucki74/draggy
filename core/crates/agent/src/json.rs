//! JSON as JavaScript reads and writes it, for the tool-call text a model produces. Numbers are JavaScript doubles, so
//! `1.0` reads as `1` and `1e2` as `100`. Keys keep JavaScript's order, and numbers are written the way it writes them.

use std::fmt::Write as _;

use serde_json::{Map, Number, Value};

/// Deepest nesting `parse` accepts. Deeper text reads as invalid, where JavaScript would still parse it.
const MAX_DEPTH: usize = 512;
/// 2^63 and 2^64: the bounds of the integers a `Value` holds as `i64` and `u64`.
const I64_LIMIT: f64 = 9_223_372_036_854_775_808.0;
const U64_LIMIT: f64 = 18_446_744_073_709_551_616.0;
/// The largest array index, 2^32 - 2. Object keys up to it are listed first, in ascending order.
const MAX_ARRAY_INDEX: u64 = 4_294_967_294;

/// `JSON.parse`. `None` where JavaScript throws. Numbers read as doubles, so an out-of-range number reads as `null`,
/// which is what `JSON.stringify` writes for Infinity. A lone surrogate escape reads as U+FFFD: a Rust string cannot hold one.
pub fn parse(text: &str) -> Option<Value> {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        pos: 0,
    };
    let value = parser.value(0)?;
    parser.skip_space();
    (parser.pos == parser.bytes.len()).then_some(value)
}

/// `JSON.stringify` with no indentation: integer-like keys first and ascending, the rest in insertion order.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

/// The value with every number read as a JavaScript double, so two values compare as JavaScript would compare them.
pub fn canonical(value: &Value) -> Value {
    match value {
        Value::Number(number) => number.as_f64().map_or(Value::Null, number_value),
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), canonical(item)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// The `Value` a JavaScript number reads as: an integer when it is a whole number a Rust integer holds, else a float.
/// Infinity cannot be held and reads as `null`.
fn number_value(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0.0 {
        if (-I64_LIMIT..I64_LIMIT).contains(&x) {
            return Value::from(x as i64);
        }
        if (0.0..U64_LIMIT).contains(&x) {
            return Value::from(x as u64);
        }
    }
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// `Number.prototype.toString` for a finite double, or `null` for the rest, as `JSON.stringify` writes them.
fn js_number(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_string();
    }
    if x == 0.0 {
        return "0".to_string();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // The shortest digits that round-trip. Where the exact value sits halfway between two of them, JavaScript takes
    // the even one, which the correctly rounded digits of the same length give.
    let shortest = format!("{:e}", x.abs());
    let width = shortest.split('e').next().map_or(0, |mantissa| {
        mantissa.bytes().filter(u8::is_ascii_digit).count()
    });
    let rounded = format!("{:.*e}", width.saturating_sub(1), x.abs());
    let scientific = if rounded.parse::<f64>() == Ok(x.abs()) {
        rounded
    } else {
        shortest
    };
    let Some((mantissa, exponent)) = scientific.split_once('e') else {
        return "null".to_string();
    };
    let Ok(exponent) = exponent.parse::<i32>() else {
        return "null".to_string();
    };
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let point = exponent + 1;

    let body = if count <= point && point <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(point - count).unwrap_or(0))
        )
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(point).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!(
            "0.{}{digits}",
            "0".repeat(usize::try_from(-point).unwrap_or(0))
        )
    } else {
        let power = point - 1;
        let power_sign = if power < 0 { '-' } else { '+' };
        let (lead, rest) = digits.split_at(1);
        if rest.is_empty() {
            format!("{lead}e{power_sign}{}", power.abs())
        } else {
            format!("{lead}.{rest}e{power_sign}{}", power.abs())
        }
    };
    format!("{sign}{body}")
}

fn number_text(number: &Number) -> String {
    number
        .as_f64()
        .map_or_else(|| "null".to_string(), js_number)
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&number_text(number)),
        Value::String(text) => write_string(text, out),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            for (index, (key, item)) in ordered_entries(map).into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_value(item, out);
            }
            out.push('}');
        }
    }
}

/// The entries in the order JavaScript lists own keys: array indices ascending, then the other keys as inserted.
fn ordered_entries(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let (mut indices, names): (Vec<_>, Vec<_>) =
        map.iter().partition(|(key, _)| array_index(key).is_some());
    indices.sort_by_key(|(key, _)| array_index(key));
    indices.into_iter().chain(names).collect()
}

/// The integer a key names when JavaScript treats it as an array index: canonical digits up to 2^32 - 2.
fn array_index(key: &str) -> Option<u64> {
    let canonical = !key.is_empty()
        && key.bytes().all(|b| b.is_ascii_digit())
        && (key == "0" || !key.starts_with('0'));
    if !canonical {
        return None;
    }
    key.parse::<u64>()
        .ok()
        .filter(|index| *index <= MAX_ARRAY_INDEX)
}

/// `JSON.stringify` of a string: the short escapes, and other control characters as `\u00xx`.
fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn value(&mut self, depth: usize) -> Option<Value> {
        self.skip_space();
        match *self.bytes.get(self.pos)? {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => self.string().map(Value::String),
            b't' => self.literal("true", Value::Bool(true)),
            b'f' => self.literal("false", Value::Bool(false)),
            b'n' => self.literal("null", Value::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => None,
        }
    }

    fn object(&mut self, depth: usize) -> Option<Value> {
        if depth >= MAX_DEPTH {
            return None;
        }
        self.pos += 1;
        let mut map = Map::new();
        self.skip_space();
        if self.eat(b'}') {
            return Some(Value::Object(map));
        }
        loop {
            self.skip_space();
            let key = self.string()?;
            self.skip_space();
            if !self.eat(b':') {
                return None;
            }
            let value = self.value(depth + 1)?;
            // A repeated key keeps its first place and takes the last value, as in JavaScript.
            map.insert(key, value);
            self.skip_space();
            if self.eat(b'}') {
                return Some(Value::Object(map));
            }
            if !self.eat(b',') {
                return None;
            }
        }
    }

    fn array(&mut self, depth: usize) -> Option<Value> {
        if depth >= MAX_DEPTH {
            return None;
        }
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_space();
        if self.eat(b']') {
            return Some(Value::Array(items));
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.skip_space();
            if self.eat(b']') {
                return Some(Value::Array(items));
            }
            if !self.eat(b',') {
                return None;
            }
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Option<Value> {
        let end = self.pos + word.len();
        if self.bytes.get(self.pos..end)? != word.as_bytes() {
            return None;
        }
        self.pos = end;
        Some(value)
    }

    fn string(&mut self) -> Option<String> {
        if !self.eat(b'"') {
            return None;
        }
        let mut out: Vec<u8> = Vec::new();
        loop {
            let byte = *self.bytes.get(self.pos)?;
            self.pos += 1;
            match byte {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let decoded = self.escape()?;
                    let mut buffer = [0_u8; 4];
                    out.extend_from_slice(decoded.encode_utf8(&mut buffer).as_bytes());
                }
                0..=0x1f => return None,
                _ => out.push(byte),
            }
        }
    }

    /// One escape after its backslash. A surrogate pair becomes one character. A lone surrogate becomes U+FFFD.
    fn escape(&mut self) -> Option<char> {
        let byte = *self.bytes.get(self.pos)?;
        self.pos += 1;
        let decoded = match byte {
            b'"' => '"',
            b'\\' => '\\',
            b'/' => '/',
            b'b' => '\u{8}',
            b'f' => '\u{c}',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'u' => return self.unicode_escape(),
            _ => return None,
        };
        Some(decoded)
    }

    fn unicode_escape(&mut self) -> Option<char> {
        let unit = self.hex4()?;
        if (0xD800..0xDC00).contains(&unit) && self.bytes[self.pos..].starts_with(b"\\u") {
            let resume = self.pos;
            self.pos += 2;
            match self.hex4() {
                Some(low) if (0xDC00..0xE000).contains(&low) => {
                    let code =
                        0x10000 + ((u32::from(unit) - 0xD800) << 10) + (u32::from(low) - 0xDC00);
                    return char::from_u32(code).or(Some('\u{FFFD}'));
                }
                _ => self.pos = resume,
            }
        }
        Some(char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}'))
    }

    fn hex4(&mut self) -> Option<u16> {
        let digits = self.bytes.get(self.pos..self.pos + 4)?;
        if !digits.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        self.pos += 4;
        let text = std::str::from_utf8(digits).ok()?;
        u16::from_str_radix(text, 16).ok()
    }

    fn number(&mut self) -> Option<Value> {
        let start = self.pos;
        self.eat(b'-');
        if !self.eat(b'0') && self.digits() == 0 {
            return None;
        }
        if self.eat(b'.') && self.digits() == 0 {
            return None;
        }
        if self.eat(b'e') || self.eat(b'E') {
            if !self.eat(b'+') {
                self.eat(b'-');
            }
            if self.digits() == 0 {
                return None;
            }
        }
        let lexeme = std::str::from_utf8(&self.bytes[start..self.pos]).ok()?;
        let x: f64 = lexeme.parse().ok()?;
        Some(number_value(x))
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while self.bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
            self.pos += 1;
        }
        self.pos - start
    }

    fn eat(&mut self, byte: u8) -> bool {
        if self.bytes.get(self.pos) == Some(&byte) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn skip_space(&mut self) {
        while matches!(self.bytes.get(self.pos), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_numbers_print_without_a_fraction() {
        assert_eq!(js_number(3.0), "3");
        assert_eq!(js_number(-0.0), "0");
        assert_eq!(js_number(100.0), "100");
        assert_eq!(js_number(0.5), "0.5");
    }

    #[test]
    fn exponents_follow_the_javascript_thresholds() {
        assert_eq!(js_number(1e20), "100000000000000000000");
        assert_eq!(js_number(1e21), "1e+21");
        assert_eq!(js_number(1e-6), "0.000001");
        assert_eq!(js_number(1e-7), "1e-7");
        assert_eq!(js_number(2.5e-7), "2.5e-7");
    }

    #[test]
    fn integers_above_two_to_the_53_keep_the_shortest_digits() {
        assert_eq!(
            js_number(12_345_678_901_234_567_890.0),
            "12345678901234567000"
        );
        assert_eq!(js_number(9_007_199_254_740_993.0), "9007199254740992");
    }

    #[test]
    fn a_tie_between_shortest_digits_takes_the_even_digit() {
        assert_eq!(
            js_number(-(1_247_398_011_445_376.0 + 0.25)),
            "-1247398011445376.2"
        );
    }

    #[test]
    fn infinity_and_nan_print_as_null() {
        assert_eq!(js_number(f64::INFINITY), "null");
        assert_eq!(js_number(f64::NAN), "null");
    }

    #[test]
    fn parse_reads_numbers_as_doubles() {
        assert_eq!(
            parse(r#"{"index":3.0}"#).and_then(|v| v["index"].as_u64()),
            Some(3)
        );
        assert_eq!(
            stringify(&parse(r#"{"n":1e2,"z":-0}"#).unwrap_or(Value::Null)),
            r#"{"n":100,"z":0}"#
        );
        assert_eq!(
            stringify(&parse("[1e400]").unwrap_or(Value::Null)),
            "[null]"
        );
    }

    #[test]
    fn stringify_lists_index_keys_first_then_insertion_order() {
        let value = parse(r#"{"b":1,"2":2,"a":3,"1":4,"01":5}"#).unwrap_or(Value::Null);
        assert_eq!(stringify(&value), r#"{"1":4,"2":2,"b":1,"a":3,"01":5}"#);
    }

    #[test]
    fn a_repeated_key_keeps_its_first_place_and_the_last_value() {
        let value = parse(r#"{"a":1,"b":2,"a":3}"#).unwrap_or(Value::Null);
        assert_eq!(stringify(&value), r#"{"a":3,"b":2}"#);
    }

    #[test]
    fn surrogate_pairs_join_and_lone_surrogates_become_replacement_characters() {
        assert_eq!(parse(r#""🙂""#), Some(Value::String("🙂".to_string())));
        assert_eq!(
            parse(r#""\ud83dx""#),
            Some(Value::String("\u{FFFD}x".to_string()))
        );
    }

    #[test]
    fn parse_rejects_what_javascript_rejects() {
        for text in [
            "01",
            "1.",
            ".5",
            "+1",
            "[1,]",
            r#"{"a":1,}"#,
            "\"a\u{1}\"",
            "1 2",
            "",
            "NaN",
            r#""\x41""#,
        ] {
            assert_eq!(parse(text), None, "{text}");
        }
    }

    #[test]
    fn parse_accepts_json_whitespace_only() {
        assert!(parse(" \t\r\n{ \"a\" : [ 1 , 2 ] } \n").is_some());
        assert_eq!(parse("\u{FEFF}{}"), None);
    }

    #[test]
    fn canonical_makes_equal_numbers_equal() {
        let expected = serde_json::json!({ "index": 3, "big": 12_345_678_901_234_567_000.0 });
        let actual = parse(r#"{"index":3.0,"big":1.2345678901234567e19}"#).unwrap_or(Value::Null);
        assert_eq!(canonical(&actual), canonical(&expected));
    }
}
