//! The API's own settings: the saved JSON read into checked values, and the pure steps that apply them to a request.
//!
//! Every field is clamped when read, so a hand-edited or stale file never yields a value the server cannot use.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{Map, Value, json};

pub const MAX_PARALLEL_RANGE: (u64, u64) = (1, 16);
pub const QUEUE_WAIT_RANGE: (u64, u64) = (0, 600);
pub const REQUEST_TIMEOUT_RANGE: (u64, u64) = (10, 3600);
pub const MAX_BODY_MB_RANGE: (u64, u64) = (1, 64);
pub const LOG_SIZE_RANGE: (u64, u64) = (10, 500);
pub const DEFAULT_LOG_SIZE: u64 = 50;
pub const DEFAULT_MAX_PARALLEL: u64 = 2;
pub const DEFAULT_QUEUE_WAIT_SECS: u64 = 60;
pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 600;
pub const DEFAULT_MAX_BODY_MB: u64 = 32;

/// Longest model name or alias side kept.
const NAME_LIMIT: usize = 512;
/// Most aliases kept.
const ALIAS_LIMIT: usize = 64;
/// Longest system prompt kept, in bytes.
pub const SYSTEM_PROMPT_LIMIT: usize = 32 * 1024;
/// Longest extra engine argument line kept, in bytes.
pub const ENGINE_ARGS_LIMIT: usize = 4 * 1024;

/// Defaults filled into a model-mode body. A field left `None` is not touched.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Sampling {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<u64>,
    pub min_p: Option<f64>,
    pub repeat_penalty: Option<f64>,
    pub max_tokens: Option<u64>,
    pub seed: Option<i64>,
    /// Replace what the client sent instead of only filling what it left out.
    pub override_client: bool,
}

/// Everything the settings page can change, checked. `Default` is what a new install runs with.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiSettings {
    pub max_parallel: usize,
    pub queue_wait_secs: u64,
    pub request_timeout_secs: u64,
    pub max_body_mb: u64,
    /// Empty means the model Draggy is using.
    pub default_model: String,
    /// Client model name to the model that answers it.
    pub aliases: BTreeMap<String, String>,
    pub list_cloud_models: bool,
    pub agent_web_tools: bool,
    pub system_prompt: String,
    pub send_reasoning: bool,
    pub sampling: Sampling,
    pub extra_engine_args: String,
    /// Browser origins that may call the API, matched exactly. Never `*`.
    pub allowed_origins: Vec<String>,
    /// Let the Ollama routes under `/api/` skip the key.
    pub ollama_no_key: bool,
    /// Keep a short in-memory list of recent requests.
    pub log_requests: bool,
    pub log_size: u64,
}

impl Default for ApiSettings {
    fn default() -> Self {
        Self {
            max_parallel: DEFAULT_MAX_PARALLEL as usize,
            queue_wait_secs: DEFAULT_QUEUE_WAIT_SECS,
            request_timeout_secs: DEFAULT_REQUEST_TIMEOUT_SECS,
            max_body_mb: DEFAULT_MAX_BODY_MB,
            default_model: String::new(),
            aliases: BTreeMap::new(),
            list_cloud_models: true,
            agent_web_tools: true,
            system_prompt: String::new(),
            send_reasoning: true,
            sampling: Sampling::default(),
            extra_engine_args: String::new(),
            allowed_origins: Vec::new(),
            ollama_no_key: false,
            log_requests: true,
            log_size: DEFAULT_LOG_SIZE,
        }
    }
}

