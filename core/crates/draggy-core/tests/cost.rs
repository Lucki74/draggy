//! Runs the golden cases in `shared/fixtures/cost/cost.json`, which the TypeScript engine is held to as well.

use draggy_core::cost::{PriceEntry, cost_of, cost_of_passes};
use draggy_providers::types::TokenUsage;
use serde_json::Value;

fn fixture() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/fixtures/cost/cost.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture file"))
        .expect("fixture json")
}

#[test]
fn the_golden_cases_price_the_same_as_the_reference() {
    let file = fixture();
    let mut failures = Vec::new();
    for case in file["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().unwrap_or("?");
        let input = &case["input"];
        let price: Option<PriceEntry> = match &input["price"] {
            Value::Null => None,
            value => Some(serde_json::from_value(value.clone()).expect("price")),
        };
        let cost = if let Some(passes) = input.get("passes") {
            let passes: Vec<TokenUsage> = serde_json::from_value(passes.clone()).expect("passes");
            cost_of_passes(&passes, price.as_ref())
        } else {
            let usage: TokenUsage = serde_json::from_value(input["usage"].clone()).expect("usage");
            cost_of(&usage, price.as_ref())
        };
        let expected = &case["expected"];
        let source = serde_json::to_value(cost.source).unwrap();
        if expected["micros"].as_i64() != cost.micros || expected["source"] != source {
            failures.push(format!(
                "{name}: expected {} {}, got {:?} {source}",
                expected["micros"], expected["source"], cost.micros
            ));
        }
        if let Some(parts) = expected.get("parts") {
            let got = serde_json::to_value(cost.parts).unwrap();
            let same = ["input", "cacheRead", "cacheWrite", "output", "reasoning"]
                .iter()
                .all(|key| parts[key].as_f64() == got[key].as_f64());
            if !same {
                failures.push(format!("{name}: parts expected {parts}, got {got}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
