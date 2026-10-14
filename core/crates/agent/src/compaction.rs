//! Folds the older part of a chat into notes, so it never hits the context wall. Port of `src/agent/compaction.ts`.
//! Lengths are UTF-16 units, as in JavaScript, so budgets and slices agree with the reference.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::js::{CaseFold, Flags, JsRegex, cached, trim_js, utf16_len, utf16_suffix};
use crate::task_manager::{Attachment, Message};

/// Roughly how many characters a token is worth, for budget arithmetic.
pub const CHARS_PER_TOKEN: i64 = 4;

/// How full the window may get before folding.
pub const COMPACT_AT: f64 = 0.6;

/// Messages kept verbatim at the end, about three turns.
pub const KEEP_RECENT_MESSAGES: usize = 6;

/// The smallest fold worth doing.
pub const MIN_FOLD_MESSAGES: usize = 4;

/// How long a summary may run, so folding cannot itself fill the window.
pub const SUMMARY_CHAR_BUDGET: usize = 3000;

/// Tokens the summariser may write. Bounded so a fold cannot run away.
pub const SUMMARY_NUM_PREDICT: u64 = 1024;

/// Per message, in the transcript handed to the summariser.
const TRANSCRIPT_MESSAGE_LIMIT: usize = 4000;

const SUMMARY_SYSTEM: &str = "You compress a conversation so it can be carried forward in a smaller space. You are not talking to anyone: you are writing notes that another assistant will rely on as its only record of what came before.

Write facts, not narration. \"The user is working on a project and asked several questions\" is worthless. \"Budget is 4200 GBP; deadline 14 March; user rejected Postgres and chose SQLite\" is what this is for.

Keep, in this order of priority: decisions reached and the reasons for them; names, numbers, dates, versions, paths, identifiers and exact quotes that matter; what the user is trying to achieve; anything the user asked for that has not been delivered yet; corrections the user made.

Drop: pleasantries, restatements, your own reasoning, anything already superseded by a later message.

Write plain prose or short dashed lines. No headings, no preamble, no closing remark. Do not address the user. Do not say \"the conversation\" or \"in summary\". Start with the first fact.";

/// A fold's stored notes: the messages before `through_index` are represented by `summary`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionState {
    pub through_index: usize,
    pub summary: String,
    pub updated_at: f64,
}

/// Where a fold starts and ends. `fold_through` is exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionPlan {
    pub fold_from: usize,
    pub fold_through: usize,
}

/// The knobs a plan is made with. A manual fold uses a budget of one, so it folds whenever it can.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanOptions {
    pub budget_chars: i64,
    pub keep_recent: usize,
    pub min_fold: usize,
}

impl PlanOptions {
    /// The defaults for an automatic fold against `budget_chars`.
    pub fn automatic(budget_chars: i64) -> Self {
        Self {
            budget_chars,
            keep_recent: KEEP_RECENT_MESSAGES,
            min_fold: MIN_FOLD_MESSAGES,
        }
    }
}

/// One message of the summariser's request.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SummaryMessage {
    pub role: &'static str,
    pub content: String,
}

/// The first `units` UTF-16 code units of `text`. A surrogate pair cut by the window is left out.
pub(crate) fn utf16_prefix(text: &str, units: usize) -> &str {
    let mut used = 0;
    let mut end = 0;
    for (index, c) in text.char_indices() {
        let width = c.len_utf16();
        if used + width > units {
            break;
        }
        used += width;
        end = index + c.len_utf8();
    }
    &text[..end]
}

/// What one message costs on the wire, near enough for a budget.
pub fn message_chars(message: &Message) -> i64 {
    let mut total = utf16_len(&message.content) as i64;
    for attachment in message.attachments.iter().flatten() {
        total += attachment_chars(attachment);
    }
    total
}

fn attachment_chars(attachment: &Attachment) -> i64 {
    (utf16_len(&attachment.name) + utf16_len(&attachment.content)) as i64
}

/// Tokens of conversation a fold puts into the notes, near enough to show.
pub fn folded_tokens(messages: &[Message], plan: CompactionPlan) -> i64 {
    let mut chars = 0;
    for index in plan.fold_from..plan.fold_through {
        if let Some(message) = messages.get(index) {
            chars += message_chars(message);
        }
    }
    (chars + CHARS_PER_TOKEN - 1) / CHARS_PER_TOKEN
}

/// The fold the user asked for: everything but the last exchange, however far under the limit the chat is.
pub fn plan_manual_compaction(
    messages: &[Message],
    existing: Option<&CompactionState>,
) -> Option<CompactionPlan> {
    plan_compaction(
        messages,
        existing,
        PlanOptions {
            budget_chars: 1,
            keep_recent: 2,
            min_fold: 2,
        },
    )
}