impl ApiSettings {
    /// Reads the saved object. A missing or wrongly typed field takes its default, a number outside its range the nearest end.
    pub fn from_value(value: &Value) -> Self {
        let defaults = Self::default();
        let sampling = value.get("sampling").unwrap_or(&Value::Null);
        Self {
            max_parallel: whole(
                value,
                "maxParallel",
                MAX_PARALLEL_RANGE,
                DEFAULT_MAX_PARALLEL,
            ) as usize,
            queue_wait_secs: whole(
                value,
                "queueWaitSecs",
                QUEUE_WAIT_RANGE,
                DEFAULT_QUEUE_WAIT_SECS,
            ),
            request_timeout_secs: whole(
                value,
                "requestTimeoutSecs",
                REQUEST_TIMEOUT_RANGE,
                DEFAULT_REQUEST_TIMEOUT_SECS,
            ),
            max_body_mb: whole(value, "maxBodyMb", MAX_BODY_MB_RANGE, DEFAULT_MAX_BODY_MB),
            default_model: text(value, "defaultModel", NAME_LIMIT),
            aliases: aliases(value.get("aliases")),
            list_cloud_models: flag(value, "listCloudModels", defaults.list_cloud_models),
            agent_web_tools: flag(value, "agentWebTools", defaults.agent_web_tools),
            system_prompt: cap_bytes(
                value
                    .get("systemPrompt")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                SYSTEM_PROMPT_LIMIT,
            ),
            send_reasoning: flag(value, "sendReasoning", defaults.send_reasoning),
            sampling: Sampling {
                temperature: float(sampling, "temperature", 0.0, 2.0),
                top_p: float(sampling, "top_p", 0.0, 1.0),
                top_k: whole_opt(sampling, "top_k", 0, 1000),
                min_p: float(sampling, "min_p", 0.0, 1.0),
                repeat_penalty: float(sampling, "repeat_penalty", 0.0, 2.0),
                max_tokens: whole_opt(sampling, "max_tokens", 1, 1_000_000),
                seed: sampling.get("seed").and_then(Value::as_i64),
                override_client: flag(sampling, "overrideClient", false),
            },
            extra_engine_args: cap_bytes(
                value
                    .get("extraEngineArgs")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                ENGINE_ARGS_LIMIT,
            ),
            allowed_origins: origins(value.get("allowedOrigins")),
            ollama_no_key: flag(value, "ollamaNoKey", defaults.ollama_no_key),
            log_requests: flag(value, "logRequests", defaults.log_requests),
            log_size: whole(value, "logSize", LOG_SIZE_RANGE, DEFAULT_LOG_SIZE),
        }
    }

    /// The saved shape: camelCase, `sampling` holding only the values that are set.
    pub fn to_value(&self) -> Value {
        let mut sampling = Map::new();
        let s = &self.sampling;
        if let Some(v) = s.temperature {
            sampling.insert("temperature".into(), json!(v));
        }
        if let Some(v) = s.top_p {
            sampling.insert("top_p".into(), json!(v));
        }
        if let Some(v) = s.top_k {
            sampling.insert("top_k".into(), json!(v));
        }
        if let Some(v) = s.min_p {
            sampling.insert("min_p".into(), json!(v));
        }
        if let Some(v) = s.repeat_penalty {
            sampling.insert("repeat_penalty".into(), json!(v));
        }
        if let Some(v) = s.max_tokens {
            sampling.insert("max_tokens".into(), json!(v));
        }
        if let Some(v) = s.seed {
            sampling.insert("seed".into(), json!(v));
        }
        sampling.insert("overrideClient".into(), json!(s.override_client));
        json!({
            "maxParallel": self.max_parallel,
            "queueWaitSecs": self.queue_wait_secs,
            "requestTimeoutSecs": self.request_timeout_secs,
            "maxBodyMb": self.max_body_mb,
            "defaultModel": self.default_model,
            "aliases": self.aliases,
            "listCloudModels": self.list_cloud_models,
            "agentWebTools": self.agent_web_tools,
            "systemPrompt": self.system_prompt,
            "sendReasoning": self.send_reasoning,
            "sampling": sampling,
            "extraEngineArgs": self.extra_engine_args,
            "allowedOrigins": self.allowed_origins,
            "ollamaNoKey": self.ollama_no_key,
            "logRequests": self.log_requests,
            "logSize": self.log_size,
        })
    }

