//! What a reply cost, from the tokens it used and a price table. The twin of `win/src/stats/cost.ts`, held to the same
//! golden file in `shared/fixtures/cost`.
//!
//! Money is counted in micro-dollars (1e-6 USD). A rate in dollars per million tokens times a token count is already in
//! micro-dollars, so the parts add exactly and rounding happens once, on the total.

use std::collections::HashMap;
use std::sync::OnceLock;

use draggy_providers::types::TokenUsage;
use serde::{Deserialize, Serialize};

const BUNDLED: &str = include_str!("../../../../shared/pricing/prices.json");

/// Dollars per million tokens. A missing cache or reasoning rate falls back to the input or output rate.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceEntry {
    pub input_per_m: f64,
    pub output_per_m: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_per_m: Option<f64>,
    /// Rates that replace the base ones for the whole request once its prompt is larger than `above_input_tokens`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<PriceTier>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceTier {
    pub above_input_tokens: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_per_m: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceTable {
    #[serde(default)]
    pub version: f64,
    #[serde(default)]
    pub generated_at: String,
    pub providers: HashMap<String, HashMap<String, PriceEntry>>,
}

/// Who pays: `Billed` is an API key, `Account` is a plan (value shown, nothing charged), `Local` costs nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CostKind {
    Billed,
    Account,
    Local,
}

/// Micro-dollars per bucket as the table prices them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostParts {
    pub input: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub output: f64,
    pub reasoning: f64,
}

/// `Reported` is the provider's own figure, `Table` was worked out here, `Unknown` has no price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CostSource {
    Reported,
    Table,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Cost {
    /// Whole micro-dollars, or none when no price is known. Never 0 for "unknown": 0 would read as free.
    pub micros: Option<i64>,
    pub parts: Option<CostParts>,
    pub source: CostSource,
}

pub const UNKNOWN_COST: Cost = Cost {
    micros: None,
    parts: None,
    source: CostSource::Unknown,
};

/// Which price-table provider an account login is priced as (the vendor's own API list).
pub fn price_provider_of_vendor(vendor: &str) -> Option<&'static str> {
    match vendor {
        "openai" => Some("openai"),
        "anthropic" => Some("anthropic"),
        "google" => Some("gemini"),
        _ => None,
    }
}

/// How OpenRouter spells each vendor in `vendor/model` ids.
fn openrouter_vendor(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("openai"),
        "anthropic" => Some("anthropic"),
        "gemini" => Some("google"),
        "xai" => Some("x-ai"),
        "deepseek" => Some("deepseek"),
        "mistral" => Some("mistralai"),
        _ => None,
    }
}

/// The table that ships with the app. A refreshed copy, when one exists, is the caller's to load.
pub fn bundled_table() -> Option<&'static PriceTable> {
    static TABLE: OnceLock<Option<PriceTable>> = OnceLock::new();
    TABLE
        .get_or_init(|| serde_json::from_str(BUNDLED).ok())
        .as_ref()
}

/// `-YYYYMMDD`, `-YYYY-MM-DD` or `-latest` removed from the end, or none when the id has none of them.
fn strip_suffix_date(id: &str, which: usize) -> Option<&str> {
    let bytes = id.as_bytes();
    let digits = |from: usize, len: usize| {
        bytes.len() >= from + len && bytes[from..from + len].iter().all(u8::is_ascii_digit)
    };
    match which {
        0 => {
            let cut = bytes.len().checked_sub(9)?;
            (bytes[cut] == b'-' && digits(cut + 1, 8)).then(|| &id[..cut])
        }
        1 => {
            let cut = bytes.len().checked_sub(11)?;
            (bytes[cut] == b'-'
                && digits(cut + 1, 4)
                && bytes[cut + 5] == b'-'
                && digits(cut + 6, 2)
                && bytes[cut + 8] == b'-'
                && digits(cut + 9, 2))
            .then(|| &id[..cut])
        }
        _ => id.strip_suffix("-latest"),
    }
}

