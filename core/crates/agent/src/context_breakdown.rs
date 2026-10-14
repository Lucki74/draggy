//! What the context window is spent on, and where folding happens. Port of `src/agent/contextBreakdown.ts`.
//! The model reports one number; the parts are measured from what was sent and scaled to add up to it.

use serde::{Deserialize, Serialize};

use crate::compaction::{CHARS_PER_TOKEN, COMPACT_AT};
use crate::js::{CaseFold, Flags, JsRegex, cached, is_js_space};

/// Every token sent is billed on every turn, so a paid provider's huge window is folded long before it fills.
pub const PAID_COMPACT_CAP: i64 = 64_000;

/// The lowest limit accepted. Below it every turn would be folded away.
pub const MIN_COMPACT_LIMIT: i64 = 1000;

/// The order the rows of the window are listed in. `messages` is the conversation, shown minus the draft.
pub const CATEGORY_ORDER: [&str; 7] = [
    "messages",
    "system",
    "tools",
    "skills",
    "loadedSkills",
    "memory",
    "summary",
];

/// The token share of each part of the prompt. Serialised with the reference's keys.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    pub messages: i64,
    pub system: i64,
    pub tools: i64,
    pub memory: i64,
    pub skills: i64,
    pub loaded_skills: i64,
    pub summary: i64,
}

impl ContextBreakdown {
    /// The tokens of one category, by its reference name.
    pub fn of(&self, id: &str) -> i64 {
        match id {
            "messages" => self.messages,
            "system" => self.system,
            "tools" => self.tools,
            "memory" => self.memory,
            "skills" => self.skills,
            "loadedSkills" => self.loaded_skills,
            "summary" => self.summary,
            _ => 0,
        }
    }
}

/// A skill whose instructions are in the prompt, with what they cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkillPart {
    pub id: String,
    pub name: String,
    pub chars: i64,
}

/// Characters of each fixed part of the prompt, as sent.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptParts {
    pub system_chars: i64,
    pub tool_chars: i64,
    pub memory_chars: i64,
    /// The list of skills on offer: names and descriptions only.
    pub skill_chars: i64,
    pub summary_chars: i64,
    /// The instructions of the skills loaded in this conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaded_skill_chars: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaded_skills: Option<Vec<LoadedSkillPart>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_count: Option<i64>,
}

/// Which parts the popover names: counts, and each loaded skill with its size when one was measured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDetails {
    pub tool_count: Option<i64>,
    pub skill_count: Option<i64>,
    pub loaded_skills: Vec<LoadedSkillTokens>,
}

/// A loaded skill as the popover lists it. `tokens` is None when nothing was measured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkillTokens {
    pub id: String,
    pub name: String,
    pub tokens: Option<i64>,
}

/// A loaded skill named without its size, for a conversation that has no measured parts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoadedSkillName {
    pub id: String,
    pub name: String,
}

/// One row of the window: a part with anything in it, the draft, or the free space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextRow {
    pub id: String,
    pub tokens: i64,
    /// Share of the whole window, 0 to 100.
    pub percent: f64,
}

/// Where automatic folding happens and whether the user or Draggy chose it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactSource {
    Auto,
    Limit,
    Paid,
}

/// The window as the popover shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindowView {
    /// Whether anything has been measured yet.
    pub measured: bool,
    /// False while a reply streams and the figure is an estimate between two counts.
    pub exact: bool,
    pub used_tokens: i64,
    pub window_tokens: i64,
    pub percent: f64,
    /// Each part that has anything in it, then the free space.
    pub rows: Vec<ContextRow>,
    /// Where the conversation gets folded into notes, in tokens.
    pub compact_at_tokens: i64,
    pub compact_source: CompactSource,
    pub details: ContextDetails,
}

/// What the window is measured against. `draft_tokens` is part of the conversation and shown on its own row.
#[derive(Debug, Clone, PartialEq)]
pub struct ContextWindowInput {
    pub details: Option<ContextDetails>,
    /// The parts, adding up to what the model counted. None when nothing has been measured.
    pub breakdown: Option<ContextBreakdown>,
    pub draft_tokens: f64,
    pub exact: bool,
    pub window_tokens: i64,
    /// The user's own limit, when they set one.
    pub limit_tokens: Option<i64>,
    /// A model a provider bills for, which folds at `PAID_COMPACT_CAP` unless the user set a limit.
    pub paid: bool,
}

/// A fold threshold and the reason it sits there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompactThreshold {
    pub tokens: i64,
    pub source: CompactSource,
}

/// The result of reading a typed token count: a limit, "auto" or "off" (no limit), or not a count at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenCount {
    Limit(i64),
    NoLimit,
    Invalid,
}

/// `tokensOf`: the tokens a number of characters is worth, never negative.
pub fn tokens_of(chars: i64) -> i64 {
    (chars.max(0) + CHARS_PER_TOKEN - 1) / CHARS_PER_TOKEN
}

