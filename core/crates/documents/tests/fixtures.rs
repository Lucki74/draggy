//! Runs the golden fixtures in `shared/fixtures/documents` through the port. The vitest runner in
//! `src/__tests__/fixtures/documents.test.ts` calls electron/markdownHtml.cjs, htmlDocument.cjs and officeStyle.cjs
//! with the same args, so both must agree.

use draggy_documents::{html, markdown_html, office_style};
use draggy_testkit::{cases, files};
use serde_json::{Value, json};

fn arg(args: &[Value], index: usize) -> Option<&str> {
    args.get(index).and_then(Value::as_str)
}

fn num(args: &[Value], index: usize) -> f64 {
    args.get(index).and_then(Value::as_f64).unwrap_or(f64::NAN)
}

/// A number as the fixtures store it: whole numbers as integers, NaN and the infinities by name.
fn number_value(value: f64) -> Value {
    if value.is_nan() {
        json!("NaN")
    } else if value == f64::INFINITY {
        json!("Infinity")
    } else if value == f64::NEG_INFINITY {
        json!("-Infinity")
    } else if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

/// Makes every whole-valued number an integer, so `22.0` from Rust and `22` from the fixture compare equal.
fn normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 9.0e15 => json!(float as i64),
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, normalize(item)))
                .collect(),
        ),
        other => other,
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("fixture values serialise")
}

/// Calls the function a case names with the case's args, and returns what it produced as JSON.
fn run(name: &str, args: &[Value]) -> Value {
    match name {
        "escapeHtml" => json!(markdown_html::escape_html(arg(args, 0))),
        "inlineHtml" => json!(markdown_html::inline_html(arg(args, 0).unwrap_or(""))),
        "markdownToHtml" => json!(markdown_html::markdown_to_html(arg(args, 0))),
        "buildDocument" => json!(markdown_html::build_document(arg(args, 0), arg(args, 1))),
        "isHtml" => json!(html::is_html(arg(args, 0))),
        "parseColor" => json!(html::parse_color(arg(args, 0))),
        "parseStyle" => json!(html::parse_style(arg(args, 0))),
        "parsePt" => {
            let default = if args.len() > 1 { num(args, 1) } else { 11.0 };
            number_value(html::parse_pt(arg(args, 0), default))
        }
        "parseWidth" => match html::parse_width(arg(args, 0)) {
            Some(html::Width::Px { value }) => json!({"type": "px", "value": number_value(value)}),
            Some(html::Width::Percent { value }) => {
                json!({"type": "percent", "value": number_value(value)})
            }
            None => Value::Null,
        },
        "decodeEntities" => json!(html::decode_entities(arg(args, 0))),
        "parseHtml" => to_json(&html::parse_html(arg(args, 0).unwrap_or(""))),
        "nodeText" => json!(html::node_text(&html::parse_html(
            arg(args, 0).unwrap_or("")
        ))),
        "pt" => number_value(office_style::pt(num(args, 0))),
        "twips" => number_value(office_style::twips(num(args, 0))),
        "constants" => json!({
            "BODY_FONT": office_style::BODY_FONT,
            "HEADING_FONT": office_style::HEADING_FONT,
            "SHEET_FONT": office_style::SHEET_FONT,
            "MONO_FONT": office_style::MONO_FONT,
            "HEADING_COLOR": office_style::HEADING_COLOR,
        }),
        "DOCX_STYLES" => to_json(&office_style::docx_styles()),
        "DOCX_NUMBERING" => to_json(&office_style::docx_numbering()),
        "tableBorders" => to_json(&office_style::table_borders()),
        other => panic!("no fixture function named {other}"),
    }
}

fn short(value: &Value) -> String {
    let text = value.to_string();
    if text.len() > 160 {
        let cut = (0..=160)
            .rev()
            .find(|&i| text.is_char_boundary(i))
            .unwrap_or(0);
        format!("{}...", &text[..cut])
    } else {
        text
    }
}

#[test]
fn documents_fixtures_match_the_reference() {
    let mut failures = Vec::new();
    let mut total = 0;
    // The office files have their own runner (tests/office_fixtures.rs) and their own function names.
    for file in files("documents")
        .into_iter()
        .filter(|f| !f.starts_with("documents-office-"))
    {
        for case in cases("documents", &file) {
            total += 1;
            let name = case["name"].as_str().unwrap_or("?");
            let function = case["input"]["fn"].as_str().unwrap_or("");
            let args = case["input"]["args"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let actual = normalize(run(function, &args));
            let expected = normalize(case["expected"].clone());
            if actual != expected {
                failures.push(format!(
                    "{file} / {name}\n  expected {}\n  actual   {}",
                    short(&expected),
                    short(&actual)
                ));
            }
        }
    }
    assert!(
        total > 200,
        "expected the documents fixtures, found {total} cases"
    );
    assert!(
        failures.is_empty(),
        "{} of {total} cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
