//! What a provider reports about tokens, in one shape. Vendors disagree on whether cache hits and reasoning are
//! inside the headline counts or beside them, so each builder here settles that once and returns disjoint buckets
//! the cost engine can price one by one. Mirrors `electron/providers/usage.cjs`.

use serde_json::Value;

use crate::adapters::common::count;
use crate::types::{TokenUsage, Usage, UsageSource};

fn get<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    value.and_then(|v| v.get(key))
}

/// A field that is present and not null, the way `??` reads it.
fn some<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    get(value, key).filter(|v| !v.is_null())
}

/// The legacy pair plus the split.
pub fn usage_of(tokens: TokenUsage) -> Usage {
    Usage {
        prompt_tokens: tokens.input + tokens.cache_read + tokens.cache_write,
        output_tokens: tokens.output + tokens.reasoning,
        tokens: Some(tokens),
    }
}

/// Anthropic: the three input buckets are disjoint; thinking is billed as output and already inside it.
pub fn from_anthropic(u: Option<&Value>) -> Usage {
    usage_of(TokenUsage {
        input: count(get(u, "input_tokens")),
        cache_read: count(get(u, "cache_read_input_tokens")),
        cache_write: count(get(u, "cache_creation_input_tokens")),
        output: count(get(u, "output_tokens")),
        ..TokenUsage::default()
    })
}

/// OpenAI-style: cached and reasoning counts are subsets of the headline counts. OpenRouter adds
/// `cache_write_tokens` and the amount it charged in `cost`.
pub fn from_openai(u: Option<&Value>) -> Usage {
    let details = get(u, "prompt_tokens_details");
    let cache_read =
        count(some(details, "cached_tokens").or_else(|| get(u, "prompt_cache_hit_tokens")));
    let cache_write = count(get(details, "cache_write_tokens"));
    let reasoning = count(get(get(u, "completion_tokens_details"), "reasoning_tokens"));
    let prompt = count(get(u, "prompt_tokens"));
    let completion = count(get(u, "completion_tokens"));
    let split = get(u, "prompt_tokens_details").is_some()
        || get(u, "completion_tokens_details").is_some()
        || get(u, "prompt_cache_hit_tokens").is_some();
    usage_of(TokenUsage {
        input: prompt.saturating_sub(cache_read + cache_write),
        cache_read,
        cache_write,
        output: completion.saturating_sub(reasoning),
        reasoning,
        source: if split {
            UsageSource::Reported
        } else {
            UsageSource::Derived
        },
        cost_usd: get(u, "cost")
            .and_then(Value::as_f64)
            .filter(|c| c.is_finite() && *c >= 0.0),
    })
}

/// Gemini: the prompt count includes cached content; thinking tokens come on top of the candidates.
pub fn from_gemini(m: Option<&Value>) -> Usage {
    let cached = count(get(m, "cachedContentTokenCount"));
    usage_of(TokenUsage {
        input: count(get(m, "promptTokenCount")).saturating_sub(cached),
        cache_read: cached,
        output: count(get(m, "candidatesTokenCount")),
        reasoning: count(get(m, "thoughtsTokenCount")),
        ..TokenUsage::default()
    })
}

/// Codex's token usage: cached input and reasoning output are subsets of the totals, as in OpenAI's.
pub fn from_codex(last: Option<&Value>) -> Usage {
    let cache_read = count(get(last, "cachedInputTokens"));
    let reasoning = count(get(last, "reasoningOutputTokens"));
    usage_of(TokenUsage {
        input: count(get(last, "inputTokens")).saturating_sub(cache_read),
        cache_read,
        output: count(get(last, "outputTokens")).saturating_sub(reasoning),
        reasoning,
        ..TokenUsage::default()
    })
}

/// Engines that report one prompt count and one output count (Ollama).
pub fn from_totals(prompt: u64, output: u64) -> Usage {
    usage_of(TokenUsage {
        input: prompt,
        output,
        source: UsageSource::Derived,
        ..TokenUsage::default()
    })
}

/// Adds one pass to a running total; a missing side counts as nothing.
pub fn add_tokens(a: Option<TokenUsage>, b: Option<TokenUsage>) -> Option<TokenUsage> {
    let (a, b) = match (a, b) {
        (None, other) | (other, None) => return other,
        (Some(a), Some(b)) => (a, b),
    };
    let cost_usd = match (a.cost_usd, b.cost_usd) {
        (None, None) => None,
        (x, y) => Some(x.unwrap_or(0.0) + y.unwrap_or(0.0)),
    };
    Some(TokenUsage {
        input: a.input + b.input,
        cache_read: a.cache_read + b.cache_read,
        cache_write: a.cache_write + b.cache_write,
        output: a.output + b.output,
        reasoning: a.reasoning + b.reasoning,
        source: if a.source == UsageSource::Reported && b.source == UsageSource::Reported {
            UsageSource::Reported
        } else {
            UsageSource::Derived
        },
        cost_usd,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn an_openai_answer_without_details_is_derived() {
        let usage = from_openai(Some(&json!({"prompt_tokens": 9, "completion_tokens": 2})));
        let tokens = usage.tokens.unwrap();
        assert_eq!((usage.prompt_tokens, usage.output_tokens), (9, 2));
        assert_eq!(
            (tokens.input, tokens.output, tokens.source),
            (9, 2, UsageSource::Derived)
        );
    }

    #[test]
    fn a_pass_with_nothing_added_keeps_the_other() {
        let one = from_totals(1, 1).tokens;
        assert_eq!(add_tokens(None, one), one);
        assert_eq!(add_tokens(one, None), one);
    }
}