/// `Math.round`: halves go up, toward positive infinity.
pub fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// Splits a measured count: fixed parts estimated from length, the conversation gets the rest. Overshooting
/// estimates are scaled down together, never below zero.
pub fn measure_breakdown(
    parts: &PromptParts,
    measured_tokens: i64,
    conversation_chars: i64,
) -> ContextBreakdown {
    let fixed = ContextBreakdown {
        messages: 0,
        system: tokens_of(parts.system_chars),
        tools: tokens_of(parts.tool_chars),
        memory: tokens_of(parts.memory_chars),
        skills: tokens_of(parts.skill_chars),
        loaded_skills: tokens_of(parts.loaded_skill_chars.unwrap_or(0)),
        summary: tokens_of(parts.summary_chars),
    };
    let fixed_total = fixed_sum(&fixed);

    // Nothing measured: an estimate of everything is the best there is.
    if measured_tokens <= 0 {
        return ContextBreakdown {
            messages: tokens_of(conversation_chars),
            ..fixed
        };
    }

    if fixed_total <= measured_tokens {
        return ContextBreakdown {
            messages: measured_tokens - fixed_total,
            ..fixed
        };
    }

    let scale = measured_tokens as f64 / fixed_total as f64;
    let scaled = ContextBreakdown {
        messages: 0,
        system: (fixed.system as f64 * scale).floor() as i64,
        tools: (fixed.tools as f64 * scale).floor() as i64,
        memory: (fixed.memory as f64 * scale).floor() as i64,
        skills: (fixed.skills as f64 * scale).floor() as i64,
        loaded_skills: (fixed.loaded_skills as f64 * scale).floor() as i64,
        summary: (fixed.summary as f64 * scale).floor() as i64,
    };

    ContextBreakdown {
        messages: (measured_tokens - fixed_sum(&scaled)).max(0),
        ..scaled
    }
}

/// The fixed parts only, which is every category but the conversation.
fn fixed_sum(parts: &ContextBreakdown) -> i64 {
    parts.system + parts.tools + parts.memory + parts.skills + parts.loaded_skills + parts.summary
}

/// The most a limit may be: a tenth of the window is left for the reply.
pub fn max_limit_for(window_tokens: i64) -> i64 {
    (window_tokens as f64 * 0.9).floor() as i64
}

/// Where automatic folding happens, in tokens. Measured against how far the window can grow, not the smaller
/// window loaded now.
pub fn compact_threshold(
    window_tokens: i64,
    limit_tokens: Option<i64>,
    paid: bool,
) -> CompactThreshold {
    if let Some(limit) = limit_tokens
        && limit > 0
    {
        return CompactThreshold {
            tokens: limit.min(max_limit_for(window_tokens)),
            source: CompactSource::Limit,
        };
    }

    let auto = (window_tokens as f64 * COMPACT_AT).floor() as i64;
    if paid && auto > PAID_COMPACT_CAP {
        CompactThreshold {
            tokens: PAID_COMPACT_CAP,
            source: CompactSource::Paid,
        }
    } else {
        CompactThreshold {
            tokens: auto,
            source: CompactSource::Auto,
        }
    }
}

/// Builds the window view: each part that has anything in it, the draft on a row of its own, then the free space.
pub fn describe_context_window(input: &ContextWindowInput) -> ContextWindowView {
    let window = input.window_tokens.max(1);
    let share = |tokens: i64| (tokens as f64 / window as f64) * 100.0;

    let breakdown = input.breakdown.unwrap_or_default();

    // The draft was counted as part of the conversation; it is shown on a row of its own.
    let draft = (js_round(input.draft_tokens)
        .min(breakdown.messages as f64)
        .max(0.0)) as i64;

    let mut rows: Vec<ContextRow> = Vec::new();
    for id in CATEGORY_ORDER {
        let tokens = if id == "messages" {
            breakdown.messages - draft
        } else {
            breakdown.of(id)
        };
        if tokens > 0 {
            rows.push(ContextRow {
                id: id.to_string(),
                tokens,
                percent: share(tokens),
            });
        }
    }

    if draft > 0 {
        rows.push(ContextRow {
            id: "draft".to_string(),
            tokens: draft,
            percent: share(draft),
        });
    }

    let used_tokens: i64 = rows.iter().map(|row| row.tokens).sum();
    let free = (window - used_tokens).max(0);
    rows.push(ContextRow {
        id: "free".to_string(),
        tokens: free,
        percent: share(free),
    });

    let threshold = compact_threshold(window, input.limit_tokens, input.paid);

    ContextWindowView {
        measured: input.breakdown.is_some(),
        exact: input.exact,
        used_tokens,
        window_tokens: window,
        percent: share(used_tokens),
        rows,
        compact_at_tokens: threshold.tokens,
        compact_source: threshold.source,
        details: input.details.clone().unwrap_or(ContextDetails {
            tool_count: None,
            skill_count: None,
            loaded_skills: Vec::new(),
        }),
    }
}

