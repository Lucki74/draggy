//! Decides which freshly listed models join an instance's menu without the user ticking them. The twin of
//! `win/electron/providers/autoPin.cjs`; the golden cases in `shared/fixtures/providers/autopin.json` hold both to it.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

use crate::catalog::{CatalogEntry, compile, noise_patterns};

pub const MAX_AUTO_PINS: usize = 3;
// A date stamped on the end of an id marks a snapshot of the model named before it.
static SNAPSHOT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"-([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8}|[0-9]{4})$")
        .expect("the snapshot pattern compiles")
});

/// What a refresh writes back: the ids now seen, the pins, and the ids this refresh pinned.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PinPlan {
    pub seen_models: Vec<String>,
    pub pinned_models: Vec<String>,
    pub added: Vec<String>,
}

/// A listed id is noise when a pattern names it, or when it is a dated snapshot of a model already pinned.
pub fn is_noise(entry: Option<&CatalogEntry>, id: &str, pinned: &[String]) -> bool {
    let named = noise_patterns(entry)
        .iter()
        .any(|pattern| compile(pattern).is_some_and(|re| re.is_match(id).unwrap_or(false)));
    if named {
        return true;
    }
    let base = SNAPSHOT.replace(id, "");
    base != id && pinned.iter().any(|pin| pin == base.as_ref())
}

/// `seen` of None is the first look: remember what is listed and pin nothing. Every fresh id is marked seen,
/// even one that was not pinned, so an unticked model is not offered again on the next refresh.
pub fn plan_pins(
    entry: Option<&CatalogEntry>,
    listed: &[String],
    pinned: &[String],
    seen: Option<&[String]>,
) -> PinPlan {
    let ids = unique(listed);
    let Some(seen) = seen else {
        return PinPlan {
            seen_models: ids,
            pinned_models: pinned.to_vec(),
            added: Vec::new(),
        };
    };
    let known: HashSet<&str> = seen.iter().map(String::as_str).collect();
    let fresh: Vec<String> = ids
        .into_iter()
        .filter(|id| !known.contains(id.as_str()))
        .collect();
    let mut pins = unique(pinned);
    let mut added = Vec::new();
    for id in &fresh {
        if added.len() >= MAX_AUTO_PINS || is_noise(entry, id, &pins) {
            continue;
        }
        pins.push(id.clone());
        added.push(id.clone());
    }
    let mut seen_models = seen.to_vec();
    seen_models.extend(fresh);
    PinPlan {
        seen_models,
        pinned_models: pins,
        added,
    }
}

