//! Turns LiteLLM's and OpenRouter's public price lists into the table Draggy prices replies from. Port of
//! electron/pricing/build.cjs.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

pub const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
pub const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/models";

/// LiteLLM's provider name for each Draggy catalog id that has a public per-token price.
const LITELLM_PROVIDERS: &[(&str, &str)] = &[
    ("openai", "openai"),
    ("anthropic", "anthropic"),
    ("gemini", "gemini"),
    ("xai", "xai"),
    ("deepseek", "deepseek"),
    ("mistral", "mistral"),
    ("groq", "groq"),
    ("cerebras", "cerebras"),
    ("together_ai", "together"),
    ("fireworks_ai", "fireworks"),
    ("nebius", "nebius"),
    ("sambanova", "sambanova"),
    ("novita", "novita"),
    ("dashscope", "qwen"),
    ("moonshot", "moonshot"),
    ("zai", "zai"),
    ("minimax", "minimax"),
    ("cohere_chat", "cohere"),
    ("cohere", "cohere"),
    ("nvidia_nim", "nvidia"),
];

const PER_M: f64 = 1_000_000.0;

/// Per-token dollars to per-million dollars, rounded to ten significant digits as `toPrecision(10)` does.
pub fn per_million(per_token: f64) -> f64 {
    format!("{:.9e}", per_token * PER_M)
        .parse()
        .unwrap_or(f64::NAN)
}

/// A number that is finite and not negative.
fn price_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n >= 0.0)
}

/// Rate fields a price has, from `per_million` of a per-token field when it is a number.
fn rate(entry: &Map<String, Value>, key: &str) -> Option<f64> {
    price_number(entry.get(key)).map(per_million)
}

/// Adds the keys that have a value, in the order given.
fn with(mut object: Map<String, Value>, fields: &[(&str, Option<f64>)]) -> Map<String, Value> {
    for (key, value) in fields {
        if let Some(value) = value {
            object.insert((*key).to_owned(), json!(value));
        }
    }
    object
}

/// `above_200k_tokens` style tiers: LiteLLM prices the whole request at the higher rate once the prompt passes the size.
fn litellm_tiers(entry: &Map<String, Value>) -> Vec<Value> {
    const BASE: &str = "input_cost_per_token_above_";
    const END: &str = "k_tokens";
    let sizes: BTreeSet<u64> = entry
        .keys()
        .filter_map(|key| key.strip_prefix(BASE)?.strip_suffix(END))
        .filter(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .filter_map(|digits| digits.parse().ok())
        .collect();
    sizes
        .into_iter()
        .map(|k| {
            let suffix = format!("_above_{k}k_tokens");
            let field = |base: &str| rate(entry, &format!("{base}{suffix}"));
            let object = with(
                Map::new(),
                &[
                    ("aboveInputTokens", Some((k * 1000) as f64)),
                    ("inputPerM", field("input_cost_per_token")),
                    ("outputPerM", field("output_cost_per_token")),
                    ("cacheReadPerM", field("cache_read_input_token_cost")),
                    ("cacheWritePerM", field("cache_creation_input_token_cost")),
                ],
            );
            Value::Object(object)
        })
        .collect()
}

/// One LiteLLM entry as a price, or none when it is not a priced chat model.
pub fn from_litellm(entry: &Value) -> Option<Value> {
    let entry = entry.as_object()?;
    if !matches!(
        entry.get("mode").and_then(Value::as_str),
        Some("chat" | "responses")
    ) {
        return None;
    }
    let input = rate(entry, "input_cost_per_token")?;
    let output = rate(entry, "output_cost_per_token")?;
    let mut price = with(
        Map::new(),
        &[
            ("inputPerM", Some(input)),
            ("outputPerM", Some(output)),
            ("cacheReadPerM", rate(entry, "cache_read_input_token_cost")),
            (
                "cacheWritePerM",
                rate(entry, "cache_creation_input_token_cost"),
            ),
            (
                "reasoningPerM",
                rate(entry, "output_cost_per_reasoning_token"),
            ),
        ],
    );
    let tiers = litellm_tiers(entry);
    if !tiers.is_empty() {
        price.insert("tiers".to_owned(), Value::Array(tiers));
    }
    Some(Value::Object(price))
}

/// A string or number read as a price. Empty and missing values are not prices.
fn read_price(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::Null => return None,
        Value::String(text) if text.is_empty() => return None,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        Value::Number(n) => n.as_f64()?,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        _ => return None,
    };
    price_number(Some(&json!(number)))
}