    /// These settings with the fields `patch` names replaced, so a call that names a few keeps the rest.
    /// In `sampling`, a key set to `null` is cleared.
    pub fn patched(&self, patch: &Value) -> Self {
        let mut merged = self.to_value();
        let (Some(target), Some(source)) = (merged.as_object_mut(), patch.as_object()) else {
            return self.clone();
        };
        for (key, value) in source {
            if key == "sampling" {
                if let (Some(current), Some(changes)) = (
                    target.get_mut("sampling").and_then(Value::as_object_mut),
                    value.as_object(),
                ) {
                    for (name, change) in changes {
                        if change.is_null() {
                            current.remove(name);
                        } else {
                            current.insert(name.clone(), change.clone());
                        }
                    }
                }
            } else if target.contains_key(key) {
                target.insert(key.clone(), value.clone());
            }
        }
        Self::from_value(&merged)
    }

    pub fn queue_wait(&self) -> Duration {
        Duration::from_secs(self.queue_wait_secs)
    }

    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_secs)
    }

    /// The most a model-mode body may weigh.
    pub fn max_body_bytes(&self) -> usize {
        (self.max_body_mb as usize) * 1024 * 1024
    }
}

/// A whole number in `range`, clamped, or `default` when the field is missing or not a number.
fn whole(value: &Value, key: &str, range: (u64, u64), default: u64) -> u64 {
    whole_opt(value, key, range.0, range.1).unwrap_or(default)
}

fn whole_opt(value: &Value, key: &str, low: u64, high: u64) -> Option<u64> {
    let number = value.get(key)?;
    let n = match number.as_u64() {
        Some(n) => n,
        None => {
            let f = number.as_f64()?;
            if !f.is_finite() {
                return None;
            }
            if f < 0.0 { 0 } else { f as u64 }
        }
    };
    Some(n.clamp(low, high))
}

fn float(value: &Value, key: &str, low: f64, high: f64) -> Option<f64> {
    let f = value.get(key)?.as_f64()?;
    f.is_finite().then(|| f.clamp(low, high))
}

fn flag(value: &Value, key: &str, default: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn text(value: &Value, key: &str, limit: usize) -> String {
    let raw = value.get(key).and_then(Value::as_str).unwrap_or("").trim();
    raw.chars().take(limit).collect()
}

/// `text` cut to at most `limit` bytes, at a character boundary.
fn cap_bytes(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

fn aliases(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(map) = value.and_then(Value::as_object) else {
        return out;
    };
    for (name, target) in map {
        let name: String = name.trim().chars().take(NAME_LIMIT).collect();
        let target: String = target
            .as_str()
            .unwrap_or("")
            .trim()
            .chars()
            .take(NAME_LIMIT)
            .collect();
        if name.is_empty() || target.is_empty() || name == target {
            continue;
        }
        out.insert(name, target);
        if out.len() >= ALIAS_LIMIT {
            break;
        }
    }
    out
}

/// Most origins kept, and the longest one.
const ORIGIN_LIMIT: usize = 32;
const ORIGIN_LENGTH: usize = 256;

/// The origins a list holds, each trimmed. An entry with a `*`, white space or no scheme is dropped, so no wildcard
/// can be saved, and repeats are removed.
fn origins(value: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in value.and_then(Value::as_array).into_iter().flatten() {
        let origin = item.as_str().unwrap_or("").trim().trim_end_matches('/');
        let valid = !origin.is_empty()
            && origin.len() <= ORIGIN_LENGTH
            && origin.contains("://")
            && !origin.contains('*')
            && !origin.chars().any(char::is_whitespace);
        if valid && !out.iter().any(|seen| seen == origin) {
            out.push(origin.to_owned());
        }
        if out.len() >= ORIGIN_LIMIT {
            break;
        }
    }
    out
}

/// The model an alias names, or `None` when `name` is not one. Names match exactly, apart from outer white space.
pub fn resolve_alias<'a>(name: &str, aliases: &'a BTreeMap<String, String>) -> Option<&'a str> {
    aliases.get(name.trim()).map(String::as_str)
}

