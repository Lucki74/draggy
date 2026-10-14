//! Rebuilds what a cut-off reply already did, from its steps, since tool results do not survive the turn.
//! Port of `src/agent/resume.ts`. Side effects are kept; repeating a write is not free.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::compaction::utf16_prefix;
use crate::js::{is_js_space, trim_js, utf16_len, utf16_suffix};

/// Total characters the recap may occupy.
pub const RESUME_BUDGET: usize = 2000;

/// Reasoning is summarised down to its tail; the conclusion is what matters.
const THOUGHT_BUDGET: usize = 400;
const OUTPUT_BUDGET: usize = 300;
/// The longest repeat worth looking for where two halves of a reply meet.
const MAX_OVERLAP: usize = 120;
/// Short matches are coincidence, not repetition.
const MIN_OVERLAP: usize = 12;
/// Enough of the opening to recognise the model starting over.
const RESTART_SIGNATURE: usize = 60;

/// One step of the work a reply showed. Only the fields the recap reads are typed; the rest is kept as sent.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_complete: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filepath: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<StepImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<SearchResult>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_hits: Option<Vec<LibraryHit>>,
    /// Every other key the step was sent with, kept so a saved step is not trimmed.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A picture a step is drawing or has drawn.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepImage {
    pub status: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One search result a step shows.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One library a lookup found.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LibraryHit {
    pub name: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A line of the recap. Lower priority sorts first and survives trimming.
struct Line {
    priority: u8,
    text: String,
}

/// Collapses runs of whitespace to one space and trims, as the reference's `.replace(/\s+/g, " ").trim()`.
fn collapse(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if is_js_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    trim_js(&out).to_string()
}

/// The last `limit` units, with an ellipsis in front when cut.
fn tail(text: &str, limit: usize) -> String {
    let clean = collapse(text);
    if utf16_len(&clean) <= limit {
        return clean;
    }
    format!("\u{2026}{}", utf16_suffix(&clean, limit))
}

/// The first `limit` units, with an ellipsis after when cut.
fn head(text: &str, limit: usize) -> String {
    let clean = collapse(text);
    if utf16_len(&clean) <= limit {
        return clean;
    }
    format!("{}\u{2026}", utf16_prefix(&clean, limit))
}

/// Strips the markdown the step content carries for display.
fn plain(text: &str) -> String {
    let stripped = text.replace("**", "");
    let stripped = stripped.strip_suffix("...").unwrap_or(&stripped);
    trim_js(stripped).to_string()
}

/// A non-empty string, which the reference treats as true.
fn truthy(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|text| !text.is_empty())
}

