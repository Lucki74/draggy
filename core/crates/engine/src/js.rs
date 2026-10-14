//! The JavaScript number rules the reference relies on: `parseInt`, `parseFloat`, `Math.round` and `toFixed(1)`.

/// Whitespace that `parseInt` and `parseFloat` skip at the start of a string.
fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{FEFF}'
}

/// `parseInt(text, 10)`: leading whitespace, an optional sign, then decimal digits. `None` where JavaScript gives NaN.
pub(crate) fn parse_int(text: &str) -> Option<f64> {
    let trimmed = text.trim_start_matches(is_js_space);
    let (negative, digits) = match trimmed.as_bytes().first() {
        Some(b'-') => (true, &trimmed[1..]),
        Some(b'+') => (false, &trimmed[1..]),
        _ => (false, trimmed),
    };
    let length = digits.bytes().take_while(u8::is_ascii_digit).count();
    if length == 0 {
        return None;
    }
    let magnitude = digits[..length]
        .bytes()
        .fold(0.0_f64, |acc, byte| acc * 10.0 + f64::from(byte - b'0'));
    Some(if negative { -magnitude } else { magnitude })
}

/// `parseFloat(text)`: the longest decimal prefix after leading whitespace. `None` where JavaScript gives NaN.
pub(crate) fn parse_float(text: &str) -> Option<f64> {
    let trimmed = text.trim_start_matches(is_js_space);
    let bytes = trimmed.as_bytes();
    let mut end = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        end += 1;
    }
    if trimmed[end..].starts_with("Infinity") {
        let negative = bytes.first() == Some(&b'-');
        return Some(if negative {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    let int_start = end;
    end += bytes[end..]
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count();
    let mut digits = end - int_start;
    if bytes.get(end) == Some(&b'.') {
        let frac = bytes[end + 1..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        if digits > 0 || frac > 0 {
            digits += frac;
            end += 1 + frac;
        }
    }
    if digits == 0 {
        return None;
    }
    if matches!(bytes.get(end), Some(b'e' | b'E')) {
        let mut exp = end + 1;
        if matches!(bytes.get(exp), Some(b'+' | b'-')) {
            exp += 1;
        }
        let exp_digits = bytes[exp..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        if exp_digits > 0 {
            end = exp + exp_digits;
        }
    }
    trimmed[..end].parse::<f64>().ok()
}

/// `Math.round`: the nearest integer, ties toward positive infinity.
pub(crate) fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `Number(x.toFixed(1))` for a finite, non-negative value. Ties round up, as `toFixed` does.
pub(crate) fn to_fixed1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_reads_the_leading_digits() {
        assert_eq!(parse_int("  42px"), Some(42.0));
        assert_eq!(parse_int("-7"), Some(-7.0));
        assert_eq!(parse_int("0x1F"), Some(0.0));
        assert_eq!(parse_int(""), None);
        assert_eq!(parse_int("abc"), None);
    }

    #[test]
    fn parse_float_reads_the_longest_decimal_prefix() {
        assert_eq!(parse_float("8.9 rest"), Some(8.9));
        assert_eq!(parse_float(".5"), Some(0.5));
        assert_eq!(parse_float("5."), Some(5.0));
        assert_eq!(parse_float("1e3x"), Some(1000.0));
        assert_eq!(parse_float("1e"), Some(1.0));
        assert_eq!(parse_float("-Infinity"), Some(f64::NEG_INFINITY));
        assert_eq!(parse_float("."), None);
    }

    #[test]
    fn round_and_to_fixed_follow_javascript() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(to_fixed1(20.25), 20.3);
        assert_eq!(to_fixed1(1.04), 1.0);
    }
}
