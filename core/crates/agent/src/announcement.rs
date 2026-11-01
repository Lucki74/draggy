//! Spots a reply that only says what the model will do next: a port of `src/agent/announcement.ts`. Such a reply is
//! worth one nudge, since the loop used to save the promise as the answer.

use std::sync::OnceLock;

use crate::js::{CaseFold, Flags, JsRegex, cached, trim_js, utf16_len};

/// Longer replies are answers, whatever they end with. Counted in UTF-16 units.
const MAX_ANNOUNCEMENT_UNITS: usize = 300;

const UNICODE: Flags = Flags {
    case: CaseFold::Unicode,
    dot_all: false,
};
const EXACT: Flags = Flags {
    case: CaseFold::Off,
    dot_all: false,
};

static SENTENCE_BREAK: OnceLock<Option<JsRegex>> = OnceLock::new();
static CONNECTIVE: OnceLock<Option<JsRegex>> = OnceLock::new();
static LEADING_INTENT: OnceLock<Option<JsRegex>> = OnceLock::new();
static PREFIX_INTENT: OnceLock<Option<JsRegex>> = OnceLock::new();
static TRAILING_INTENT: OnceLock<Option<JsRegex>> = OnceLock::new();
static ASKS_FOR_REPLY: OnceLock<Option<JsRegex>> = OnceLock::new();

// Latin stops need a space after them, so "llama.cpp" stays one sentence; CJK stops need none.
const SENTENCE_BREAK_SOURCE: &str = r"(?<=[.!])\s+|(?<=[。！])";

const CONNECTIVE_SOURCE: &str = r"^(?:(?:now|next|first|then|ok|okay|alright|great|sure|maintenant|ensuite|ahora|primero|jetzt|zuerst|ora|adesso|agora|nu|eerst|сейчас|теперь|الآن)[,،]?\s+)+";

const LEADING_INTENTS: &[&str] = &[
    "let me",
    "let's",
    "let’s",
    "i'll",
    "i’ll",
    "i will",
    "i'm going to",
    "i’m going to",
    "i am going to",
    "je vais",
    "laisse-moi",
    "laissez-moi",
    "voyons",
    "voy a",
    "déjame",
    "dejame",
    "vamos",
    "permíteme",
    "ich werde",
    "lass mich",
    "lassen sie mich",
    "ich schaue",
    "ich prüfe",
    "lasciami",
    "fammi",
    "vado a",
    "vediamo",
    "vou",
    "deixe-me",
    "deixa-me",
    "ik ga",
    "laat me",
    "laat mij",
    "ik zal",
    "давай",
    "давайте",
    "позвольте",
    "я проверю",
    "я посмотрю",
    "я поищу",
    "я изучу",
];

// Arabic runs the intent straight into the verb, so these match as prefixes.
const PREFIX_INTENT_SOURCE: &str =
    r"^(?:دعني|دعنا|سأ)";

// Japanese and Korean put the intent at the end of the sentence, not the start.
const TRAILING_INTENT_SOURCE: &str =
    r"(?:てみます|確認します|調べます|ましょう|보겠습니다|확인하겠습니다|검색하겠습니다)[。.!！]?$";

const ASKS_FOR_REPLY_SOURCE: &str =
    r"(?<!\p{L})(?:know|savoir|saber|wissen|sapere|weten|знать)(?!\p{L})";

/// True when short prose promises an action without taking it: one nudge is cheaper than a dead turn.
pub fn announces_action(text: &str) -> bool {
    let trimmed = trim_js(text);
    if trimmed.is_empty()
        || utf16_len(trimmed) > MAX_ANNOUNCEMENT_UNITS
        || trimmed.contains(['?', '？', '؟'])
    {
        return false;
    }
    if trimmed.ends_with(':') || trimmed.ends_with('…') || trimmed.ends_with("...") {
        return true;
    }

    let (
        Some(sentence_break),
        Some(connective),
        Some(leading),
        Some(prefix),
        Some(trailing),
        Some(asks),
    ) = (
        cached(&SENTENCE_BREAK, SENTENCE_BREAK_SOURCE, EXACT),
        cached(&CONNECTIVE, CONNECTIVE_SOURCE, UNICODE),
        cached(&LEADING_INTENT, &leading_intent_source(), UNICODE),
        cached(&PREFIX_INTENT, PREFIX_INTENT_SOURCE, EXACT),
        cached(&TRAILING_INTENT, TRAILING_INTENT_SOURCE, EXACT),
        cached(&ASKS_FOR_REPLY, ASKS_FOR_REPLY_SOURCE, UNICODE),
    )
    else {
        return false;
    };

    let mut sentences = Vec::new();
    let mut start = 0;
    for (from, to) in sentence_break.find_all(trimmed) {
        sentences.push(&trimmed[start..from]);
        start = to;
    }
    sentences.push(&trimmed[start..]);
    let last = sentences
        .into_iter()
        .rev()
        .find(|part| !trim_js(part).is_empty())
        .unwrap_or("");

    let last = trim_js(last);
    let last = match connective.find(last) {
        Some((_, end)) => &last[end..],
        None => last,
    };
    if asks.is_match(last) {
        return false;
    }
    leading.is_match(last) || prefix.is_match(last) || trailing.is_match(last)
}

/// `^(?:…)(?![\p{L}'’-])`: one of the listed openers, not running on into a longer word.
fn leading_intent_source() -> String {
    format!("^(?:{})(?![\\p{{L}}'’-])", LEADING_INTENTS.join("|"))
}
