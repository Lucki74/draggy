//! The parts of JavaScript number semantics the reference relies on: `Number(string)`, `Math.round`, `Math.min`.

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
}