/// Spellings of one model id that a price table might use, most specific first.
fn candidates(provider: &str, model_id: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |id: &str| {
        if !id.is_empty() && !out.iter().any(|seen| seen == id) {
            out.push(id.to_string());
        }
    };
    let trimmed = model_id.trim();
    let id = trimmed.strip_prefix("models/").unwrap_or(trimmed);
    let lowered = id.to_lowercase();
    add(id);
    add(&lowered);
    if provider == "anthropic" {
        add(&lowered.replace('.', "-"));
    }
    if provider == "openrouter" {
        for tail in [":online", ":nitro", ":floor", ":exacto"] {
            if let Some(stripped) = id.strip_suffix(tail) {
                add(stripped);
            }
        }
    }
    for which in 0..3 {
        if let Some(stripped) = strip_suffix_date(&lowered, which) {
            add(stripped);
            if provider == "anthropic" {
                add(&stripped.replace('.', "-"));
            }
        }
    }
    out
}

/// The price of a model, or none when the table has none. A miss is never a zero price.
pub fn lookup_price<'a>(
    table: Option<&'a PriceTable>,
    provider: &str,
    model_id: &str,
) -> Option<&'a PriceEntry> {
    let table = table?;
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    let ids = candidates(provider, model_id);
    if let Some(own) = table.providers.get(provider)
        && let Some(hit) = ids.iter().find_map(|id| own.get(id))
    {
        return Some(hit);
    }
    let prefix = openrouter_vendor(provider)?;
    let routed = table.providers.get("openrouter")?;
    ids.iter()
        .find_map(|id| routed.get(&format!("{prefix}/{id}")))
}

struct Rates {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
    reasoning: f64,
}

/// The rates in force for a request whose prompt had `prompt_tokens` tokens. The highest tier it passes wins.
fn rates_for(price: &PriceEntry, prompt_tokens: f64) -> Rates {
    let mut tier: Option<&PriceTier> = None;
    for candidate in price.tiers.iter().flatten() {
        if prompt_tokens > candidate.above_input_tokens
            && tier.is_none_or(|best| candidate.above_input_tokens > best.above_input_tokens)
        {
            tier = Some(candidate);
        }
    }
    let pick =
        |field: fn(&PriceTier) -> Option<f64>, base: f64| tier.and_then(field).unwrap_or(base);
    let input = pick(|t| t.input_per_m, price.input_per_m);
    let output = pick(|t| t.output_per_m, price.output_per_m);
    Rates {
        input,
        output,
        cache_read: pick(
            |t| t.cache_read_per_m,
            price.cache_read_per_m.unwrap_or(input),
        ),
        cache_write: pick(
            |t| t.cache_write_per_m,
            price.cache_write_per_m.unwrap_or(input),
        ),
        reasoning: pick(
            |t| t.reasoning_per_m,
            price.reasoning_per_m.unwrap_or(output),
        ),
    }
}

