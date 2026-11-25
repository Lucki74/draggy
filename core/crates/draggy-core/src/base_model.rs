//! Twin of `app/src/stats/baseModel.ts`: turns a local model into the OpenRouter id it is built on, so a local turn is
//! priced by what its own model costs. Both are held to `shared/fixtures/base-model/cases.json`.

use draggy_providers::types::TokenUsage;

use crate::cost::{PassUsageRecord, bundled_table, cost_of_passes};

/// Words that describe how a model was tuned, not what it is.
const TAGS: [&str; 11] = [
    "instruct",
    "it",
    "chat",
    "preview",
    "base",
    "abliterated",
    "uncensored",
    "thinking",
    "reasoning",
    "heretic",
    "latest",
];

/// What a model is, once its publisher, quantization and tuning tags are gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub family: String,
    pub version: String,
    pub size: String,
    pub active: String,
    pub variant: String,
}

/// `\d+(\.\d+)?`
fn is_number(text: &str) -> bool {
    let mut parts = text.splitn(2, '.');
    let whole = parts.next().unwrap_or("");
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    digits(whole) && parts.next().is_none_or(digits)
}

/// `i?q\d[a-z0-9_]*|bf16|f16|fp16|f32|mxfp4|int[48]`
fn is_quant(text: &str) -> bool {
    if matches!(
        text,
        "bf16" | "f16" | "fp16" | "f32" | "mxfp4" | "int4" | "int8"
    ) {
        return true;
    }
    let rest = text.strip_prefix('i').unwrap_or(text);
    let Some(rest) = rest.strip_prefix('q') else {
        return false;
    };
    let mut bytes = rest.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_digit())
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Removes one `[-_](ud[-_])?<quant>` suffix, the leftmost that reaches the end.
fn strip_quant(text: &str) -> Option<&str> {
    for (at, separator) in text.char_indices() {
        if separator != '-' && separator != '_' {
            continue;
        }
        let tail = &text[at + 1..];
        let tail = tail
            .strip_prefix("ud-")
            .or_else(|| tail.strip_prefix("ud_"))
            .filter(|rest| is_quant(rest))
            .unwrap_or(tail);
        if is_quant(tail) {
            return Some(&text[..at]);
        }
    }
    None
}

/// `[-_]gguf\b` removed wherever it appears.
fn drop_gguf_words(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("gguf") {
        let before = rest[..at].chars().last();
        let after = rest[at + 4..].chars().next();
        let bounded = after.is_none_or(|next| !(next.is_alphanumeric() || next == '_'));
        if matches!(before, Some('-' | '_')) && bounded {
            out.push_str(&rest[..at - 1]);
        } else {
            out.push_str(&rest[..at + 4]);
        }
        rest = &rest[at + 4..];
    }
    out.push_str(rest);
    out
}

/// The words of a model name with the publisher, file wrapper, quantization suffix and tuning tags removed.
fn name_tokens(name: &str) -> Vec<String> {
    let lowered = name.trim().to_lowercase();
    let mut text = lowered.strip_prefix("gguf:").unwrap_or(&lowered);
    if let Some(colon) = text.find(':') {
        text = &text[..colon];
    }
    text = &text[text.rfind('/').map_or(0, |slash| slash + 1)..];
    let text = text.strip_suffix(".gguf").unwrap_or(text);
    let mut text = drop_gguf_words(text);
    while let Some(shorter) = strip_quant(&text) {
        text = shorter.to_owned();
    }
    text.split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter(|token| !token.is_empty() && !TAGS.contains(token))
        .map(str::to_owned)
        .collect()
}

/// The family, version, size and variant a model name describes, or none when it names no family.
pub fn signature_of(name: &str) -> Option<Signature> {
    let tokens = name_tokens(name);
    let head = tokens.first()?;
    let letters = head.bytes().take_while(u8::is_ascii_lowercase).count();
    let (family, tail) = head.split_at(letters);
    if family.is_empty() || !(tail.is_empty() || is_number(tail)) {
        return None;
    }
    let mut version = tail.to_owned();
    let mut rest = &tokens[1..];
    if version.is_empty()
        && let Some(first) = rest.first()
        && is_number(first)
    {
        version = first.clone();
        rest = &rest[1..];
    }
    let (mut size, mut active) = (String::new(), String::new());
    let mut variant: Vec<&str> = Vec::new();
    for token in rest {
        let sized = token.strip_suffix('b');
        let activated = token
            .strip_prefix('a')
            .and_then(|inner| inner.strip_suffix('b'));
        if size.is_empty() && sized.is_some_and(is_number) {
            size = sized.unwrap_or_default().to_owned();
        } else if active.is_empty() && activated.is_some_and(is_number) {
            active = activated.unwrap_or_default().to_owned();
        } else if token.bytes().all(|byte| byte.is_ascii_digit()) {
            // Release dates such as 2507.
        } else {
            variant.push(token);
        }
    }
    variant.sort_unstable();
    Some(Signature {
        family: family.to_owned(),
        version,
        size,
        active,
        variant: variant.join("-"),
    })
}

