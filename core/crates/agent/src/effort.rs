//! The effort levels and the rules that set the level a turn runs at. Mirrors `win/src/ai/effort.ts`;
//! `shared/fixtures/agent/effort.json` holds the cases both sides must agree on.

/// How much reasoning a turn asks a model for, from none up to the most. Declaration order is the order of the levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Effort {
    Off,
    Low,
    Medium,
    High,
    Max,
}

/// The levels from least to most reasoning.
pub const EFFORT_ORDER: [Effort; 5] = [
    Effort::Off,
    Effort::Low,
    Effort::Medium,
    Effort::High,
    Effort::Max,
];

/// What a new or unreadable setting reads as.
pub const EFFORT_DEFAULT: Effort = Effort::Medium;

/// Chat stops at High unless the user allows Max there: Max is the slowest and costliest level.
pub const CHAT_MAX_LEVEL: Effort = Effort::High;

/// The surface a turn runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Chat,
    Code,
}

/// Why the level a turn runs at differs from the one asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffortReason {
    Unsupported,
    ChatCap,
    NoThinking,
    Slow,
}

impl EffortReason {
    /// The name the golden fixtures and the TypeScript reference use.
    pub fn name(self) -> &'static str {
        match self {
            EffortReason::Unsupported => "unsupported",
            EffortReason::ChatCap => "chatCap",
            EffortReason::NoThinking => "noThinking",
            EffortReason::Slow => "slow",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EffectiveEffort {
    pub asked: Effort,
    pub sent: Effort,
    pub reason: Option<EffortReason>,
}

/// What the rules read. `supported` is `None` when the model's levels are not known, and `can_think` is `None`
/// when its capabilities are not.
#[derive(Debug, Clone, Copy)]
pub struct EffortInput<'a> {
    pub asked: Effort,
    pub surface: Surface,
    pub allow_max_in_chat: bool,
    pub can_think: Option<bool>,
    pub supported: Option<&'a [Effort]>,
    /// True when a slow model may not think until the user allows it.
    pub slow_blocks_thinking: bool,
}

impl Effort {
    /// The name the settings and the wire use.
    pub fn name(self) -> &'static str {
        match self {
            Effort::Off => "off",
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Max => "max",
        }
    }

    /// The level with this name, if there is one.
    pub fn from_name(name: &str) -> Option<Effort> {
        EFFORT_ORDER.into_iter().find(|level| level.name() == name)
    }

    pub fn is_thinking(self) -> bool {
        self != Effort::Off
    }
}

/// The levels a surface may use. Chat drops Max unless the user allowed it.
pub fn allowed_efforts(surface: Surface, allow_max_in_chat: bool) -> Vec<Effort> {
    EFFORT_ORDER
        .into_iter()
        .filter(|level| surface == Surface::Code || allow_max_in_chat || *level != Effort::Max)
        .collect()
}

/// The next level in the cycle, wrapping back to Off. A level the surface does not allow is skipped.
pub fn next_effort(level: Effort, surface: Surface, allow_max_in_chat: bool) -> Effort {
    let allowed = allowed_efforts(surface, allow_max_in_chat);
    match allowed.iter().position(|candidate| *candidate == level) {
        Some(at) => allowed[(at + 1) % allowed.len()],
        None => highest_at_or_below(level, &allowed).unwrap_or(allowed[0]),
    }
}

/// The highest supported level that is not above `level`, else the first supported one.
pub fn clamp_effort(level: Effort, supported: &[Effort]) -> Effort {
    if supported.is_empty() || supported.contains(&level) {
        return level;
    }
    highest_at_or_below(level, supported).unwrap_or(supported[0])
}

fn highest_at_or_below(level: Effort, levels: &[Effort]) -> Option<Effort> {
    levels
        .iter()
        .copied()
        .filter(|candidate| *candidate <= level)
        .max()
}

/// Reasoning tokens a local model may spend at this level: the level's budget, never more than a quarter of the context.
pub fn local_budget(level: Effort, num_ctx: u64) -> Option<u64> {
    let budget = match level {
        Effort::Off => return None,
        Effort::Low => 1024,
        Effort::Medium => 4096,
        Effort::High => 8192,
        Effort::Max => 32768,
    };
    Some(budget.min(num_ctx / 4))
}

/// The level a turn actually runs at, and why it differs from the one asked. Rules run in this order: a model that
/// cannot think gets none; Chat caps Max; a slow model gets none; then the level clamps to what the model supports.
/// The first rule that changes the level gives the reason.
pub fn effective_effort(input: EffortInput) -> EffectiveEffort {
    let asked = input.asked;
    if input.can_think == Some(false) {
        let reason = asked.is_thinking().then_some(EffortReason::NoThinking);
        return EffectiveEffort {
            asked,
            sent: Effort::Off,
            reason,
        };
    }

    let mut sent = asked;
    let mut reason = None;

    if input.surface == Surface::Chat && !input.allow_max_in_chat && sent == Effort::Max {
        sent = CHAT_MAX_LEVEL;
        reason = Some(EffortReason::ChatCap);
    }

    if input.slow_blocks_thinking && sent.is_thinking() {
        sent = Effort::Off;
        reason = reason.or(Some(EffortReason::Slow));
    }

    if let Some(supported) = input.supported
        && sent.is_thinking()
        && !supported.contains(&sent)
    {
        let clamped = clamp_effort(sent, supported);
        if clamped != sent {
            sent = clamped;
            reason = reason.or(Some(EffortReason::Unsupported));
        }
    }

    EffectiveEffort {
        asked,
        sent,
        reason,
    }
}

/// Reads a level from settings saved before the five levels. Old "low" meant thinking off, so it maps to off;
/// the other old names keep their meaning.
pub fn effort_from_legacy(value: &str) -> Option<Effort> {
    match value {
        "low" => Some(Effort::Off),
        "medium" => Some(Effort::Medium),
        "high" => Some(Effort::High),
        _ => None,
    }
}
