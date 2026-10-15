//! The parts of JavaScript semantics the reference relies on: `Number(string)`, `Math.round`, `Math.min`, `toFixed`, `localeCompare`.

use std::cmp::Ordering;
use std::sync::OnceLock;

use icu_collator::options::CollatorOptions;
use icu_collator::{CollatorBorrowed, CollatorPreferences};

/// Whitespace and line terminators that JavaScript's `trim` and `Number()` skip. Rust's `is_whitespace` also takes U+0085.
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

/// `Number(text)`: trims whitespace, reads "" as zero, takes 0x/0b/0o without a sign, and decimal with an optional Infinity.
pub(crate) fn string_to_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_space);
    if trimmed.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            return parse_radix(digits, radix);
        }
    }
    let (negative, unsigned) = match trimmed.as_bytes().first() {
        Some(b'-') => (true, &trimmed[1..]),
        Some(b'+') => (false, &trimmed[1..]),
        _ => (false, trimmed),
    };
    let magnitude = if unsigned == "Infinity" {
        f64::INFINITY
    } else if is_decimal(unsigned) {
        unsigned.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        return f64::NAN;
    };
    if negative { -magnitude } else { magnitude }
}

fn parse_radix(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let mut value = 0.0_f64;
    for c in digits.chars() {
        match c.to_digit(radix) {
            Some(digit) => value = value * f64::from(radix) + f64::from(digit),
            None => return f64::NAN,
        }
    }
    value
}

/// StrUnsignedDecimalLiteral without Infinity: digits with an optional point and exponent, at least one digit in the mantissa.
fn is_decimal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut at = 0;
    let int_digits = count_digits(bytes, &mut at);
    let mut frac_digits = 0;
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        frac_digits = count_digits(bytes, &mut at);
    }
    if int_digits + frac_digits == 0 {
        return false;
    }
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        at += 1;
        if matches!(bytes.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        if count_digits(bytes, &mut at) == 0 {
            return false;
        }
    }
    at == bytes.len()
}

fn count_digits(bytes: &[u8], at: &mut usize) -> usize {
    let start = *at;
    while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
        *at += 1;
    }
    *at - start
}

/// `Math.round`: the nearest integer, ties toward positive infinity.
pub(crate) fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `Number(value).toFixed(digits)` for finite values below 1e21: the exact binary value rounded to `digits` places, ties going up.
pub(crate) fn to_fixed(value: f64, digits: usize) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // A double has at most 1074 fractional digits, so this expansion is exact and rounding it is not a guess.
    let exact = format!("{:.1074}", value.abs());
    let (whole, fraction) = exact.split_once('.').unwrap_or((exact.as_str(), ""));
    let mut kept: Vec<u8> = whole.bytes().map(|b| b - b'0').collect();
    let mut shown: Vec<u8> = fraction.bytes().take(digits).map(|b| b - b'0').collect();
    shown.resize(digits, 0);
    let round_up = fraction.as_bytes().get(digits).is_some_and(|b| *b >= b'5');
    kept.extend(shown);
    if round_up {
        let mut carry = true;
        for digit in kept.iter_mut().rev() {
            if !carry {
                break;
            }
            if *digit == 9 {
                *digit = 0;
            } else {
                *digit += 1;
                carry = false;
            }
        }
        if carry {
            kept.insert(0, 1);
        }
    }
    let split = kept.len() - digits;
    let mut text = String::with_capacity(kept.len() + 2);
    text.push_str(sign);
    for (at, digit) in kept.iter().enumerate() {
        if at == split && digits > 0 {
            text.push('.');
        }
        text.push(char::from(b'0' + digit));
    }
    text
}

/// `Number(value.toFixed(digits))`: the rounded value read back as a number.
pub(crate) fn to_fixed_number(value: f64, digits: usize) -> f64 {
    to_fixed(value, digits).parse::<f64>().unwrap_or(f64::NAN)
}

/// `a.localeCompare(b)` for file names, by ICU root collation (the same collator the tools crate uses).
pub(crate) fn locale_cmp(a: &str, b: &str) -> Ordering {
    match collator() {
        Some(collator) => collator.compare(a, b),
        None => a.cmp(b),
    }
}

/// Built once. Compiled data always builds, so the code point fallback only guards a broken build.
fn collator() -> Option<&'static CollatorBorrowed<'static>> {
    static COLLATOR: OnceLock<Option<CollatorBorrowed<'static>>> = OnceLock::new();
    COLLATOR
        .get_or_init(|| {
            match CollatorBorrowed::try_new(
                CollatorPreferences::default(),
                CollatorOptions::default(),
            ) {
                Ok(collator) => Some(collator),
                Err(error) => {
                    tracing::error!(target: "models.collation", error = %error, "collator unavailable");
                    None
                }
            }
        })
        .as_ref()
}

/// `Math.min` for two numbers: NaN wins, unlike `f64::min`.
pub(crate) fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_of_a_string_follows_javascript() {
        assert_eq!(string_to_number(""), 0.0);
        assert_eq!(string_to_number("  \t42\n "), 42.0);
        assert_eq!(string_to_number("\u{FEFF}7"), 7.0);
        assert_eq!(string_to_number("0x1F"), 31.0);
        assert_eq!(string_to_number("0b101"), 5.0);
        assert_eq!(string_to_number("0o17"), 15.0);
        assert!(string_to_number("-0x1F").is_nan());
        assert_eq!(string_to_number("1e3"), 1000.0);
        assert_eq!(string_to_number(".5"), 0.5);
        assert_eq!(string_to_number("5."), 5.0);
        assert_eq!(string_to_number("+.5e-1"), 0.05);
        assert_eq!(string_to_number("-Infinity"), f64::NEG_INFINITY);
        assert!(string_to_number("infinity").is_nan());
        assert!(string_to_number(".").is_nan());
        assert!(string_to_number("1e").is_nan());
        assert!(string_to_number("12px").is_nan());
        assert!(string_to_number("0x").is_nan());
    }

    #[test]
    fn round_and_min_follow_javascript() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(49.4), 49.0);
        assert!(min(1.0, f64::NAN).is_nan());
        assert_eq!(min(1.0, 0.5), 0.5);
    }

    #[test]
    fn to_fixed_rounds_the_exact_binary_value_like_javascript() {
        // 2.25 is exact, so the tie goes up; 1.15 and 6.85 sit just below their decimal, so they go down.
        assert_eq!(to_fixed(2.25, 1), "2.3");
        assert_eq!(to_fixed(1.15, 1), "1.1");
        assert_eq!(to_fixed(6.85, 1), "6.8");
        assert_eq!(to_fixed(1.45, 1), "1.4");
        assert_eq!(to_fixed(9.96, 1), "10.0");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(-2.5, 0), "-3");
        assert_eq!(to_fixed(-0.04, 1), "-0.0");
        assert_eq!(to_fixed(0.0, 1), "0.0");
        assert_eq!(to_fixed(f64::NAN, 1), "NaN");
        assert_eq!(to_fixed(f64::NEG_INFINITY, 1), "-Infinity");
    }

    #[test]
    fn locale_order_ignores_case_first_and_puts_lowercase_before_uppercase() {
        assert_eq!(
            locale_cmp("mmproj-f16.gguf", "mmproj-F16.gguf"),
            Ordering::Less
        );
        assert_eq!(locale_cmp("b.gguf", "A.gguf"), Ordering::Greater);
        assert_eq!(
            locale_cmp("model-00001-of-00002.gguf", "model-00002-of-00002.gguf"),
            Ordering::Less
        );
        assert_eq!(locale_cmp("same", "same"), Ordering::Equal);
    }
}