/// The id a model name matches exactly, the shortest one when several do. Dated and batch variants lose to the plain id.
fn match_id<'a>(name: &str, ids: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let wanted = signature_of(name)?;
    let mut best: Option<&str> = None;
    for id in ids {
        if id.contains(':') || signature_of(id).as_ref() != Some(&wanted) {
            continue;
        }
        if best.is_none_or(|kept| id.len() < kept.len() || (id.len() == kept.len() && id < kept)) {
            best = Some(id);
        }
    }
    best
}

/// The OpenRouter id for a local model name: the base model its metadata names (followed to the root), then the name.
pub fn resolve_base_model<'a>(
    name: &str,
    ids: &[&'a str],
    base_model_of: impl Fn(&str) -> Option<String>,
) -> Option<&'a str> {
    let mut root = name.to_owned();
    let mut seen = vec![name.to_owned()];
    for _ in 0..8 {
        let Some(next) = base_model_of(&root) else {
            break;
        };
        if seen.contains(&next) {
            break;
        }
        seen.push(next.clone());
        root = next;
    }
    if root != name
        && let Some(found) = match_id(&root, ids.iter().copied())
    {
        return Some(found);
    }
    match_id(name, ids.iter().copied())
}

/// What a local turn would have cost on the cloud model it is built on. Both fields are none when the model is unknown.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct LocalPriceRecord {
    pub micros: Option<i64>,
    /// The OpenRouter id the turn was priced as.
    pub price_id: Option<String>,
}

/// Prices a local turn by its own base model, read from its name.
#[uniffi::export]
pub fn price_local_reply(model: String, passes: Vec<PassUsageRecord>) -> LocalPriceRecord {
    let unknown = LocalPriceRecord {
        micros: None,
        price_id: None,
    };
    let Some(routed) = bundled_table().and_then(|table| table.providers.get("openrouter")) else {
        return unknown;
    };
    let ids: Vec<&str> = routed.keys().map(String::as_str).collect();
    let Some(id) = resolve_base_model(&model, &ids, |_| None) else {
        return unknown;
    };
    let usage: Vec<TokenUsage> = passes.iter().map(TokenUsage::from).collect();
    match cost_of_passes(&usage, routed.get(id)).micros {
        Some(micros) => LocalPriceRecord {
            micros: Some(micros),
            price_id: Some(id.to_owned()),
        },
        None => unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::collections::HashMap;

    #[test]
    fn shared_cases_resolve_like_the_typescript_twin() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../shared/fixtures/base-model/cases.json"
        );
        let fixture: Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("fixture")).expect("json");
        let table = bundled_table().expect("table");
        let ids: Vec<&str> = table.providers["openrouter"]
            .keys()
            .map(String::as_str)
            .collect();
        for case in fixture["cases"].as_array().expect("cases") {
            let name = case["name"].as_str().expect("name");
            let metadata: HashMap<String, String> =
                serde_json::from_value(case["metadata"].clone()).expect("metadata");
            let found = resolve_base_model(name, &ids, |repo| metadata.get(repo).cloned());
            assert_eq!(found, case["expected"].as_str(), "{name}");
        }
    }

    #[test]
    fn reads_family_version_size_and_active_size() {
        assert_eq!(
            signature_of("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"),
            Some(Signature {
                family: "qwen".into(),
                version: "3.6".into(),
                size: "35".into(),
                active: "3".into(),
                variant: String::new(),
            })
        );
    }

    #[test]
    fn a_known_local_model_is_priced_and_an_unknown_one_is_not() {
        let pass = PassUsageRecord {
            input: 1_000_000,
            cache_read: 0,
            cache_write: 0,
            output: 0,
            reasoning: 0,
            estimated: false,
            cost_usd: None,
        };
        let known = price_local_reply("Qwen3.6-35B-A3B:UD-Q4_K_XL".into(), vec![pass.clone()]);
        assert_eq!(known.price_id.as_deref(), Some("qwen/qwen3.6-35b-a3b"));
        assert!(known.micros.is_some());
        let unknown = price_local_reply("Diffuspace/Clover-35B-A3B-Preview".into(), vec![pass]);
        assert_eq!(
            unknown,
            LocalPriceRecord {
                micros: None,
                price_id: None
            }
        );
    }
}