/// A list of strings in first-seen order, each once.
fn unique(items: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .iter()
        .filter(|item| seen.insert(item.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap};

    use serde_json::json;

    use super::*;
    use crate::catalog::Catalog;
    use crate::http::{HttpClient, HttpRequest, HttpResponse, TransportError};
    use crate::models::ModelLister;
    use crate::registry::{AddArgs, Keystore, KvStore, Patch, Registry};

    fn entry(noise: &[&str]) -> CatalogEntry {
        serde_json::from_value(json!({
            "id": "fixture",
            "name": "Fixture",
            "kind": "cloud",
            "protocol": "openai",
            "auth": "bearer",
            "noisePatterns": noise,
        }))
        .expect("a test entry reads")
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn the_shared_list_names_embeddings_and_speech() {
        assert!(is_noise(None, "text-embedding-4", &[]));
        assert!(is_noise(None, "whisper-large", &[]));
        assert!(!is_noise(None, "gpt-6", &[]));
    }

    #[test]
    fn a_provider_pattern_is_case_insensitive() {
        let entry = entry(&["VEC$"]);
        assert!(is_noise(Some(&entry), "fancy-vec", &[]));
        assert!(!is_noise(None, "fancy-vec", &[]));
    }

    #[test]
    fn a_snapshot_is_noise_only_when_its_base_is_pinned() {
        assert!(is_noise(
            None,
            "claude-x-5-2026-01-01",
            &strings(&["claude-x-5"])
        ));
        assert!(is_noise(
            None,
            "claude-x-5-20260101",
            &strings(&["claude-x-5"])
        ));
        assert!(!is_noise(None, "claude-x-5-20260101", &[]));
        assert!(!is_noise(None, "model-2", &strings(&["model"])));
    }

    #[test]
    fn a_pass_over_the_cap_still_marks_the_rest_seen() {
        let listed = strings(&["m1", "m2", "m3", "m4"]);
        let plan = plan_pins(None, &listed, &[], Some(&[]));
        assert_eq!(plan.added, strings(&["m1", "m2", "m3"]));
        assert_eq!(plan.seen_models, listed);
    }

    #[test]
    fn a_first_look_seeds_without_pinning() {
        let plan = plan_pins(None, &strings(&["a", "a", "b"]), &strings(&["a"]), None);
        assert_eq!(plan.seen_models, strings(&["a", "b"]));
        assert_eq!(plan.pinned_models, strings(&["a"]));
        assert!(plan.added.is_empty());
    }

    #[derive(Default)]
    struct Kv(HashMap<String, String>);

    impl KvStore for Kv {
        fn get(&self, key: &str) -> Option<String> {
            self.0.get(key).cloned()
        }
        fn set(&mut self, key: &str, value: &str) {
            self.0.insert(key.to_owned(), value.to_owned());
        }
    }

    struct NoKeys;

    impl Keystore for NoKeys {
        fn available(&self) -> bool {
            true
        }
        fn get(&self, _owner: &str) -> Option<String> {
            None
        }
        fn set(&mut self, _owner: &str, _key: Option<&str>) -> bool {
            true
        }
        fn remove(&mut self, _owner: &str) {}
    }

    /// Answers every request with one body; a 500 stands for a refused listing.
    struct Answer(u16, &'static str);

    impl HttpClient for Answer {
        fn send(&self, _request: &HttpRequest) -> Result<HttpResponse, TransportError> {
            Ok(HttpResponse {
                status: self.0,
                headers: BTreeMap::new(),
                body: self.1.to_owned(),
            })
        }
    }

    fn registry_with_fixture() -> (Registry<Kv, NoKeys>, String) {
        let entry: CatalogEntry = serde_json::from_value(json!({
            "id": "fixture",
            "name": "Fixture",
            "kind": "cloud",
            "protocol": "openai",
            "auth": "none",
            "baseUrl": "https://example.test",
            "defaultModels": [],
        }))
        .expect("a fixture entry reads");
        let mut registry = Registry::new(Kv::default(), NoKeys, Catalog::from_entries(vec![entry]));
        let view = registry
            .add(AddArgs {
                provider_type: "fixture".to_owned(),
                ..AddArgs::default()
            })
            .expect("the fixture adds");
        registry
            .update(
                &view.id,
                Patch {
                    enabled: Some(true),
                    ..Patch::default()
                },
            )
            .expect("the fixture enables");
        (registry, view.id)
    }

    #[test]
    fn a_refresh_seeds_then_pins_only_what_is_new() {
        let (mut registry, id) = registry_with_fixture();
        let first = ModelLister::new(Answer(200, r#"{"data":[{"id":"gpt-6"}]}"#));
        let seeded = refresh_with(&mut registry, &id, first);
        assert_eq!(
            seeded.expect("the first look lands").added,
            Vec::<String>::new()
        );

        let later = ModelLister::new(Answer(200, r#"{"data":[{"id":"gpt-6"},{"id":"gpt-7"}]}"#));
        let plan = refresh_with(&mut registry, &id, later).expect("the refresh lands");
        assert_eq!(plan.added, strings(&["gpt-7"]));
        let stored = registry.get(&id).expect("the instance is kept");
        assert_eq!(stored.pinned_models, strings(&["gpt-7"]));
        assert_eq!(stored.seen_models, Some(strings(&["gpt-6", "gpt-7"])));
    }

    #[test]
    fn a_refused_listing_or_a_switched_off_instance_writes_nothing() {
        let (mut registry, id) = registry_with_fixture();
        let refused = refresh_with(&mut registry, &id, ModelLister::new(Answer(500, "{}")));
        assert!(refused.is_none());
        assert_eq!(registry.get(&id).expect("kept").seen_models, None);

        registry
            .update(
                &id,
                Patch {
                    enabled: Some(false),
                    ..Patch::default()
                },
            )
            .expect("the instance switches off");
        let off = refresh_with(
            &mut registry,
            &id,
            ModelLister::new(Answer(200, r#"{"data":[{"id":"gpt-6"}]}"#)),
        );
        assert!(off.is_none());
        assert_eq!(registry.get(&id).expect("kept").seen_models, None);
    }

    fn refresh_with(
        registry: &mut Registry<Kv, NoKeys>,
        id: &str,
        mut lister: ModelLister<Answer>,
    ) -> Option<PinPlan> {
        lister.refresh_auto_pins(registry, id, 0)
    }
}