/// Puts `prompt` first in `messages` as a system message. A body with no message list, or an empty prompt, is left alone.
pub fn prepend_system(body: &mut Value, prompt: &str) {
    if prompt.trim().is_empty() {
        return;
    }
    let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };
    if messages.is_empty() {
        return;
    }
    messages.insert(0, json!({ "role": "system", "content": prompt }));
}

/// Fills the defaults into a model-mode body. A value the client sent stays unless `override_client` is set.
pub fn apply_sampling(body: &mut Value, sampling: &Sampling) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    let mut put = |key: &str, value: Value| {
        if sampling.override_client || object.get(key).is_none_or(Value::is_null) {
            object.insert(key.to_owned(), value);
        }
    };
    if let Some(v) = sampling.temperature {
        put("temperature", json!(v));
    }
    if let Some(v) = sampling.top_p {
        put("top_p", json!(v));
    }
    if let Some(v) = sampling.top_k {
        put("top_k", json!(v));
    }
    if let Some(v) = sampling.min_p {
        put("min_p", json!(v));
    }
    if let Some(v) = sampling.repeat_penalty {
        put("repeat_penalty", json!(v));
    }
    if let Some(v) = sampling.seed {
        put("seed", json!(v));
    }
    if let Some(v) = sampling.max_tokens {
        // The newer name wins at some engines, so a replaced limit must not leave it behind.
        if sampling.override_client {
            object.remove("max_completion_tokens");
        }
        let sent = object.get("max_tokens").is_some_and(|v| !v.is_null())
            || object
                .get("max_completion_tokens")
                .is_some_and(|v| !v.is_null());
        if sampling.override_client || !sent {
            object.insert("max_tokens".to_owned(), json!(v));
        }
    }
}