/// One OpenRouter model as a price. Its pricing strings are dollars per token.
pub fn from_openrouter(model: &Value) -> Option<Value> {
    let pricing = model.get("pricing")?;
    // A router whose price depends on the pick is marked -1, which is not a price.
    let input = read_price(pricing.get("prompt"))?;
    let output = read_price(pricing.get("completion"))?;
    let reasoning = read_price(pricing.get("internal_reasoning")).filter(|r| *r != 0.0);
    let per = |value: Option<f64>| value.map(per_million);
    let price = with(
        Map::new(),
        &[
            ("inputPerM", Some(per_million(input))),
            ("outputPerM", Some(per_million(output))),
            (
                "cacheReadPerM",
                per(read_price(pricing.get("input_cache_read"))),
            ),
            (
                "cacheWritePerM",
                per(read_price(pricing.get("input_cache_write"))),
            ),
            ("reasoningPerM", per(reasoning)),
        ],
    );
    Some(Value::Object(price))
}

/// The Draggy provider id and the bare model id for one LiteLLM key, or none when Draggy has no such provider.
pub fn split_litellm_key(key: &str, entry: &Value) -> Option<(&'static str, String)> {
    let source = entry.get("litellm_provider")?.as_str()?;
    let provider = LITELLM_PROVIDERS
        .iter()
        .find(|(from, _)| *from == source)?
        .1;
    let prefix = format!("{source}/");
    let id = key.strip_prefix(prefix.as_str()).unwrap_or(key);
    if id.is_empty() || id.starts_with("ft:") || id.contains('*') {
        return None;
    }
    Some((provider, id.to_owned()))
}

/// The table from both lists. `now_ms` stamps it; providers and models come out sorted.
pub fn build_table(litellm: &Value, openrouter: &Value, now_ms: i64) -> Value {
    let mut providers: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
    let mut put = |provider: &str, id: &str, price: Value| {
        providers
            .entry(provider.to_owned())
            .or_default()
            .insert(id.to_owned(), price);
    };
    if let Some(entries) = litellm.as_object() {
        for (key, entry) in entries {
            let Some((provider, id)) = split_litellm_key(key, entry) else {
                continue;
            };
            if let Some(price) = from_litellm(entry) {
                put(provider, &id, price);
            }
        }
    }
    if let Some(models) = openrouter.get("data").and_then(Value::as_array) {
        for model in models {
            let Some(id) = model.get("id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(price) = from_openrouter(model) {
                put("openrouter", id, price);
            }
        }
    }
    let providers: Map<String, Value> = providers
        .into_iter()
        .map(|(provider, models)| {
            let models: Map<String, Value> = models.into_iter().collect();
            (provider, Value::Object(models))
        })
        .collect();
    json!({
        "version": 1,
        "generatedAt": iso_utc(now_ms),
        "sources": [LITELLM_URL, OPENROUTER_URL],
        "providers": providers,
    })
}

/// `YYYY-MM-DDTHH:MM:SS.sssZ`, as `Date.prototype.toISOString` writes it.
pub fn iso_utc(ms: i64) -> String {
    let (year, month, day) = civil_from_days(ms.div_euclid(86_400_000));
    let rest = ms.rem_euclid(86_400_000);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}