/// What the whole conversation costs, counting a summary already in place.
pub fn conversation_chars(messages: &[Message], existing: Option<&CompactionState>) -> i64 {
    let from = existing.map_or(0, |state| state.through_index);
    let mut total = existing.map_or(0, |state| utf16_len(&state.summary) as i64);
    for message in messages.iter().skip(from) {
        total += message_chars(message);
    }
    total
}

/// Decides whether to fold, and where. None when it still fits, when there is too little new material,
/// or when there is no clean boundary.
pub fn plan_compaction(
    messages: &[Message],
    existing: Option<&CompactionState>,
    options: PlanOptions,
) -> Option<CompactionPlan> {
    if options.budget_chars <= 0 {
        return None;
    }

    let fold_from = existing.map_or(0, |state| state.through_index);
    if fold_from > messages.len() {
        return None;
    }

    if conversation_chars(messages, existing) <= options.budget_chars {
        return None;
    }

    // Never touch the tail, however far over budget the conversation is.
    let ceiling = messages.len() as i64 - options.keep_recent as i64;
    if ceiling - (fold_from as i64) < options.min_fold as i64 {
        return None;
    }

    // Fold up to a user message, so what remains starts with someone asking something.
    let mut fold_through: i64 = -1;
    let mut index = ceiling;
    while index > fold_from as i64 {
        if messages
            .get(index as usize)
            .is_some_and(|message| message.role == "user")
        {
            fold_through = index;
            break;
        }
        index -= 1;
    }

    if fold_through < 0 || fold_through - (fold_from as i64) < options.min_fold as i64 {
        return None;
    }

    Some(CompactionPlan {
        fold_from,
        fold_through: fold_through as usize,
    })
}