/// `Math.round`: halves go up.
fn round_half_up(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

/// The prompt side as the context window sees it: everything the model read.
fn prompt_of(usage: &TokenUsage) -> f64 {
    (usage.input + usage.cache_read + usage.cache_write) as f64
}

/// One request. A tier applies per request, so a turn of several passes is priced pass by pass and summed.
pub fn cost_of(usage: &TokenUsage, price: Option<&PriceEntry>) -> Cost {
    let reported = usage.cost_usd.map(|usd| round_half_up(usd * 1e6));
    let Some(price) = price else {
        return match reported {
            None => UNKNOWN_COST,
            Some(micros) => Cost {
                micros: Some(micros),
                parts: None,
                source: CostSource::Reported,
            },
        };
    };
    let rates = rates_for(price, prompt_of(usage));
    let parts = CostParts {
        input: usage.input as f64 * rates.input,
        cache_read: usage.cache_read as f64 * rates.cache_read,
        cache_write: usage.cache_write as f64 * rates.cache_write,
        output: usage.output as f64 * rates.output,
        reasoning: usage.reasoning as f64 * rates.reasoning,
    };
    let total = parts.input + parts.cache_read + parts.cache_write + parts.output + parts.reasoning;
    // Six decimals first: 0.1 + 0.2 style noise must not tip a half micro-dollar the wrong way.
    let rounded = format!("{total:.6}").parse::<f64>().unwrap_or(total);
    Cost {
        micros: Some(reported.unwrap_or_else(|| round_half_up(rounded))),
        parts: Some(parts),
        source: if reported.is_none() {
            CostSource::Table
        } else {
            CostSource::Reported
        },
    }
}

/// Several passes of one turn, each priced on its own. Unknown if any pass is: a partial sum would understate.
pub fn cost_of_passes(passes: &[TokenUsage], price: Option<&PriceEntry>) -> Cost {
    if passes.is_empty() {
        return UNKNOWN_COST;
    }
    let mut micros = 0i64;
    let mut parts = CostParts::default();
    let mut any_reported = false;
    let mut all_parts = true;
    for pass in passes {
        let cost = cost_of(pass, price);
        let Some(pass_micros) = cost.micros else {
            return UNKNOWN_COST;
        };
        micros += pass_micros;
        any_reported |= cost.source == CostSource::Reported;
        match cost.parts {
            Some(each) => {
                parts.input += each.input;
                parts.cache_read += each.cache_read;
                parts.cache_write += each.cache_write;
                parts.output += each.output;
                parts.reasoning += each.reasoning;
            }
            None => all_parts = false,
        }
    }
    Cost {
        micros: Some(micros),
        parts: all_parts.then_some(parts),
        source: if any_reported {
            CostSource::Reported
        } else {
            CostSource::Table
        },
    }
}

/// Provider kind to cost kind. The built-in engine has no provider and is local.
pub fn cost_kind_of(provider_kind: Option<&str>) -> CostKind {
    match provider_kind {
        Some("cloud") => CostKind::Billed,
        Some("account") => CostKind::Account,
        _ => CostKind::Local,
    }
}

/// What one request used, as a native shell passes it in.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct PassUsageRecord {
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub output: u64,
    pub reasoning: u64,
    /// The counts were guessed from text rather than read from the provider.
    pub estimated: bool,
    /// What the provider says it charged, in dollars.
    pub cost_usd: Option<f64>,
}

/// A priced turn. `micros` is none when no price was known, which is not the same as free.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct CostRecord {
    pub micros: Option<i64>,
    /// `reported`, `table`, `estimated` or `unknown`, as the metrics table stores it.
    pub source: String,
    /// The price table's date the figure was worked out from, when it came from the table.
    pub price_updated_at: Option<String>,
}

impl From<&PassUsageRecord> for TokenUsage {
    fn from(pass: &PassUsageRecord) -> Self {
        use draggy_providers::types::UsageSource;
        Self {
            input: pass.input,
            cache_read: pass.cache_read,
            cache_write: pass.cache_write,
            output: pass.output,
            reasoning: pass.reasoning,
            source: if pass.estimated {
                UsageSource::Estimated
            } else {
                UsageSource::Reported
            },
            cost_usd: pass.cost_usd,
        }
    }
}

impl From<&TokenUsage> for PassUsageRecord {
    fn from(usage: &TokenUsage) -> Self {
        use draggy_providers::types::UsageSource;
        Self {
            input: usage.input,
            cache_read: usage.cache_read,
            cache_write: usage.cache_write,
            output: usage.output,
            reasoning: usage.reasoning,
            estimated: usage.source == UsageSource::Estimated,
            cost_usd: usage.cost_usd,
        }
    }
}

/// Prices the passes of one turn against the bundled table. `provider` is the table's provider key (see
/// `price_provider_of_vendor`) and `model_id` the provider's own id for the model.
pub fn price_passes(provider: &str, model_id: &str, passes: &[PassUsageRecord]) -> CostRecord {
    let table = bundled_table();
    let usage: Vec<TokenUsage> = passes.iter().map(TokenUsage::from).collect();
    let cost = cost_of_passes(&usage, lookup_price(table, provider, model_id));
    let estimated = cost.source == CostSource::Table && passes.iter().any(|pass| pass.estimated);
    CostRecord {
        micros: cost.micros,
        source: match (cost.source, estimated) {
            (CostSource::Table, true) => "estimated",
            (CostSource::Table, false) => "table",
            (CostSource::Reported, _) => "reported",
            (CostSource::Unknown, _) => "unknown",
        }
        .to_string(),
        price_updated_at: (cost.source == CostSource::Table)
            .then(|| table.map(|table| table.generated_at.clone()))
            .flatten(),
    }
}

