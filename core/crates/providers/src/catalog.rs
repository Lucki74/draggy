//! The providers Draggy knows how to reach.
//! A local server's address is its default and may be changed per instance.

use fancy_regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::Url;

use crate::js::{to_string, truthy};

const BUNDLED: &str = include_str!("bundled_catalog.json");
const VENDORS: [&str; 3] = ["openai", "anthropic", "google"];
const PROTOCOLS: [&str; 6] = ["openai", "ollama", "anthropic", "gemini", "codex", "claude"];
const AUTHS: [&str; 5] = ["bearer", "x-api-key", "x-goog-api-key", "account", "none"];
const CAPABILITIES: [&str; 3] = ["tools", "vision", "thinking"];
const IMAGE_PROTOCOLS: [&str; 5] = [
    "openai-images",
    "gemini",
    "openrouter-images",
    "flux",
    "hf-inference",
];
const SPEECH_PROTOCOLS: [&str; 2] = ["openai-speech", "gemini-tts"];

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
    /// Image-generation endpoint and its default image models. Absent for providers without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageCapability>,
    /// Text-to-speech endpoint and the models with their voices. Absent for providers without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech: Option<SpeechCapability>,
}

/// The `image` block: `{"protocol": "openai-images", "defaultModels": ["gpt-image-..."]}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCapability {
    pub protocol: String,
    #[serde(default)]
    pub default_models: Vec<String>,
}

/// The `speech` block: `{"protocol": "openai-speech", "models": [{"id": "...", "voices": ["..."]}]}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCapability {
    pub protocol: String,
    #[serde(default)]
    pub models: Vec<SpeechModel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModel {
    pub id: String,
    #[serde(default)]
    pub voices: Vec<String>,
}

impl CatalogEntry {
    pub fn image_protocol(&self) -> Option<&str> {
        self.image.as_ref().map(|image| image.protocol.as_str())
    }

    pub fn image_default_models(&self) -> &[String] {
        self.image
            .as_ref()
            .map_or(&[], |image| image.default_models.as_slice())
    }

    pub fn speech_protocol(&self) -> Option<&str> {
        self.speech.as_ref().map(|speech| speech.protocol.as_str())
    }

    pub fn speech_models(&self) -> &[SpeechModel] {
        self.speech
            .as_ref()
            .map_or(&[], |speech| speech.models.as_slice())
    }

    /// The voices a speech model offers, or an empty list when the model is not in the block.
    pub fn speech_voices(&self, model_id: &str) -> &[String] {
        self.speech_models()
            .iter()
            .find(|model| model.id == model_id)
            .map_or(&[], |model| model.voices.as_slice())
    }
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

    /// Entries that carry an image block.
    pub fn image_entries(&self) -> impl Iterator<Item = &CatalogEntry> {
        self.entries.iter().filter(|entry| entry.image.is_some())
    }

    /// Entries that carry a speech block.
    pub fn speech_entries(&self) -> impl Iterator<Item = &CatalogEntry> {
        self.entries.iter().filter(|entry| entry.speech.is_some())
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
    if let Some(image) = map.get("image")
        && !image
            .get("protocol")
            .and_then(Value::as_str)
            .is_some_and(|p| IMAGE_PROTOCOLS.contains(&p))
    {
        return Some("bad image protocol".to_owned());
    }
    if let Some(speech) = map.get("speech")
        && !speech
            .get("protocol")
            .and_then(Value::as_str)
            .is_some_and(|p| SPEECH_PROTOCOLS.contains(&p))
    {
        return Some("bad speech protocol".to_owned());
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

/// Ids that are not chat models and are dropped from listings: embeddings, moderation, speech-to-text, video, music, realtime.
pub const NOISE: [&str; 4] = [
    "(^|[-_/.:])(embed|embedding|embeddings|embedqa)([-_.:]|$)",
    "moderation|guard",
    "(^|[-_/.])(whisper|transcribe|stt)([-_.]|$)",
    "audio|realtime|rerank|veo|sora|lyria",
];

/// Image-generation ids. Kept from listings and tagged `image`.
pub const IMAGE_MODELS: &str = "image|dall-e|imagen|diffusion|flux|seedream|ideogram";

/// Text-to-speech ids. Kept from listings and tagged `speech`.
pub const SPEECH_MODELS: &str = "(^|[-_/.:])(tts|speech|orpheus|kokoro|sonic)([-_.:]|$)";

/// What a listed id is. Only `Chat` belongs in chat pickers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    Chat,
    Image,
    Speech,
    Noise,
}

impl ModelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelKind::Chat => "chat",
            ModelKind::Image => "image",
            ModelKind::Speech => "speech",
            ModelKind::Noise => "noise",
        }
    }
}

/// Classifies a listed id. Noise is checked first, then image, then speech; anything else is chat.
pub fn model_kind(entry: Option<&CatalogEntry>, model_id: &str) -> ModelKind {
    if chat_noise_patterns(entry)
        .iter()
        .any(|pattern| matches_id(pattern, model_id))
    {
        ModelKind::Noise
    } else if matches_id(IMAGE_MODELS, model_id) {
        ModelKind::Image
    } else if matches_id(SPEECH_MODELS, model_id) {
        ModelKind::Speech
    } else {
        ModelKind::Chat
    }
}