/// The messages of a fold, for the summariser. Attachments are named but not included.
pub fn render_transcript(messages: &[Message]) -> String {
    messages
        .iter()
        .map(|message| {
            let who = if message.role == "user" {
                "User"
            } else {
                "Assistant"
            };
            let body = trim_js(utf16_prefix(&message.content, TRANSCRIPT_MESSAGE_LIMIT));

            let files = message
                .attachments
                .iter()
                .flatten()
                .map(|attachment| attachment.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");

            let noted = if files.is_empty() {
                String::new()
            } else {
                format!("\n[attached: {files}]")
            };
            let body = if body.is_empty() { "(no text)" } else { body };
            format!("{who}: {body}{noted}")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The request messages for a fold. A previous summary is extended, never rewritten.
pub fn build_summary_messages(previous: Option<&str>, slice: &[Message]) -> Vec<SummaryMessage> {
    let transcript = render_transcript(slice);

    let instruction = match previous.filter(|text| !text.is_empty()) {
        Some(previous) => format!(
            "Here are notes already written about the earlier part of this conversation:

{previous}

Below is what happened next. Write ONLY the notes for this new part. Do not repeat, rewrite or refer back to the notes above. What you write will be appended to them.

{transcript}"
        ),
        None => format!("Write the notes for this conversation.\n\n{transcript}"),
    };

    vec![
        SummaryMessage {
            role: "system",
            content: SUMMARY_SYSTEM.to_string(),
        },
        SummaryMessage {
            role: "user",
            content: instruction,
        },
    ]
}

/// The chat request that asks for notes. Thinking is off, so a reasoning model writes the notes directly.
pub fn summary_request_body(model: &str, messages: &[SummaryMessage]) -> Value {
    json!({
        "model": gguf_model_name(model),
        "stream": false,
        "temperature": 0.2,
        "max_tokens": SUMMARY_NUM_PREDICT,
        "messages": messages,
        "chat_template_kwargs": { "enable_thinking": false },
        "think": false,
    })
}

/// A `gguf:` prefix names a local file, which the server does not know by that name.
fn gguf_model_name(model: &str) -> &str {
    match model.get(..5) {
        Some(prefix) if prefix.eq_ignore_ascii_case("gguf:") => model.get(5..).unwrap_or(model),
        _ => model,
    }
}

/// How the summary appears on the wire, framed as a record rather than a bare block of facts.
pub fn render_compaction_block(state: &CompactionState) -> String {
    format!(
        "[Record of the earlier part of this conversation, condensed to save space. These are established facts, not a new question. Continue from the messages that follow.]

{}

[End of record. The conversation continues below, in full.]",
        state.summary
    )
}

/// Joins a new section onto an existing summary without disturbing it.
pub fn append_summary(previous: Option<&str>, addition: &str) -> String {
    let next = trim_js(addition);
    match previous.filter(|text| !text.is_empty()) {
        None => next.to_string(),
        Some(previous) if next.is_empty() => previous.to_string(),
        Some(previous) => format!("{previous}\n\n{next}"),
    }
}

/// Trims an oversized summary, oldest section first.
pub fn trim_summary(summary: &str, budget: usize) -> String {
    if utf16_len(summary) <= budget {
        return summary.to_string();
    }

    let mut sections: Vec<&str> = summary.split("\n\n").collect();
    while sections.len() > 1 && utf16_len(&sections.join("\n\n")) > budget {
        sections.remove(0);
    }

    let joined = sections.join("\n\n");
    utf16_suffix(&joined, budget).to_string()
}

/// Whether a summary still describes this conversation. Editing inside the folded range rewrites what it claims.
pub fn compaction_survives<'a>(
    state: Option<&'a CompactionState>,
    messages: &[Message],
    edited_index: Option<usize>,
) -> Option<&'a CompactionState> {
    let state = state?;
    if state.through_index > messages.len() {
        return None;
    }
    if edited_index.is_some_and(|index| index < state.through_index) {
        return None;
    }
    Some(state)
}

/// Removes `<think>...</think>` blocks the way the reference does: closed pairs, then an unclosed tail, then stray closers.
fn strip_thinking(text: &str) -> String {
    static PAIR: std::sync::OnceLock<Option<JsRegex>> = std::sync::OnceLock::new();
    static OPEN_TAIL: std::sync::OnceLock<Option<JsRegex>> = std::sync::OnceLock::new();
    static CLOSER: std::sync::OnceLock<Option<JsRegex>> = std::sync::OnceLock::new();
    let flags = Flags {
        case: CaseFold::AsciiOnly,
        dot_all: false,
    };

    let mut out = text.to_string();
    if let Some(pair) = cached(&PAIR, "<think>[\\s\\S]*?</think>", flags) {
        out = pair.replace_all(&out, "");
    }
    if let Some(tail) = cached(&OPEN_TAIL, "<think>[\\s\\S]*$", flags) {
        out = tail.replace_all(&out, "");
    }
    if let Some(closer) = cached(&CLOSER, "</think>", flags) {
        out = closer.replace_all(&out, "");
    }
    out
}

/// Reads a summariser reply and extends the notes with it. None when the provider refused, the reply has no
/// text, or there was nothing to fold. A model that writes nothing must not erase the folded messages.
pub fn summary_from_response(
    messages: &[Message],
    plan: CompactionPlan,
    existing: Option<&CompactionState>,
    status: u16,
    body: &str,
    now: f64,
) -> Option<CompactionState> {
    // The reference slices the conversation, so a plan past its end folds only what is there.
    let end = plan.fold_through.min(messages.len());
    if plan.fold_from >= end {
        return None;
    }
    if !(200..300).contains(&status) {
        return None;
    }

    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let choice = parsed
        .as_ref()
        .and_then(|value| value.pointer("/choices/0/message"));
    let text_of = |key: &str| -> String {
        choice
            .and_then(|message| message.get(key))
            .and_then(Value::as_str)
            .map(|text| trim_js(text).to_string())
            .unwrap_or_default()
    };
    let content = text_of("content");
    let raw_written = if content.is_empty() {
        text_of("reasoning_content")
    } else {
        content
    };

    let written = trim_js(&strip_thinking(&raw_written)).to_string();
    if written.is_empty() {
        return None;
    }

    let previous = existing.map(|state| state.summary.as_str());
    let summary = trim_summary(&append_summary(previous, &written), SUMMARY_CHAR_BUDGET);

    Some(CompactionState {
        through_index: plan.fold_through,
        summary,
        updated_at: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn say(role: &str, content: &str) -> Message {
        Message {
            id: format!("{role}-{}", content.len()),
            role: role.to_string(),
            content: content.to_string(),
            ..Message::default()
        }
    }

    #[test]
    fn utf16_prefix_keeps_whole_characters_only() {
        // A surrogate pair counts two units; a window of three keeps the pair and the ASCII before it.
        assert_eq!(utf16_prefix("a\u{1F600}bc", 3), "a\u{1F600}");
        assert_eq!(utf16_prefix("a\u{1F600}bc", 2), "a");
    }

    #[test]
    fn a_manual_plan_folds_everything_but_the_last_exchange() {
        let messages = vec![
            say("user", "a"),
            say("assistant", "b"),
            say("user", "c"),
            say("assistant", "d"),
        ];
        assert_eq!(
            plan_manual_compaction(&messages, None),
            Some(CompactionPlan {
                fold_from: 0,
                fold_through: 2
            })
        );
    }

    #[test]
    fn thinking_tags_are_removed_before_the_notes_are_kept() {
        assert_eq!(strip_thinking("<think>x</think>kept"), "kept");
        assert_eq!(strip_thinking("kept<think>open"), "kept");
        assert_eq!(strip_thinking("a</THINK>b"), "ab");
    }

    #[test]
    fn a_summary_with_no_fold_to_write_yields_nothing() {
        let messages = vec![say("user", "one")];
        let plan = CompactionPlan {
            fold_from: 0,
            fold_through: 0,
        };
        assert_eq!(
            summary_from_response(&messages, plan, None, 200, "{}", 0.0),
            None
        );
    }
}