/// Milliseconds since the epoch for an ISO time written by `iso_utc`, or none when it does not parse.
pub fn parse_iso_ms(text: &str) -> Option<i64> {
    let (date, time) = text.split_once('T')?;
    let time = time.strip_suffix('Z')?;
    let mut parts = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (parts.next()??, parts.next()??, parts.next()??);
    let (clock, fraction) = time.split_once('.').unwrap_or((time, "0"));
    let mut parts = clock.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hours, minutes) = (parts.next()??, parts.next()??);
    let seconds = parts.next().unwrap_or(Some(0))?;
    let millis: i64 = format!("{fraction:0<3}")
        .chars()
        .take(3)
        .collect::<String>()
        .parse()
        .ok()?;
    let days = days_from_civil(year, month, day);
    Some(days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis)
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date for a count of days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_token_becomes_per_million_without_float_noise() {
        assert_eq!(per_million(2.5e-6), 2.5);
        assert_eq!(per_million(1e-6), 1.0);
    }

    #[test]
    fn litellm_entries_need_a_chat_mode_and_two_prices() {
        let chat =
            json!({ "mode": "chat", "input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6 });
        let price = from_litellm(&chat).expect("priced");
        assert_eq!(price["inputPerM"], 1.0);
        assert_eq!(price["outputPerM"], 2.0);
        let image = json!({ "mode": "image_generation", "input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6 });
        assert!(from_litellm(&image).is_none());
    }

    #[test]
    fn litellm_tiers_are_read_in_size_order() {
        let entry = json!({
            "mode": "chat",
            "input_cost_per_token": 1e-6,
            "output_cost_per_token": 2e-6,
            "input_cost_per_token_above_200k_tokens": 3e-6,
            "output_cost_per_token_above_200k_tokens": 4e-6,
            "input_cost_per_token_above_32k_tokens": 1.5e-6,
        });
        let price = from_litellm(&entry).expect("priced");
        let tiers = price["tiers"].as_array().expect("tiers");
        assert_eq!(tiers[0]["aboveInputTokens"], 32_000.0);
        assert_eq!(tiers[1]["aboveInputTokens"], 200_000.0);
        assert_eq!(tiers[1]["inputPerM"], 3.0);
        assert_eq!(tiers[1]["outputPerM"], 4.0);
    }

    #[test]
    fn openrouter_drops_routers_priced_at_minus_one() {
        let router = json!({ "id": "auto", "pricing": { "prompt": "-1", "completion": "-1" } });
        assert!(from_openrouter(&router).is_none());
        let model = json!({ "id": "m", "pricing": { "prompt": "0.000001", "completion": "0.000002", "internal_reasoning": "0" } });
        let price = from_openrouter(&model).expect("priced");
        assert_eq!(price["inputPerM"], 1.0);
        assert!(price.get("reasoningPerM").is_none());
    }

    #[test]
    fn litellm_keys_map_to_draggy_providers() {
        let entry = json!({ "litellm_provider": "together_ai" });
        assert_eq!(
            split_litellm_key("together_ai/llama", &entry),
            Some(("together", "llama".to_owned()))
        );
        assert_eq!(
            split_litellm_key("ft:x", &json!({ "litellm_provider": "openai" })),
            None
        );
        assert_eq!(
            split_litellm_key("x", &json!({ "litellm_provider": "unknown" })),
            None
        );
    }

    #[test]
    fn builds_a_sorted_table_with_both_sources() {
        let litellm = json!({ "gpt-b": { "litellm_provider": "openai", "mode": "chat", "input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6 },
                              "gpt-a": { "litellm_provider": "openai", "mode": "chat", "input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6 } });
        let openrouter = json!({ "data": [{ "id": "vendor/m", "pricing": { "prompt": "0.000001", "completion": "0.000001" } }] });
        let table = build_table(&litellm, &openrouter, 0);
        assert_eq!(table["generatedAt"], "1970-01-01T00:00:00.000Z");
        let openai: Vec<&String> = table["providers"]["openai"]
            .as_object()
            .expect("openai")
            .keys()
            .collect();
        assert_eq!(openai, vec!["gpt-a", "gpt-b"]);
        assert!(table["providers"]["openrouter"]["vendor/m"].is_object());
    }

    #[test]
    fn iso_times_round_trip() {
        let ms = days_from_civil(2026, 10, 28) * 86_400_000 + 12 * 3_600_000 + 34 * 60_000 + 56_789;
        assert_eq!(iso_utc(ms), "2026-10-28T12:34:56.789Z");
        assert_eq!(parse_iso_ms(&iso_utc(ms)), Some(ms));
        assert_eq!(parse_iso_ms("not a date"), None);
    }
}