/// The counts and loaded skills for the popover: from the parts when a turn measured them, otherwise from the
/// loaded skills the conversation shows, without their sizes.
pub fn context_details(parts: Option<&PromptParts>, loaded: &[LoadedSkillName]) -> ContextDetails {
    match parts {
        Some(parts) if parts.loaded_skills.is_some() => ContextDetails {
            tool_count: parts.tool_count,
            skill_count: parts.skill_count,
            loaded_skills: parts
                .loaded_skills
                .iter()
                .flatten()
                .map(|skill| LoadedSkillTokens {
                    id: skill.id.clone(),
                    name: skill.name.clone(),
                    tokens: Some(tokens_of(skill.chars)),
                })
                .collect(),
        },
        _ => ContextDetails {
            tool_count: parts.and_then(|parts| parts.tool_count),
            skill_count: parts.and_then(|parts| parts.skill_count),
            loaded_skills: loaded
                .iter()
                .map(|skill| LoadedSkillTokens {
                    id: skill.id.clone(),
                    name: skill.name.clone(),
                    tokens: None,
                })
                .collect(),
        },
    }
}

/// Reads a typed token count ("20000", "20k", "1.5k", "2m", "8k tokens"). Commas, underscores and whitespace are
/// ignored, and "auto", "off" and "default" mean no limit. Anything else is not a count.
pub fn parse_token_count(raw: &str) -> TokenCount {
    static COUNT: std::sync::OnceLock<Option<JsRegex>> = std::sync::OnceLock::new();
    let text: String = raw
        .to_lowercase()
        .chars()
        .filter(|c| !matches!(c, ',' | '_') && !is_js_space(*c))
        .collect();

    if text.is_empty() {
        return TokenCount::Invalid;
    }
    if matches!(text.as_str(), "auto" | "off" | "default") {
        return TokenCount::NoLimit;
    }

    let flags = Flags {
        case: CaseFold::Off,
        dot_all: false,
    };
    let Some(regex) = cached(&COUNT, r"^([0-9]+(?:\.[0-9]+)?)(k|m)?(?:tokens?)?$", flags) else {
        return TokenCount::Invalid;
    };
    let Some(groups) = regex.captures(&text) else {
        return TokenCount::Invalid;
    };

    let number: f64 = groups
        .get(1)
        .copied()
        .flatten()
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(0.0);
    let multiplier = match groups.get(2).copied().flatten() {
        Some("m") => 1_000_000.0,
        Some("k") => 1_000.0,
        _ => 1.0,
    };
    let value = js_round(number * multiplier) as i64;

    if value > 0 {
        TokenCount::Limit(value)
    } else {
        TokenCount::Invalid
    }
}

/// `Number.prototype.toFixed(1)` for a non-negative value: exact decimal digits, with a tie going up.
fn to_fixed_one(value: f64) -> String {
    let exact = format!("{value:.60}");
    let (whole, fraction) = exact.split_once('.').unwrap_or((exact.as_str(), "0"));
    let mut digits = fraction.bytes();
    let tenth = digits.next().map_or(0, |d| i64::from(d - b'0'));
    let hundredth = digits.next().map_or(0, |d| i64::from(d - b'0'));
    let mut units = whole.parse::<i64>().unwrap_or(0) * 10 + tenth;
    if hundredth >= 5 {
        units += 1;
    }
    format!("{}.{}", units / 10, units % 10)
}

/// "27.6k", "203k", "950", "1.3M": the same shape everywhere a count is shown.
pub fn format_token_count(tokens: f64) -> String {
    let value = js_round(tokens.max(0.0));

    if value >= 1_000_000.0 {
        return format!(
            "{}M",
            to_fixed_one(value / 1_000_000.0).trim_end_matches(".0")
        );
    }
    if value >= 100_000.0 {
        return format!("{}k", js_round(value / 1000.0) as i64);
    }
    if value >= 1000.0 {
        return format!("{}k", to_fixed_one(value / 1000.0).trim_end_matches(".0"));
    }
    format!("{}", value as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tie_at_one_decimal_goes_up_as_it_does_in_javascript() {
        assert_eq!(to_fixed_one(1.25), "1.3");
        assert_eq!(to_fixed_one(27.65), "27.6");
    }

    #[test]
    fn a_count_with_no_digits_is_not_a_count() {
        assert_eq!(parse_token_count("tokens"), TokenCount::Invalid);
    }

    #[test]
    fn the_limit_is_capped_below_the_window() {
        assert_eq!(
            compact_threshold(32_000, Some(1_000_000), false).tokens,
            max_limit_for(32_000)
        );
    }
}