/// `price_passes` for a shell: one call, no table handling on its side.
#[uniffi::export]
pub fn price_reply(provider: String, model_id: String, passes: Vec<PassUsageRecord>) -> CostRecord {
    price_passes(&provider, &model_id, &passes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_table_loads_and_prices_a_known_model() {
        let table = bundled_table().expect("the shipped table parses");
        assert!(!table.generated_at.is_empty());
        assert!(lookup_price(Some(table), "anthropic", "claude-sonnet-4-5").is_some());
    }

    #[test]
    fn a_dated_id_finds_the_undated_price() {
        let table = bundled_table().expect("the shipped table parses");
        let plain = lookup_price(Some(table), "anthropic", "claude-sonnet-4-5");
        let dated = lookup_price(Some(table), "anthropic", "claude-sonnet-4-5-20250929");
        assert_eq!(plain.is_some(), dated.is_some());
    }

    #[test]
    fn a_missing_model_has_no_price_rather_than_a_zero_one() {
        let table = bundled_table().expect("the shipped table parses");
        assert!(lookup_price(Some(table), "anthropic", "no-such-model").is_none());
        assert!(lookup_price(None, "anthropic", "claude-sonnet-4-5").is_none());
    }

    fn pass(input: u64, output: u64, estimated: bool) -> PassUsageRecord {
        PassUsageRecord {
            input,
            cache_read: 0,
            cache_write: 0,
            output,
            reasoning: 0,
            estimated,
            cost_usd: None,
        }
    }

    #[test]
    fn a_priced_turn_names_its_source_and_table_date() {
        let table = bundled_table().expect("the shipped table parses");
        let exact = price_passes("anthropic", "claude-sonnet-4-5", &[pass(1000, 500, false)]);
        assert_eq!(exact.source, "table");
        assert_eq!(
            exact.price_updated_at.as_deref(),
            Some(table.generated_at.as_str())
        );
        assert!(exact.micros.is_some_and(|micros| micros > 0));

        let guessed = price_passes("anthropic", "claude-sonnet-4-5", &[pass(1000, 500, true)]);
        assert_eq!(guessed.source, "estimated");
        assert_eq!(guessed.micros, exact.micros);
    }

    #[test]
    fn an_unknown_model_is_unknown_and_not_free() {
        let cost = price_passes("anthropic", "no-such-model", &[pass(1000, 500, false)]);
        assert_eq!(cost.micros, None);
        assert_eq!(cost.source, "unknown");
        assert_eq!(cost.price_updated_at, None);
    }

    #[test]
    fn a_zero_token_turn_with_no_price_is_unknown_not_free() {
        // A listed model with no table entry must not read as a priced zero.
        let cost = price_passes("anthropic", "no-such-model", &[pass(0, 0, false)]);
        assert_eq!(cost.micros, None);
        assert_eq!(cost.source, "unknown");
    }

    #[test]
    fn a_provider_figure_stands_without_a_price() {
        let mut billed = pass(10, 10, false);
        billed.cost_usd = Some(0.000_123);
        let cost = price_passes("custom", "anything", &[billed]);
        assert_eq!(cost.micros, Some(123));
        assert_eq!(cost.source, "reported");
        assert_eq!(cost.price_updated_at, None);
    }

    #[test]
    fn date_suffixes_are_cut_only_where_they_end_the_id() {
        assert_eq!(strip_suffix_date("gpt-4o-2024-08-06", 1), Some("gpt-4o"));
        assert_eq!(strip_suffix_date("claude-x-20250101", 0), Some("claude-x"));
        assert_eq!(strip_suffix_date("claude-x-latest", 2), Some("claude-x"));
        assert_eq!(strip_suffix_date("claude-x-2025", 0), None);
        assert_eq!(strip_suffix_date("20250101", 0), None);
    }
}