fn matches_id(pattern: &str, model_id: &str) -> bool {
    compile(pattern).is_some_and(|re| re.is_match(model_id).unwrap_or(false))
}

/// The shared noise list followed by the entry's own `noisePatterns`: everything that is not chat.
fn chat_noise_patterns(entry: Option<&CatalogEntry>) -> Vec<String> {
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

/// Patterns that keep a listed id out of the auto-pinned chat menu: the chat noise plus image and speech ids.
pub fn noise_patterns(entry: Option<&CatalogEntry>) -> Vec<String> {
    let mut patterns = chat_noise_patterns(entry);
    patterns.push(IMAGE_MODELS.to_owned());
    patterns.push(SPEECH_MODELS.to_owned());
    patterns
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
    use serde_json::json;

    fn base_entry() -> Value {
        json!({
            "id": "x", "name": "X", "kind": "cloud", "protocol": "openai",
            "auth": "bearer", "baseUrl": "https://x.example/v1", "defaultModels": []
        })
    }

    #[test]
    fn an_entry_without_capability_blocks_still_loads() {
        let entry: CatalogEntry = serde_json::from_value(base_entry()).unwrap();
        assert!(entry.image.is_none() && entry.speech.is_none());
        assert_eq!(entry.image_protocol(), None);
        assert!(entry.image_default_models().is_empty());
        assert!(entry.speech_voices("tts-x").is_empty());
        assert_eq!(problem_with(&base_entry()), None);
    }

    #[test]
    fn capability_blocks_parse_and_expose_accessors() {
        let catalog = Catalog::bundled();
        let openai = catalog.find("openai").unwrap();
        assert_eq!(openai.image_protocol(), Some("openai-images"));
        assert!(
            openai
                .image_default_models()
                .contains(&"gpt-image-2.6-flare".to_owned())
        );
        assert_eq!(openai.speech_protocol(), Some("openai-speech"));
        assert_eq!(openai.speech_voices("gpt-4o-mini-tts").len(), 13);
        assert!(openai.speech_voices("missing").is_empty());
        let gemini = catalog.find("gemini").unwrap();
        assert_eq!(gemini.speech_protocol(), Some("gemini-tts"));
        assert_eq!(gemini.speech_voices("gemini-2.5-pro-preview-tts").len(), 30);
        assert!(catalog.find("anthropic").unwrap().image.is_none());
        assert!(catalog.image_entries().any(|e| e.id == "openrouter"));
        assert!(catalog.speech_entries().all(|e| e.speech.is_some()));
    }

    #[test]
    fn an_unknown_capability_protocol_is_refused() {
        let mut bad = base_entry();
        bad["image"] = json!({ "protocol": "nope", "defaultModels": [] });
        assert_eq!(problem_with(&bad), Some("bad image protocol".to_owned()));
        let mut bad_speech = base_entry();
        bad_speech["speech"] = json!({ "protocol": "nope", "models": [] });
        assert_eq!(
            problem_with(&bad_speech),
            Some("bad speech protocol".to_owned())
        );
    }

    #[test]
    fn the_filter_tags_images_and_speech_and_drops_other_noise() {
        assert_eq!(model_kind(None, "gpt-image-2.6-flare"), ModelKind::Image);
        assert_eq!(model_kind(None, "gemini-3.1-flash-image"), ModelKind::Image);
        assert_eq!(model_kind(None, "gpt-4o-mini-tts"), ModelKind::Speech);
        assert_eq!(
            model_kind(None, "gemini-2.5-pro-preview-tts"),
            ModelKind::Speech
        );
        assert_eq!(
            model_kind(None, "canopylabs/orpheus-v1-english"),
            ModelKind::Speech
        );
        assert_eq!(model_kind(None, "text-embedding-3-small"), ModelKind::Noise);
        assert_eq!(model_kind(None, "omni-moderation-latest"), ModelKind::Noise);
        assert_eq!(model_kind(None, "whisper-1"), ModelKind::Noise);
        assert_eq!(model_kind(None, "gpt-4o-transcribe"), ModelKind::Noise);
        assert_eq!(model_kind(None, "veo-3"), ModelKind::Noise);
        assert_eq!(model_kind(None, "gpt-5.5"), ModelKind::Chat);
        assert_eq!(model_kind(None, "grok-4.7"), ModelKind::Chat);
    }

    #[test]
    fn chat_pickers_still_exclude_images_and_speech() {
        assert!(crate::autopin::is_noise(None, "gpt-image-2.6-flare", &[]));
        assert!(crate::autopin::is_noise(None, "gpt-4o-mini-tts", &[]));
        assert!(!crate::autopin::is_noise(None, "gpt-5.5", &[]));
    }

    #[test]
    fn bundled_list_loads_every_entry() {
        assert_eq!(Catalog::bundled().entries().len(), 39);
    }

    #[test]
    fn every_bundled_entry_passes_the_bar() {
        for entry in Catalog::bundled().entries() {
            let value = serde_json::to_value(entry).unwrap_or(Value::Null);
            assert_eq!(problem_with(&value), None, "{}", entry.id);
        }
    }
}
