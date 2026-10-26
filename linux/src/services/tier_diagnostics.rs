use std::collections::HashMap;

pub fn run_tier_checks() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("inference_engine".to_string(), "llama.cpp".to_string());
    map.insert("status".to_string(), "ok".to_string());
    map
}
