//! The text of each record: one line for `app.log` and `debug.log`, one JSON object for `events.jsonl`.
//! JSON is written by hand so numbers take JavaScript's `Number.prototype.toString` rules, as `JSON.stringify` does.

use serde_json::{Map, Value, json};

use crate::config::Level;

/// The fields a text line shows before its data. `cid` is the correlation id already rendered as text.
pub(crate) struct Head<'a> {
    pub(crate) stamp: &'a str,
    pub(crate) level: Level,
    pub(crate) tag: &'a str,
    pub(crate) cid: Option<&'a str>,
    pub(crate) context: &'a str,
    pub(crate) message: &'a str,
}

/// `stamp LEVEL tag [cid|system] [context] message data`, then the error on the next lines.
pub(crate) fn line(head: &Head<'_>, payload: Option<&Value>, error: Option<&str>) -> String {
    let id = head
        .cid
        .map_or_else(|| "[system]".to_owned(), |cid| format!("[{cid}]"));
    let mut text = format!(
        "{} {} {} {id} [{}] {}",
        head.stamp,
        head.level.name(),
        head.tag,
        head.context,
        head.message
    );
    if let Some(body) = payload
        .filter(|value| !value.is_null())
        .map(serialise)
        .filter(|body| !body.is_empty())
    {
        text.push(' ');
        text.push_str(&body);
    }
    if let Some(error) = error.filter(|error| !error.is_empty()) {
        text.push('\n');
        text.push_str(error);
    }
    text.push('\n');
    text
}

/// One `events.jsonl` record. Keys appear in the order logger.cjs writes them; absent fields are left out.
pub(crate) struct Record<'a> {
    pub(crate) stamp: &'a str,
    pub(crate) seq: u64,
    pub(crate) level: Level,
    pub(crate) session: &'a str,
    pub(crate) pid: u32,
    pub(crate) scope: &'a str,
    pub(crate) msg: &'a str,
    pub(crate) cid: Option<Value>,
    pub(crate) dur_ms: Option<f64>,
    pub(crate) data: Option<Value>,
    pub(crate) err: Option<Value>,
}

pub(crate) fn record_line(record: Record<'_>) -> String {
    let mut map = Map::new();
    map.insert("ts".to_owned(), json!(record.stamp));
    map.insert("seq".to_owned(), json!(record.seq));
    map.insert("level".to_owned(), json!(record.level.name()));
    map.insert("session".to_owned(), json!(record.session));
    map.insert("proc".to_owned(), json!(proc_of(record.scope)));
    map.insert("pid".to_owned(), json!(record.pid));
    map.insert("scope".to_owned(), json!(record.scope));
    map.insert("msg".to_owned(), json!(record.msg));
    if let Some(cid) = record.cid {
        map.insert("cid".to_owned(), cid);
    }
    if let Some(dur) = record.dur_ms {
        map.insert("durMs".to_owned(), json!(dur));
    }
    if let Some(data) = record.data {
        map.insert("data".to_owned(), data);
    }
    if let Some(err) = record.err {
        map.insert("err".to_owned(), err);
    }
    format!("{}\n", js_json(&Value::Object(map)))
}

/// Which process a scope belongs to: `renderer.*`, `engine.*`, `mcp.<name>`, or main for anything else.
pub(crate) fn proc_of(scope: &str) -> String {
    if scope.starts_with("renderer") {
        return "renderer".to_owned();
    }
    if scope.starts_with("engine") {
        return "engine".to_owned();
    }
    if let Some(rest) = scope.strip_prefix("mcp.") {
        let name = rest.split(['.', ':']).next().unwrap_or_default();
        return format!("mcp:{name}");
    }
    "main".to_owned()
}

/// A string is written as it is; anything else as compact JSON.
fn serialise(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => js_json(other),
    }
}

/// `JSON.stringify` for a value this crate built: keys in insertion order, numbers as JavaScript prints them.
pub(crate) fn js_json(value: &Value) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

fn write_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&js_number_of(number)),
        Value::String(text) => out.push_str(&serde_json::to_string(text).unwrap_or_default()),
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
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap_or_default());
                out.push(':');
                write_json(item, out);
            }
            out.push('}');
        }
    }
}

/// `Number.prototype.toString` for a finite number: the shortest digits that round-trip, laid out the JavaScript way.
/// Non-finite values are `null`, as `JSON.stringify` writes them.
pub(crate) fn js_number_text(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let Some((mantissa, exponent)) = scientific.split_once('e') else {
        return "null".to_owned();
    };
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let Ok(exponent) = exponent.parse::<i64>() else {
        return "null".to_owned();
    };
    let count = digits.len() as i64;
    let point = exponent + 1;
    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        let power = point - 1;
        let sign_char = if power < 0 { '-' } else { '+' };
        format!("{first}{rest}e{sign_char}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// Above 2^53 JavaScript keeps only the nearest double, and so does a JSON number read by JavaScript; so does this.
const MAX_EXACT_INTEGER: f64 = 9_007_199_254_740_992.0;

/// A JSON number as JavaScript writes it. Integers beyond 2^53 take the double's digits, as JavaScript reads them.
fn js_number_of(number: &serde_json::Number) -> String {
    match number.as_f64() {
        Some(float) if number.is_f64() || float.abs() > MAX_EXACT_INTEGER => js_number_text(float),
        _ => number.to_string(),
    }
}

/// JavaScript's `String(value)` for a JSON value: null is "null", an array joins its items, an object is "[object Object]".
pub(crate) fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => js_number_of(number),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// JavaScript truthiness for a JSON value: null, false, zero and the empty string are false.
pub(crate) fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_none_or(|float| float != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{js_json, js_number_text, js_string, js_truthy, proc_of};

    #[test]
    fn process_names_follow_the_scope_prefix() {
        assert_eq!(proc_of("renderer.chat"), "renderer");
        assert_eq!(proc_of("engine.llama"), "engine");
        assert_eq!(proc_of("mcp.github"), "mcp:github");
        assert_eq!(proc_of("mcp"), "main");
        assert_eq!(proc_of("providers"), "main");
    }

    #[test]
    fn numbers_print_the_way_javascript_does() {
        assert_eq!(js_number_text(25.0), "25");
        assert_eq!(js_number_text(412.3), "412.3");
        assert_eq!(js_number_text(1e16), "10000000000000000");
        assert_eq!(js_number_text(1e21), "1e+21");
        assert_eq!(js_number_text(1e-7), "1e-7");
        assert_eq!(js_number_text(0.000001), "0.000001");
        assert_eq!(js_number_text(-2.5), "-2.5");
        assert_eq!(
            js_number_text(1_152_921_504_606_846_976.0),
            "1152921504606847000"
        );
    }

    #[test]
    fn json_keeps_insertion_order_and_js_numbers() {
        let value = json!({"b": 2.0, "a": [1.5, null, true]});
        assert_eq!(js_json(&value), r#"{"b":2,"a":[1.5,null,true]}"#);
        assert_eq!(
            js_json(&json!(1_152_921_504_606_846_976_u64)),
            "1152921504606847000"
        );
    }

    #[test]
    fn strings_and_truthiness_follow_javascript() {
        assert_eq!(js_string(&json!(["a", null, 2])), "a,,2");
        assert_eq!(js_string(&json!({"x": 1})), "[object Object]");
        assert!(!js_truthy(&json!(0)));
        assert!(!js_truthy(&json!("")));
        assert!(js_truthy(&json!([])));
    }
}