/// Drops the model's reasoning text from a whole reply or one streamed chunk: `reasoning_content` and `reasoning` in each
/// choice's `message` or `delta`.
pub fn strip_reasoning(value: &mut Value) {
    let Some(choices) = value.get_mut("choices").and_then(Value::as_array_mut) else {
        return;
    };
    for choice in choices {
        for part in ["message", "delta"] {
            if let Some(object) = choice.get_mut(part).and_then(Value::as_object_mut) {
                object.remove("reasoning_content");
                object.remove("reasoning");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_settings_default_and_clamp() {
        let s = ApiSettings::default();
        assert!(s.log_requests);
        assert_eq!(s.log_size, 50);
        assert_eq!(ApiSettings::from_value(&json!({"logSize": 1})).log_size, 10);
        assert_eq!(
            ApiSettings::from_value(&json!({"logSize": 9999, "logRequests": false})).log_size,
            500
        );
    }

    #[test]
    fn empty_input_gives_the_defaults() {
        assert_eq!(ApiSettings::from_value(&json!({})), ApiSettings::default());
        assert_eq!(
            ApiSettings::from_value(&Value::Null),
            ApiSettings::default()
        );
    }

    #[test]
    fn numbers_are_clamped_to_their_ranges() {
        let s = ApiSettings::from_value(&json!({
            "maxParallel": 99, "queueWaitSecs": 9999, "requestTimeoutSecs": 1, "maxBodyMb": 0
        }));
        assert_eq!(s.max_parallel, 16);
        assert_eq!(s.queue_wait_secs, 600);
        assert_eq!(s.request_timeout_secs, 10);
        assert_eq!(s.max_body_mb, 1);
        let s = ApiSettings::from_value(
            &json!({ "maxParallel": 0, "queueWaitSecs": -5, "maxBodyMb": 500 }),
        );
        assert_eq!(s.max_parallel, 1);
        assert_eq!(s.queue_wait_secs, 0);
        assert_eq!(s.max_body_mb, 64);
    }

    #[test]
    fn wrong_types_fall_back_to_the_defaults() {
        let s = ApiSettings::from_value(&json!({
            "maxParallel": "3", "listCloudModels": "no", "agentWebTools": 0, "sendReasoning": null, "aliases": [1]
        }));
        assert_eq!(s, ApiSettings::default());
    }

    #[test]
    fn fractional_counts_round_down() {
        let s = ApiSettings::from_value(&json!({ "maxParallel": 3.9 }));
        assert_eq!(s.max_parallel, 3);
    }

    #[test]
    fn sampling_values_are_clamped_and_unset_ones_stay_none() {
        let s = ApiSettings::from_value(&json!({
            "sampling": { "temperature": 7, "top_p": -1, "top_k": 5000, "max_tokens": 0, "seed": -3, "overrideClient": true }
        }));
        assert_eq!(s.sampling.temperature, Some(2.0));
        assert_eq!(s.sampling.top_p, Some(0.0));
        assert_eq!(s.sampling.top_k, Some(1000));
        assert_eq!(s.sampling.max_tokens, Some(1));
        assert_eq!(s.sampling.seed, Some(-3));
        assert_eq!(s.sampling.min_p, None);
        assert_eq!(s.sampling.repeat_penalty, None);
        assert!(s.sampling.override_client);
    }

    #[test]
    fn aliases_are_trimmed_and_junk_dropped() {
        let s = ApiSettings::from_value(&json!({
            "aliases": { " gpt-4o ": " qwen.gguf ", "": "x", "same": "same", "empty": "", "num": 4 }
        }));
        assert_eq!(s.aliases.len(), 1);
        assert_eq!(resolve_alias("gpt-4o", &s.aliases), Some("qwen.gguf"));
        assert_eq!(resolve_alias(" gpt-4o", &s.aliases), Some("qwen.gguf"));
        assert_eq!(resolve_alias("gpt-4", &s.aliases), None);
    }

    #[test]
    fn long_text_is_capped_at_a_character_boundary() {
        let args = "é".repeat(ENGINE_ARGS_LIMIT);
        let s = ApiSettings::from_value(&json!({ "extraEngineArgs": args }));
        assert!(s.extra_engine_args.len() <= ENGINE_ARGS_LIMIT);
        assert!(s.extra_engine_args.chars().all(|c| c == 'é'));
    }

    #[test]
    fn a_partial_patch_keeps_the_saved_rest() {
        let saved = ApiSettings::from_value(&json!({
            "maxParallel": 4, "systemPrompt": "Be brief.", "sampling": { "temperature": 0.5, "top_k": 40 }
        }));
        let next =
            saved.patched(&json!({ "queueWaitSecs": 5, "sampling": { "top_k": null, "seed": 7 } }));
        assert_eq!(next.max_parallel, 4);
        assert_eq!(next.system_prompt, "Be brief.");
        assert_eq!(next.queue_wait_secs, 5);
        assert_eq!(next.sampling.temperature, Some(0.5));
        assert_eq!(next.sampling.top_k, None);
        assert_eq!(next.sampling.seed, Some(7));
    }

    #[test]
    fn a_patch_is_clamped_and_unknown_keys_ignored() {
        let next = ApiSettings::default()
            .patched(&json!({ "maxParallel": 100, "port": 1, "bogus": true }));
        assert_eq!(next.max_parallel, 16);
        assert_eq!(
            next,
            ApiSettings::default().patched(&json!({ "maxParallel": 16 }))
        );
    }

    #[test]
    fn saved_shape_reads_back_the_same() {
        let s = ApiSettings::from_value(&json!({
            "maxParallel": 3, "aliases": { "a": "b" }, "sampling": { "temperature": 0.7, "seed": 1, "overrideClient": true },
            "extraEngineArgs": "-fa on", "sendReasoning": false
        }));
        assert_eq!(ApiSettings::from_value(&s.to_value()), s);
    }

    #[test]
    fn system_prompt_goes_first() {
        let mut body = json!({ "messages": [{ "role": "user", "content": "hi" }] });
        prepend_system(&mut body, "Be brief.");
        assert_eq!(
            body["messages"][0],
            json!({ "role": "system", "content": "Be brief." })
        );
        assert_eq!(body["messages"][1]["role"], "user");
    }

    #[test]
    fn system_prompt_skips_empty_prompts_and_bad_bodies() {
        let mut body = json!({ "messages": [{ "role": "user", "content": "hi" }] });
        prepend_system(&mut body, "  ");
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(1));
        let mut none = json!({ "model": "x" });
        prepend_system(&mut none, "Be brief.");
        assert_eq!(none, json!({ "model": "x" }));
        let mut empty = json!({ "messages": [] });
        prepend_system(&mut empty, "Be brief.");
        assert_eq!(empty["messages"].as_array().map(Vec::len), Some(0));
    }

    fn all_set(override_client: bool) -> Sampling {
        Sampling {
            temperature: Some(0.2),
            top_p: Some(0.9),
            top_k: Some(40),
            min_p: Some(0.05),
            repeat_penalty: Some(1.1),
            max_tokens: Some(256),
            seed: Some(42),
            override_client,
        }
    }

    #[test]
    fn sampling_fills_what_the_client_left_out() {
        let mut body = json!({ "model": "m", "temperature": 1.0, "top_p": null });
        apply_sampling(&mut body, &all_set(false));
        assert_eq!(body["temperature"], json!(1.0));
        assert_eq!(body["top_p"], json!(0.9));
        assert_eq!(body["top_k"], json!(40));
        assert_eq!(body["min_p"], json!(0.05));
        assert_eq!(body["repeat_penalty"], json!(1.1));
        assert_eq!(body["max_tokens"], json!(256));
        assert_eq!(body["seed"], json!(42));
    }

    #[test]
    fn sampling_replaces_the_clients_values_when_asked() {
        let mut body = json!({ "temperature": 1.0, "max_completion_tokens": 9, "max_tokens": 8 });
        apply_sampling(&mut body, &all_set(true));
        assert_eq!(body["temperature"], json!(0.2));
        assert_eq!(body["max_tokens"], json!(256));
        assert!(body.get("max_completion_tokens").is_none());
    }

    #[test]
    fn a_client_limit_under_either_name_is_kept() {
        let mut body = json!({ "max_completion_tokens": 9 });
        apply_sampling(&mut body, &all_set(false));
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["max_completion_tokens"], json!(9));
    }

    #[test]
    fn sampling_with_nothing_set_changes_nothing() {
        let mut body = json!({ "temperature": 1.0 });
        apply_sampling(
            &mut body,
            &Sampling {
                override_client: true,
                ..Sampling::default()
            },
        );
        assert_eq!(body, json!({ "temperature": 1.0 }));
    }

    #[test]
    fn reasoning_is_stripped_from_replies_and_chunks() {
        let mut whole =
            json!({ "choices": [{ "message": { "content": "a", "reasoning_content": "t" } }] });
        strip_reasoning(&mut whole);
        assert_eq!(whole["choices"][0]["message"], json!({ "content": "a" }));
        let mut chunk =
            json!({ "choices": [{ "delta": { "reasoning_content": "t", "reasoning": "t" } }] });
        strip_reasoning(&mut chunk);
        assert_eq!(chunk["choices"][0]["delta"], json!({}));
        let mut other = json!({ "error": { "message": "x" } });
        strip_reasoning(&mut other);
        assert_eq!(other, json!({ "error": { "message": "x" } }));
    }
}
