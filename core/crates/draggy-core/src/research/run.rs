//! A research run: the approved plan, its budget, the sources read, the notes and the query log.
//! Pure state with no clock or model, so the stop rule and the run state text are testable directly.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Depth {
    Quick,
    Standard,
    Deep,
}

impl Depth {
    /// The depth named by its id, or `None` for an unknown id.
    pub fn from_id(value: &str) -> Option<Self> {
        match value {
            "quick" => Some(Self::Quick),
            "standard" => Some(Self::Standard),
            "deep" => Some(Self::Deep),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Quick => "quick",
            Self::Standard => "standard",
            Self::Deep => "deep",
        }
    }
}

pub const DEPTH_IDS: [Depth; 3] = [Depth::Quick, Depth::Standard, Depth::Deep];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Web,
    Papers,
    Wiki,
    Code,
}

impl SourceKind {
    pub fn id(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Papers => "papers",
            Self::Wiki => "wiki",
            Self::Code => "code",
        }
    }
}

pub const SOURCE_KINDS: [SourceKind; 4] = [SourceKind::Web, SourceKind::Papers, SourceKind::Wiki, SourceKind::Code];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteConfidence {
    Confirmed,
    SingleSource,
    Disputed,
}

impl NoteConfidence {
    pub fn id(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::SingleSource => "single_source",
            Self::Disputed => "disputed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Reading,
    Read,
    Skipped,
    Blocked,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Planning,
    Gathering,
    Writing,
    Done,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    Budget,
    Dry,
    Covered,
    Finished,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DepthSpec {
    pub wall_ms: u64,
    pub tool_calls: usize,
    pub min_questions: usize,
    pub max_questions: usize,
    pub target_sources: usize,
    pub notes_per_question: usize,
}

/// Wall clock is the main limit, so a slow local model takes fewer steps in the same time.
pub const fn depth_spec(depth: Depth) -> DepthSpec {
    match depth {
        Depth::Quick => DepthSpec {
            wall_ms: 2 * 60_000,
            tool_calls: 20,
            min_questions: 2,
            max_questions: 3,
            target_sources: 6,
            notes_per_question: 1,
        },
        Depth::Standard => DepthSpec {
            wall_ms: 10 * 60_000,
            tool_calls: 80,
            min_questions: 4,
            max_questions: 6,
            target_sources: 20,
            notes_per_question: 2,
        },
        Depth::Deep => DepthSpec {
            wall_ms: 30 * 60_000,
            tool_calls: 200,
            min_questions: 6,
            max_questions: 8,
            target_sources: 25,
            notes_per_question: 2,
        },
    }
}

/// The share of the budget after which the model is told to start writing.
pub const WRAP_AT: f64 = 0.8;
/// Searches in a row that add no note before the run stops looking.
pub const DRY_SEARCHES: usize = 3;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchPlan {
    pub question: String,
    pub sub_questions: Vec<String>,
    pub depth: Depth,
    pub sources: Vec<SourceKind>,
}

/// A list from the model: a JSON array, or a text blob split on lines or on commas and spaces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawList {
    Items(Vec<String>),
    Text(String),
}

/// Trims the plan to what the depth allows, so a model that drafts twelve questions still fits the budget.
pub fn read_plan(question: &str, sub_questions: RawList, depth: Option<&str>, sources: RawList) -> Option<ResearchPlan> {
    let question = question.trim();
    if question.is_empty() {
        return None;
    }
    let depth = depth.and_then(Depth::from_id).unwrap_or(Depth::Standard);
    let lines = match sub_questions {
        RawList::Items(items) => items,
        RawList::Text(text) => text.split('\n').map(str::to_owned).collect(),
    };
    let mut subs: Vec<String> = Vec::new();
    for line in &lines {
        let item = strip_marker(line);
        if !item.is_empty() && !subs.iter().any(|existing| existing == item) {
            subs.push(item.to_owned());
        }
    }
    subs.truncate(depth_spec(depth).max_questions);
    let kinds = match sources {
        RawList::Items(items) => items,
        RawList::Text(text) => text
            .split(|c: char| c == ',' || c.is_whitespace())
            .map(str::to_owned)
            .collect(),
    };
    let mut kept: Vec<SourceKind> = SOURCE_KINDS
        .into_iter()
        .filter(|kind| kinds.iter().any(|name| name == kind.id()))
        .collect();
    if kept.is_empty() {
        kept.push(SourceKind::Web);
    }
    if subs.is_empty() {
        subs.push(question.to_owned());
    }
    Some(ResearchPlan {
        question: question.to_owned(),
        sub_questions: subs,
        depth,
        sources: kept,
    })
}

/// Removes one leading list marker such as `-`, `*`, `1.` or `2)`, then trims.
fn strip_marker(line: &str) -> &str {
    let trimmed = line.trim_start();
    let rest = if let Some(after) = trimmed.strip_prefix(['-', '*']) {
        after
    } else {
        let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
        match trimmed.as_bytes().get(digits) {
            Some(b'.' | b')') if digits > 0 => &trimmed[digits + 1..],
            _ => trimmed,
        }
    };
    rest.trim()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchSource {
    pub id: String,
    pub url: String,
    pub key: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    pub status: SourceStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchNote {
    pub id: String,
    pub sub_question: usize,
    pub claim: String,
    pub quote: String,
    pub source_id: String,
    pub confidence: NoteConfidence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryEntry {
    pub query: String,
    pub key: String,
    pub kind: SourceKind,
    pub urls: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchRun {
    pub id: String,
    pub plan: ResearchPlan,
    pub status: RunStatus,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    pub tool_calls: usize,
    pub sources: Vec<ResearchSource>,
    pub notes: Vec<ResearchNote>,
    pub queries: Vec<QueryEntry>,
    pub contacted_hosts: Vec<String>,
    pub dry_streak: usize,
    pub notes_at_last_search: usize,
    #[serde(default)]
    pub reads_at_last_search: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<StopReason>,
}

pub fn create_run(id: &str, plan: ResearchPlan, now: u64) -> ResearchRun {
    ResearchRun {
        id: id.to_owned(),
        plan,
        status: RunStatus::Gathering,
        started_at: now,
        ended_at: None,
        tool_calls: 0,
        sources: Vec::new(),
        notes: Vec::new(),
        queries: Vec::new(),
        contacted_hosts: Vec::new(),
        dry_streak: 0,
        notes_at_last_search: 0,
        reads_at_last_search: 0,
        stop_reason: None,
    }
}

const STOP_WORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to",
    "what", "when", "where", "which", "who", "why", "with", "vs", "versus",
];

/// Word order, case, punctuation and filler words do not make a new query.
pub fn normalise_query(query: &str) -> String {
    let cleaned: String = query
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let mut words: Vec<&str> = cleaned
        .split_whitespace()
        .filter(|word| !STOP_WORDS.contains(word))
        .collect();
    words.sort_unstable();
    words.dedup();
    words.join(" ")
}

struct ParsedUrl {
    host: String,
    path: String,
    query: String,
}

/// A small http(s)-style URL split: scheme, host, path and query. Fragments are dropped.
fn parse_url(input: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = input.split_once("://")?;
    let valid_scheme = scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid_scheme {
        return None;
    }
    let rest = rest.split_once('#').map_or(rest, |(before, _)| before);
    let (before_query, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (authority, path) = before_query
        .find('/')
        .map_or((before_query, ""), |index| before_query.split_at(index));
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let host = if host_port.starts_with('[') {
        host_port.split_inclusive(']').next().unwrap_or("")
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    if host.is_empty() {
        return None;
    }
    let path = if path.is_empty() { "/" } else { path };
    Some(ParsedUrl {
        host: host.to_ascii_lowercase(),
        path: path.to_owned(),
        query: query.to_owned(),
    })
}

fn is_tracking_param(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("utm_") || matches!(lower.as_str(), "fbclid" | "gclid" | "ref" | "ref_src" | "mc_cid" | "mc_eid")
}

/// The same page reached through tracking links or a trailing slash is one source.
pub fn source_key(url: &str) -> String {
    let Some(parsed) = parse_url(url) else {
        return url.trim().to_owned();
    };
    let kept: Vec<&str> = parsed
        .query
        .split('&')
        .filter(|pair| !pair.is_empty() && !is_tracking_param(pair.split('=').next().unwrap_or("")))
        .collect();
    let search = if kept.is_empty() { String::new() } else { format!("?{}", kept.join("&")) };
    let path = if parsed.path.len() > 1 {
        parsed.path.trim_end_matches('/')
    } else {
        parsed.path.as_str()
    };
    let host = parsed.host.strip_prefix("www.").unwrap_or(&parsed.host);
    format!("{host}{path}{search}")
}

/// The lowercased host of a URL, or `None` when it has none.
pub fn host_of(url: &str) -> Option<String> {
    parse_url(url).map(|parsed| parsed.host)
}

pub fn record_host(run: &mut ResearchRun, url: &str) {
    if let Some(host) = host_of(url)
        && !run.contacted_hosts.contains(&host)
    {
        run.contacted_hosts.push(host);
    }
}

/// A repeat returns the earlier entry, so the tool can answer it without spending a search.
pub fn find_repeat<'a>(run: &'a ResearchRun, query: &str, kind: SourceKind) -> Option<&'a QueryEntry> {
    let key = normalise_query(query);
    if key.is_empty() {
        return None;
    }
    run.queries.iter().find(|entry| entry.key == key && entry.kind == kind)
}

fn opened(run: &ResearchRun) -> usize {
    run.sources
        .iter()
        .filter(|source| !matches!(source.status, SourceStatus::Reading | SourceStatus::Skipped))
        .count()
}

/// Moves the dry streak: pages opened since the last search with no new note count as dry; no pages leaves it.
pub fn log_search(run: &mut ResearchRun, query: &str, kind: SourceKind, urls: Vec<String>) {
    if run.notes.len() > run.notes_at_last_search {
        run.dry_streak = 0;
    } else if opened(run) > run.reads_at_last_search {
        run.dry_streak += 1;
    }
    run.notes_at_last_search = run.notes.len();
    run.reads_at_last_search = opened(run);
    run.queries.push(QueryEntry {
        query: query.trim().to_owned(),
        key: normalise_query(query),
        kind,
        urls,
    });
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceInput<'a> {
    pub url: &'a str,
    pub title: Option<&'a str>,
    pub site: Option<&'a str>,
    pub published: Option<&'a str>,
    pub status: Option<SourceStatus>,
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// Adds a page, or updates the existing entry for the same source key. Returns a copy of the entry.
pub fn add_source(run: &mut ResearchRun, input: SourceInput<'_>) -> ResearchSource {
    let key = source_key(input.url);
    let index = if let Some(index) = run.sources.iter().position(|source| source.key == key) {
        let existing = &mut run.sources[index];
        if let Some(status) = input.status {
            existing.status = status;
        }
        if let Some(title) = non_empty(input.title)
            && existing.title.is_empty()
        {
            existing.title = title.to_owned();
        }
        if let Some(site) = non_empty(input.site)
            && existing.site.is_none()
        {
            existing.site = Some(site.to_owned());
        }
        if let Some(published) = non_empty(input.published)
            && existing.published.is_none()
        {
            existing.published = Some(published.to_owned());
        }
        index
    } else {
        let title = input
            .title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .unwrap_or(input.url)
            .to_owned();
        let source = ResearchSource {
            id: format!("s{}", run.sources.len() + 1),
            url: input.url.to_owned(),
            key,
            title,
            site: non_empty(input.site).map(str::to_owned),
            published: non_empty(input.published).map(str::to_owned),
            status: input.status.unwrap_or(SourceStatus::Reading),
        };
        run.sources.push(source);
        run.sources.len() - 1
    };
    run.sources[index].clone()
}

/// Finds a source by its id (such as `s1`), or by its URL.
pub fn find_source<'a>(run: &'a ResearchRun, reference: &str) -> Option<&'a ResearchSource> {
    let trimmed = reference.trim();
    run.sources
        .iter()
        .find(|source| source.id == trimmed)
        .or_else(|| {
            let key = source_key(trimmed);
            run.sources.iter().find(|source| source.key == key)
        })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NoteInput<'a> {
    pub sub_question: Option<&'a str>,
    pub claim: &'a str,
    pub quote: &'a str,
    pub source: &'a str,
    pub confidence: Option<&'a str>,
}

/// Reads a leading integer the way `parseInt` does: whitespace, an optional sign, then digits.
fn parse_int_prefix(text: &str) -> Option<i64> {
    let trimmed = text.trim_start();
    let (sign, digits) = if let Some(rest) = trimmed.strip_prefix('-') {
        (-1, rest)
    } else {
        (1, trimmed.strip_prefix('+').unwrap_or(trimmed))
    };
    let count = digits.bytes().take_while(u8::is_ascii_digit).count();
    if count == 0 {
        return None;
    }
    digits[..count].parse::<i64>().ok().map(|value| sign * value)
}

/// A note must point at a page the model actually read, so a citation can never name an unopened URL.
pub fn add_note(run: &mut ResearchRun, input: NoteInput<'_>) -> Result<ResearchNote, String> {
    let claim = input.claim.trim();
    if claim.is_empty() {
        return Err("The note had no claim. Write what you learned in one sentence.".to_owned());
    }
    let quote = input.quote.trim();
    if quote.is_empty() {
        return Err("The note had no quote. Copy the exact sentence from the page that supports it.".to_owned());
    }
    let Some((source_id, status)) = find_source(run, input.source).map(|source| (source.id.clone(), source.status)) else {
        return Err("That source is not one you have read. Use the source id read_url gave, such as s1.".to_owned());
    };
    if status != SourceStatus::Read {
        return Err(format!(
            "Source {source_id} was not read successfully, so it cannot support a note."
        ));
    }
    let count = run.plan.sub_questions.len();
    let index = input.sub_question.and_then(parse_int_prefix).unwrap_or(1);
    let sub_question = usize::try_from(index)
        .ok()
        .filter(|value| (1..=count).contains(value))
        .unwrap_or(1);
    let confidence = match input.confidence {
        Some("confirmed") => NoteConfidence::Confirmed,
        Some("disputed") => NoteConfidence::Disputed,
        _ => NoteConfidence::SingleSource,
    };
    let note = ResearchNote {
        id: format!("n{}", run.notes.len() + 1),
        sub_question,
        claim: claim.to_owned(),
        quote: quote.to_owned(),
        source_id,
        confidence,
        verified: None,
    };
    run.notes.push(note.clone());
    Ok(note)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Budget {
    pub elapsed_ms: u64,
    pub wall_ms: u64,
    pub calls_used: usize,
    pub call_limit: usize,
    /// The larger of the time share and the call share used, 0 to 1 and beyond.
    pub used: f64,
    pub wrap: bool,
    pub over: bool,
}

pub fn budget_of(run: &ResearchRun, now: u64) -> Budget {
    let spec = depth_spec(run.plan.depth);
    let elapsed_ms = now.saturating_sub(run.started_at);
    let used = (elapsed_ms as f64 / spec.wall_ms as f64).max(run.tool_calls as f64 / spec.tool_calls as f64);
    Budget {
        elapsed_ms,
        wall_ms: spec.wall_ms,
        calls_used: run.tool_calls,
        call_limit: spec.tool_calls,
        used,
        wrap: used >= WRAP_AT,
        over: used >= 1.0,
    }
}

/// Notes that count towards a sub-question: disputed and failed-verification notes do not.
fn supporting_notes(run: &ResearchRun, sub_question: usize) -> usize {
    run.notes
        .iter()
        .filter(|note| {
            note.sub_question == sub_question && note.confidence != NoteConfidence::Disputed && note.verified != Some(false)
        })
        .count()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Coverage {
    pub sub_question: usize,
    pub text: String,
    pub notes: usize,
    pub enough: bool,
}

pub fn coverage(run: &ResearchRun) -> Vec<Coverage> {
    let need = depth_spec(run.plan.depth).notes_per_question;
    run.plan
        .sub_questions
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let notes = supporting_notes(run, index + 1);
            Coverage {
                sub_question: index + 1,
                text: text.clone(),
                notes,
                enough: notes >= need,
            }
        })
        .collect()
}

pub fn stop_reason(run: &ResearchRun, now: u64) -> Option<StopReason> {
    if let Some(reason) = run.stop_reason {
        return Some(reason);
    }
    if budget_of(run, now).over {
        return Some(StopReason::Budget);
    }
    if run.dry_streak >= DRY_SEARCHES {
        return Some(StopReason::Dry);
    }
    if coverage(run).iter().all(|entry| entry.enough) {
        return Some(StopReason::Covered);
    }
    None
}

/// Counts one research tool call. Returns why gathering must stop, which the tool turns into "write now".
pub fn tick(run: &mut ResearchRun, now: u64) -> Option<StopReason> {
    run.tool_calls += 1;
    let reason = stop_reason(run, now);
    if let Some(reason) = reason
        && run.status == RunStatus::Gathering
    {
        run.status = RunStatus::Writing;
        run.stop_reason = Some(reason);
    }
    reason
}

pub fn finish(run: &mut ResearchRun, reason: StopReason) {
    if run.status == RunStatus::Gathering {
        run.status = RunStatus::Writing;
    }
    if run.stop_reason.is_none() {
        run.stop_reason = Some(reason);
    }
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() > max {
        let head: String = text.chars().take(max - 1).collect();
        format!("{head}…")
    } else {
        text.to_owned()
    }
}

fn minutes(ms: u64) -> String {
    format!("{} min", (ms as f64 / 6000.0).round() / 10.0)
}

fn stop_text(reason: StopReason) -> &'static str {
    match reason {
        StopReason::Budget => "The research budget is spent.",
        StopReason::Dry => "The last searches found nothing new.",
        StopReason::Covered => "Every sub-question has enough supported notes.",
        StopReason::Finished => "You ended the research.",
    }
}

/// The compact run state the model sees each step: plan coverage, notes, queries and budget, never page text.
pub fn render_run_state(run: &ResearchRun, now: u64) -> String {
    let budget = budget_of(run, now);
    let mut lines = vec![
        format!("RESEARCH: {}", run.plan.question),
        format!("Depth {}.", run.plan.depth.id()),
        format!(
            "Budget: {} of {}, {} of {} tool calls.",
            minutes(budget.elapsed_ms),
            minutes(budget.wall_ms),
            budget.calls_used,
            budget.call_limit
        ),
        "Sub-questions:".to_owned(),
    ];
    for entry in coverage(run) {
        lines.push(format!(
            "{}. [{}] {} ({} notes)",
            entry.sub_question,
            if entry.enough { "x" } else { " " },
            entry.text,
            entry.notes
        ));
    }
    if !run.notes.is_empty() {
        lines.push("Notes:".to_owned());
        let start = run.notes.len().saturating_sub(40);
        for note in &run.notes[start..] {
            lines.push(format!(
                "{} q{} {} {}: {}",
                note.id,
                note.sub_question,
                note.source_id,
                note.confidence.id(),
                clip(&note.claim, 160)
            ));
        }
    }
    if !run.queries.is_empty() {
        let start = run.queries.len().saturating_sub(15);
        let searched: Vec<String> = run.queries[start..]
            .iter()
            .map(|entry| format!("\"{}\"", clip(&entry.query, 60)))
            .collect();
        lines.push(format!("Searched: {}", searched.join(", ")));
    }
    if let Some(reason) = stop_reason(run, now) {
        lines.push(format!(
            "{} Stop searching and write the report now from your notes, citing note ids like [n1].",
            stop_text(reason)
        ));
    } else if budget.wrap {
        lines.push("Most of the budget is used. Fill only the sub-questions without notes, then write the report.".to_owned());
    } else if let Some(open) = coverage(run).into_iter().find(|entry| !entry.enough) {
        lines.push(format!("Next: find support for sub-question {}.", open.sub_question));
    }
    lines.join("\n")
}

/// The loop cap for a turn that carries a run: its call budget plus room to plan and write.
pub fn loop_limit_for(run: Option<&ResearchRun>, base: usize) -> usize {
    match run {
        Some(run) => base.max(depth_spec(run.plan.depth).tool_calls + 20),
        None => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_of(depth: &str, questions: &[&str]) -> ResearchRun {
        let subs = RawList::Items(questions.iter().map(|q| (*q).to_owned()).collect());
        let plan = read_plan("Topic", subs, Some(depth), RawList::Items(vec!["web".to_owned()])).expect("plan");
        create_run("r1", plan, 0)
    }

    fn read_source(run: &mut ResearchRun, url: &str) -> ResearchSource {
        add_source(
            run,
            SourceInput {
                url,
                title: Some(url),
                status: Some(SourceStatus::Read),
                ..Default::default()
            },
        )
    }

    fn note_of<'a>(claim: &'a str, quote: &'a str, source: &'a str) -> NoteInput<'a> {
        NoteInput {
            claim,
            quote,
            source,
            ..Default::default()
        }
    }

    #[test]
    fn read_plan_strips_list_markers_dedupes_and_caps_by_depth() {
        let plan = read_plan("Q", RawList::Text("1. a\n- b\n* a\n2) c\nd".to_owned()), Some("quick"), RawList::Text(String::new())).expect("plan");
        assert_eq!(plan.sub_questions, vec!["a", "b", "c"]);
        assert_eq!(plan.depth, Depth::Quick);
    }

    #[test]
    fn read_plan_falls_back_to_standard_depth_web_source_and_the_question() {
        let plan = read_plan("Q", RawList::Items(vec![]), Some("huge"), RawList::Text("nope".to_owned()));
        assert_eq!(
            plan,
            Some(ResearchPlan {
                question: "Q".to_owned(),
                sub_questions: vec!["Q".to_owned()],
                depth: Depth::Standard,
                sources: vec![SourceKind::Web],
            })
        );
    }

    #[test]
    fn read_plan_rejects_an_empty_question() {
        assert!(read_plan("  ", RawList::Text(String::new()), None, RawList::Text(String::new())).is_none());
    }

    #[test]
    fn read_plan_keeps_known_source_kinds_from_a_comma_list() {
        let plan = read_plan("Q", RawList::Text(String::new()), None, RawList::Text("papers, wiki,bogus".to_owned()));
        assert_eq!(plan.map(|p| p.sources), Some(vec![SourceKind::Papers, SourceKind::Wiki]));
    }

    #[test]
    fn normalise_query_treats_word_order_case_and_filler_as_the_same() {
        assert_eq!(
            normalise_query("What is the Rust borrow checker?"),
            normalise_query("rust Borrow checker")
        );
    }

    #[test]
    fn find_repeat_finds_repeats_per_source_kind_only() {
        let mut r = run_of("standard", &["What", "Why"]);
        log_search(&mut r, "rust borrow checker", SourceKind::Web, vec![]);
        assert!(find_repeat(&r, "Borrow checker in Rust", SourceKind::Web).is_some());
        assert!(find_repeat(&r, "Borrow checker in Rust", SourceKind::Papers).is_none());
    }

    #[test]
    fn source_key_collapses_tracking_links_and_trailing_slashes() {
        assert_eq!(
            source_key("https://www.example.com/a/?utm_source=x#top"),
            source_key("https://example.com/a")
        );
        assert_ne!(source_key("https://example.com/a?id=2"), source_key("https://example.com/a"));
    }

    #[test]
    fn add_source_gives_one_id_per_page_and_updates_its_status() {
        let mut r = run_of("standard", &["What", "Why"]);
        let first = add_source(&mut r, SourceInput { url: "https://example.com/a", ..Default::default() });
        let again = add_source(
            &mut r,
            SourceInput {
                url: "https://example.com/a/",
                status: Some(SourceStatus::Read),
                ..Default::default()
            },
        );
        assert_eq!(again.id, first.id);
        assert_eq!(again.status, SourceStatus::Read);
        assert_eq!(r.sources.len(), 1);
    }

    #[test]
    fn record_host_records_each_contacted_host_once() {
        let mut r = run_of("standard", &["What", "Why"]);
        record_host(&mut r, "https://Example.com/a");
        record_host(&mut r, "https://example.com/b");
        record_host(&mut r, "not a url");
        assert_eq!(r.contacted_hosts, vec!["example.com"]);
    }

    #[test]
    fn add_note_needs_a_claim_a_quote_and_a_read_source() {
        let mut r = run_of("standard", &["What", "Why"]);
        add_source(&mut r, SourceInput { url: "https://example.com/unread", ..Default::default() });
        assert!(add_note(&mut r, note_of("", "q", "s1")).unwrap_err().contains("no claim"));
        assert!(add_note(&mut r, note_of("c", "", "s1")).unwrap_err().contains("no quote"));
        assert!(add_note(&mut r, note_of("c", "q", "s9")).unwrap_err().contains("not one you have read"));
        assert!(add_note(&mut r, note_of("c", "q", "s1")).unwrap_err().contains("not read successfully"));
    }

    #[test]
    fn add_note_accepts_a_source_by_id_or_url_and_clamps_the_sub_question() {
        let mut r = run_of("standard", &["What", "Why"]);
        read_source(&mut r, "https://example.com/a");
        let by_id = add_note(
            &mut r,
            NoteInput {
                sub_question: Some("2"),
                confidence: Some("confirmed"),
                ..note_of("c", "q", "s1")
            },
        )
        .expect("note");
        let by_url = add_note(
            &mut r,
            NoteInput {
                sub_question: Some("9"),
                ..note_of("c", "q", "https://example.com/a/")
            },
        )
        .expect("note");
        assert_eq!(by_id.id, "n1");
        assert_eq!(by_id.sub_question, 2);
        assert_eq!(by_id.confidence, NoteConfidence::Confirmed);
        assert_eq!(by_url.id, "n2");
        assert_eq!(by_url.sub_question, 1);
        assert_eq!(by_url.confidence, NoteConfidence::SingleSource);
    }

    #[test]
    fn stop_rule_stops_when_every_sub_question_has_enough_notes() {
        let mut r = run_of("quick", &["a", "b"]);
        read_source(&mut r, "https://example.com/a");
        add_note(&mut r, NoteInput { sub_question: Some("1"), ..note_of("c", "q", "s1") }).expect("note");
        assert_eq!(stop_reason(&r, 0), None);
        add_note(&mut r, NoteInput { sub_question: Some("2"), ..note_of("c", "q", "s1") }).expect("note");
        assert_eq!(stop_reason(&r, 0), Some(StopReason::Covered));
    }

    #[test]
    fn stop_rule_does_not_count_disputed_or_unverified_notes() {
        let mut r = run_of("quick", &["a"]);
        read_source(&mut r, "https://example.com/a");
        add_note(&mut r, NoteInput { confidence: Some("disputed"), ..note_of("c", "q", "s1") }).expect("note");
        add_note(&mut r, note_of("c", "q", "s1")).expect("note");
        r.notes[1].verified = Some(false);
        assert_eq!(coverage(&r)[0].notes, 0);
    }

    #[test]
    fn stop_rule_stops_after_three_rounds_of_reading_add_no_note() {
        let mut r = run_of("standard", &["What", "Why"]);
        log_search(&mut r, "one", SourceKind::Web, vec![]);
        for n in 1..=2 {
            read_source(&mut r, &format!("https://example.com/{n}"));
            log_search(&mut r, &format!("q{n}"), SourceKind::Web, vec![]);
        }
        assert_eq!(stop_reason(&r, 0), None);
        read_source(&mut r, "https://example.com/3");
        log_search(&mut r, "q3", SourceKind::Web, vec![]);
        assert_eq!(stop_reason(&r, 0), Some(StopReason::Dry));
    }

    #[test]
    fn stop_rule_ignores_parallel_searches_with_no_page_read_between() {
        let mut r = run_of("deep", &["What", "Why"]);
        for q in ["a", "b", "c", "d", "e"] {
            log_search(&mut r, q, SourceKind::Web, vec![]);
        }
        assert_eq!(r.dry_streak, 0);
        assert_eq!(stop_reason(&r, 0), None);
    }

    #[test]
    fn stop_rule_resets_the_dry_streak_when_a_note_lands_between_searches() {
        let mut r = run_of("standard", &["What", "Why"]);
        read_source(&mut r, "https://example.com/a");
        log_search(&mut r, "one", SourceKind::Web, vec![]);
        log_search(&mut r, "two", SourceKind::Web, vec![]);
        add_note(&mut r, note_of("c", "q", "s1")).expect("note");
        log_search(&mut r, "three", SourceKind::Web, vec![]);
        assert_eq!(r.dry_streak, 0);
    }

    #[test]
    fn stop_rule_warns_at_80_percent_and_stops_at_the_budget() {
        let r = run_of("quick", &["What", "Why"]);
        let wall = depth_spec(Depth::Quick).wall_ms;
        assert!(!budget_of(&r, wall * 5 / 10).wrap);
        assert!(budget_of(&r, wall * 8 / 10).wrap);
        assert_eq!(stop_reason(&r, wall), Some(StopReason::Budget));
    }

    #[test]
    fn stop_rule_counts_tool_calls_against_the_cap_and_moves_to_writing() {
        let mut r = run_of("quick", &["What", "Why"]);
        for _ in 0..(depth_spec(Depth::Quick).tool_calls - 1) {
            assert_eq!(tick(&mut r, 0), None);
        }
        assert_eq!(tick(&mut r, 0), Some(StopReason::Budget));
        assert_eq!(r.status, RunStatus::Writing);
        assert_eq!(r.stop_reason, Some(StopReason::Budget));
    }

    #[test]
    fn render_run_state_shows_coverage_notes_and_the_next_step() {
        let mut r = run_of("standard", &["What", "Why"]);
        read_source(&mut r, "https://example.com/a");
        add_note(&mut r, note_of("Rust has a borrow checker", "q", "s1")).expect("note");
        log_search(&mut r, "rust borrow", SourceKind::Web, vec![]);
        let text = render_run_state(&r, 60_000);
        assert!(text.contains("1. [ ] What (1 notes)"));
        assert!(text.contains("n1 q1 s1 single_source: Rust has a borrow checker"));
        assert!(text.contains("Searched: \"rust borrow\""));
        assert!(text.contains("Next: find support for sub-question 1."));
    }

    #[test]
    fn render_run_state_tells_the_model_to_write_once_gathering_stops() {
        let r = run_of("quick", &["What", "Why"]);
        assert!(render_run_state(&r, depth_spec(Depth::Quick).wall_ms).contains("write the report now"));
    }

    #[test]
    fn loop_limit_for_raises_the_cap_only_during_a_run() {
        assert_eq!(loop_limit_for(None, 30), 30);
        let r = run_of("deep", &["What", "Why"]);
        assert_eq!(loop_limit_for(Some(&r), 30), depth_spec(Depth::Deep).tool_calls + 20);
    }
}
