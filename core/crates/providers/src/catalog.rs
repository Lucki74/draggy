//! The providers Draggy knows how to reach. The bundled list is generated from `electron/providers/catalog.cjs`; a
//! local server's address is its default and may be changed per instance.

use fancy_regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::Url;

use crate::js::{to_string, truthy};

const BUNDLED: &str = include_str!("bundled_catalog.json");
const VENDORS: [&str; 3] = ["openai", "anthropic", "google"];
const PROTOCOLS: [&str; 7] = [
    "openai",
    "ollama",
    "anthropic",
    "gemini",
    "codex",
    "claude",
    "agy",
];
const AUTHS: [&str; 5] = ["bearer", "x-api-key", "x-goog-api-key", "account", "none"];
const CAPABILITIES: [&str; 3] = ["tools", "vision", "thinking"];

/// One provider as the catalog describes it. A local server's discovery names its usual port and probe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(default)]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_url: Option<String>,
    pub auth: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign_in_hosts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_patterns: Option<Vec<CapabilityPattern>>,
    /// Extra ids kept out of the auto-pinned menu, on top of `NOISE`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noise_patterns: Option<Vec<String>>,
    #[serde(default)]
    pub default_models: Vec<String>,
    /// Protocol switches the adapters read: the output limit's name, thinking and template flags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quirks: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovery: Option<Discovery>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_optional: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<bool>,
}

/// Capabilities for model ids that match a case-insensitive pattern; the first matching pattern wins.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityPattern {
    #[serde(rename = "match", default)]
    pub pattern: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub port: u16,
    pub probe: String,
}

/// What a model can do, from the first pattern that names it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Capabilities {
    pub capabilities: Vec<String>,
    pub context_length: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

/// The providers Draggy ships with, or a signed merge of them once a remote file has been verified.
#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    entries: Vec<CatalogEntry>,
}

impl Catalog {
    /// The list compiled into the crate.
    pub fn bundled() -> Self {
        Self {
            entries: serde_json::from_str(BUNDLED).unwrap_or_default(),
        }
    }

    pub fn from_entries(entries: Vec<CatalogEntry>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    pub fn find(&self, id: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|entry| entry.id == id)
    }
}

/// Why an entry cannot be used, or None. Written over the JSON, so a remote file meets the same bar as the bundled list.
pub fn problem_with(entry: &Value) -> Option<String> {
    let Value::Object(map) = entry else {
        return Some("not an object".to_owned());
    };
    let id = text_field(map.get("id"));
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Some("bad id".to_owned());
    }
    if !truthy(map.get("name")) {
        return Some("no name".to_owned());
    }
    let kind = map.get("kind").and_then(Value::as_str);
    if !matches!(kind, Some("cloud" | "local" | "account")) {
        return Some("bad kind".to_owned());
    }
    if !map
        .get("protocol")
        .and_then(Value::as_str)
        .is_some_and(|p| PROTOCOLS.contains(&p))
    {
        return Some("bad protocol".to_owned());
    }
    let auth = map.get("auth").and_then(Value::as_str);
    if !auth.is_some_and(|a| AUTHS.contains(&a)) {
        return Some("bad auth".to_owned());
    }
    if let Some(vendor) = map.get("vendor")
        && !vendor.as_str().is_some_and(|v| VENDORS.contains(&v))
    {
        return Some("bad vendor".to_owned());
    }
    if (kind == Some("account")) != (auth == Some("account")) {
        return Some("account auth outside an account".to_owned());
    }
    if kind == Some("account") && truthy(map.get("baseUrl")) {
        return Some("account with a baseUrl".to_owned());
    }
    if truthy(map.get("baseUrl")) {
        let text = to_string(&map["baseUrl"]);
        let Ok(url) = Url::parse(&text) else {
            return Some("bad baseUrl".to_owned());
        };
        if url.query().is_some_and(|query| !query.is_empty())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Some("baseUrl carries a query or credentials".to_owned());
        }
        if kind == Some("cloud") && url.scheme() != "https" {
            return Some("cloud baseUrl is not https".to_owned());
        }
        if kind == Some("local") && url.host_str() != Some("127.0.0.1") {
            return Some("local baseUrl is not loopback".to_owned());
        }
    } else if id != "custom" && kind != Some("account") {
        return Some("no baseUrl".to_owned());
    }
    for pattern in map
        .get("noisePatterns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if compile(&to_string(pattern)).is_none() {
            return Some("bad noise pattern".to_owned());
        }
    }
    for pattern in map
        .get("capabilityPatterns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let source = match pattern.get("match") {
            None => String::new(),
            Some(value) => to_string(value),
        };
        if compile(&source).is_none() {
            return Some("bad pattern".to_owned());
        }
        let capabilities = pattern
            .get("capabilities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !capabilities
            .iter()
            .all(|c| c.as_str().is_some_and(|c| CAPABILITIES.contains(&c)))
        {
            return Some("unknown capability".to_owned());
        }
    }
    if !map.get("defaultModels").is_some_and(Value::is_array) {
        return Some("bad defaultModels".to_owned());
    }
    None
}

/// Tools, vision, thinking and the window for a model, by the first pattern its id matches.
pub fn capabilities_for(entry: Option<&CatalogEntry>, model_id: &str) -> Capabilities {
    let Some(entry) = entry else {
        return Capabilities::default();
    };
    entry
        .capability_patterns
        .iter()
        .flatten()
        .find(|pattern| {
            compile(&pattern.pattern).is_some_and(|re| re.is_match(model_id).unwrap_or(false))
        })
        .map(|pattern| Capabilities {
            capabilities: pattern.capabilities.clone(),
            context_length: pattern.context_length,
            max_output_tokens: pattern.max_output_tokens,
        })
        .unwrap_or_default()
}

/// Ids that are not chat models. Shared with `autoPin.cjs`, which skips them when a listing adds models.
pub const NOISE: [&str; 5] = [
    "(^|[-_/.:])(embed|embedding|embeddings|embedqa)([-_.:]|$)",
    "moderation|guard",
    "(^|[-_/.])(tts|whisper|transcribe|speech|stt)([-_.]|$)",
    "image|dall-e|imagen|veo|sora|lyria|diffusion",
    "audio|realtime|rerank",
];

/// The shared noise list followed by the entry's own `noisePatterns`.
pub fn noise_patterns(entry: Option<&CatalogEntry>) -> Vec<String> {
    NOISE
        .iter()
        .map(|pattern| (*pattern).to_owned())
        .chain(
            entry
                .and_then(|e| e.noise_patterns.clone())
                .unwrap_or_default(),
        )
        .collect()
}

/// A JavaScript pattern compiled case-insensitively. Lookaround and backreferences work, as they do in JavaScript.
pub(crate) fn compile(source: &str) -> Option<Regex> {
    Regex::new(&format!("(?i){source}")).ok()
}

/// `value || ""` read as text, for the id check.
fn text_field(value: Option<&Value>) -> String {
    match value {
        Some(value) if truthy(Some(value)) => to_string(value),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_list_loads_every_entry() {
        assert_eq!(Catalog::bundled().entries().len(), 40);
    }

    #[test]
    fn every_bundled_entry_passes_the_bar() {
        for entry in Catalog::bundled().entries() {
            let value = serde_json::to_value(entry).unwrap_or(Value::Null);
            assert_eq!(problem_with(&value), None, "{}", entry.id);
        }
    }
}
