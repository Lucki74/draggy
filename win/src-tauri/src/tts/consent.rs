//! Which cloud voice providers the user agreed to send reply text to. Kept in settings under one key, per provider,
//! so the renderer cannot grant it through the settings store. Port of electron/tts/consent.cjs.

use serde_json::{Map, Value, json};

pub const KEY: &str = "draggy_voice_consent";
const KIND: &str = "text";

fn read(raw: Option<&str>) -> Map<String, Value> {
    match raw.and_then(|text| serde_json::from_str::<Value>(text).ok()) {
        Some(Value::Object(all)) => all,
        _ => Map::new(),
    }
}

/// True when the provider has consent for reply text.
pub fn has(raw: Option<&str>, provider: &str) -> bool {
    read(raw)
        .get(provider)
        .and_then(|kinds| kinds.get(KIND))
        .and_then(Value::as_str)
        .is_some_and(|at| !at.is_empty())
}

/// The consent text with `provider` granted, stamped with `at`.
pub fn grant(raw: Option<&str>, provider: &str, at: &str) -> String {
    let mut all = read(raw);
    let mut kinds = all
        .get(provider)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    kinds.insert(KIND.to_owned(), json!(at));
    all.insert(provider.to_owned(), Value::Object(kinds));
    Value::Object(all).to_string()
}

/// The consent text with `provider` removed.
pub fn revoke(raw: Option<&str>, provider: &str) -> String {
    let mut all = read(raw);
    all.remove(provider);
    Value::Object(all).to_string()
}

/// Provider id to the kinds it has been granted, as the renderer shows them.
pub fn list(raw: Option<&str>) -> Value {
    Value::Object(
        read(raw)
            .into_iter()
            .map(|(id, kinds)| {
                let names: Vec<Value> = kinds
                    .as_object()
                    .map(|map| map.keys().cloned().map(Value::String).collect())
                    .unwrap_or_default();
                (id, Value::Array(names))
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_then_revoke_round_trips() {
        let granted = grant(None, "openai", "2026-11-12T00:00:00.000Z");
        assert!(has(Some(&granted), "openai"));
        assert!(!has(Some(&granted), "gemini"));
        assert_eq!(list(Some(&granted)), json!({ "openai": ["text"] }));
        let revoked = revoke(Some(&granted), "openai");
        assert!(!has(Some(&revoked), "openai"));
        assert_eq!(list(Some(&revoked)), json!({}));
    }

    #[test]
    fn unreadable_or_missing_consent_counts_as_none_given() {
        assert!(!has(Some("{ not json"), "openai"));
        assert!(!has(Some("[]"), "openai"));
        assert!(!has(None, "openai"));
        assert_eq!(list(Some("garbage")), json!({}));
    }
}