/// The recap line for one step, or None when the step has nothing worth saying.
fn line_for(step: &SearchStep) -> Option<Line> {
    let label = plain(step.content.as_deref().unwrap_or(""));

    match step.kind.as_str() {
        // The single most important thing to report: it is on disk already.
        "create_file" => Some(Line {
            priority: 0,
            text: match truthy(&step.filepath) {
                Some(filepath) => format!(
                    "Created the file {} at {filepath}. It is already written; do not create it again.",
                    step.filename.as_deref().unwrap_or("")
                ),
                None => format!(
                    "Attempted to create {}: {label}",
                    step.filename.as_deref().unwrap_or("a file")
                ),
            },
        }),

        "image" => {
            let image = step.image.as_ref()?;
            if image.status != "done" {
                return None;
            }
            let saved = match truthy(&image.path) {
                Some(path) => format!(" and saved it at {path}"),
                None => String::new(),
            };
            Some(Line {
                priority: 0,
                text: format!(
                    "Drew a picture of \"{}\"{saved}. It is already made; do not draw it again.",
                    head(&image.prompt, 120)
                ),
            })
        }

        "run_code" => {
            let output = truthy(&step.stdout).map(|text| head(text, OUTPUT_BUDGET));
            let failure = truthy(&step.stderr).map(|text| head(text, OUTPUT_BUDGET));
            let mut text = format!(
                "Ran {} already.",
                step.language.as_deref().unwrap_or("code")
            );
            if let Some(output) = output {
                text.push_str(&format!(" Output: {output}"));
            }
            if let Some(failure) = failure {
                text.push_str(&format!(" Errors: {failure}"));
            }
            text.push_str(" Do not run it again unless it needs changing.");
            Some(Line { priority: 0, text })
        }

        "command" => {
            let mut text = format!("{label}.");
            if let Some(output) = truthy(&step.stdout) {
                text.push_str(&format!(" Output: {}", head(output, OUTPUT_BUDGET)));
            }
            text.push_str(" Do not run it again unless something has changed.");
            Some(Line { priority: 0, text })
        }

        "results" => {
            let titles = step
                .results
                .iter()
                .flatten()
                .take(4)
                .map(|result| format!("{} ({})", result.title, result.url))
                .collect::<Vec<_>>()
                .join("; ");
            let text = if titles.is_empty() {
                label
            } else {
                format!("Search results already gathered: {titles}")
            };
            Some(Line { priority: 1, text })
        }

        "library" => {
            let hits = step
                .library_hits
                .iter()
                .flatten()
                .take(4)
                .map(|hit| hit.name.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            let text = if hits.is_empty() {
                label
            } else {
                format!("{label} Found: {hits}")
            };
            Some(Line { priority: 1, text })
        }

        "reading" | "loaded" | "scanned" | "opening" | "navigating" | "clicking" | "typing" => {
            Some(Line {
                priority: 2,
                text: label,
            })
        }

        // The matching "results" line says more; this is only a fallback.
        "searching" => non_empty(label, 3, |label| label),

        "error" => non_empty(label, 1, |label| format!("Failed: {label}")),

        "text" => non_empty(label, 2, |label| {
            format!("Already said: {}", head(&label, 200))
        }),

        "thinking" => {
            let thought = step.content.as_deref().unwrap_or("");
            if trim_js(thought).is_empty() {
                return None;
            }
            Some(Line {
                priority: 4,
                text: format!("Reasoning so far: {}", tail(thought, THOUGHT_BUDGET)),
            })
        }

        _ => None,
    }
}

/// A line for a step that is only worth saying when it has a label.
fn non_empty(label: String, priority: u8, text: impl FnOnce(String) -> String) -> Option<Line> {
    if label.is_empty() {
        return None;
    }
    Some(Line {
        priority,
        text: text(label),
    })
}

/// A plain account of the work already done, or None when there was none. Lines are dropped least important
/// first to fit the budget, and the rest keeps the order the work happened in.
pub fn describe_completed_work(steps: &[SearchStep], budget: usize) -> Option<String> {
    // A step still in flight was interrupted; only finished work is reported as done.
    let lines: Vec<Line> = steps
        .iter()
        .filter(|step| step.is_complete != Some(false))
        .filter_map(line_for)
        .filter(|line| !line.text.is_empty())
        .collect();

    if lines.is_empty() {
        return None;
    }

    let mut order: Vec<usize> = (0..lines.len()).collect();
    order.sort_by_key(|&index| (lines[index].priority, index));

    let mut kept: Vec<usize> = Vec::new();
    let mut used = 0;
    for index in order {
        let cost = utf16_len(&lines[index].text) + 3;
        if used + cost > budget {
            continue;
        }
        used += cost;
        kept.push(index);
    }

    if kept.is_empty() {
        return None;
    }

    kept.sort_unstable();
    Some(
        kept.iter()
            .map(|&index| format!("- {}", lines[index].text))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// The message that goes on the wire ahead of the instruction to carry on, with the default budget.
pub fn build_resume_message(steps: &[SearchStep]) -> Option<String> {
    let work = describe_completed_work(steps, RESUME_BUDGET)?;
    Some(format!(
        "You were part-way through this reply when it was cut short. This is what you had already done:\n\n{work}\n\nEverything above has really happened. Carry on from there rather than starting again."
    ))
}

/// Joins a continued reply to what was written, with no separator, removing any repeated text rather than
/// trusting it. Works in UTF-16 units, as the reference does.
pub fn join_continuation(before: &str, after: &str) -> String {
    if before.is_empty() {
        return after.to_string();
    }
    if after.is_empty() {
        return before.to_string();
    }

    let before_units: Vec<u16> = before.encode_utf16().collect();
    let after_units: Vec<u16> = after.encode_utf16().collect();

    // Started over from the top: the new text is the better copy, since the old one was cut off.
    let signature = &before_units[..before_units.len().min(RESTART_SIGNATURE)];
    if signature.len() >= MIN_OVERLAP && after_units.starts_with(signature) {
        return after.to_string();
    }

    // Re-said the tail before carrying on: drop the duplicated part.
    let limit = MAX_OVERLAP.min(before_units.len()).min(after_units.len());
    for size in (MIN_OVERLAP..=limit).rev() {
        if before_units[before_units.len() - size..] == after_units[..size] {
            let mut joined = before_units.clone();
            joined.extend_from_slice(&after_units[size..]);
            return String::from_utf16_lossy(&joined);
        }
    }

    format!("{before}{after}")
}
