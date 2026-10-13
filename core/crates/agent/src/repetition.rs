//! Runaway-token and repeated-line detection on streamed text, returning the cut point: a port of
//! `src/agent/repetition.ts`. Lengths and the tail window count UTF-16 units, as JavaScript does, so cut points match.

use std::sync::OnceLock;

use crate::js::{
    CaseFold, Flags, JsRegex, cached, is_js_space, trim_end_js, trim_js, trim_start_js, utf16_len,
};

/// Text shorter than this, in UTF-16 units, is never a loop.
const MIN_TEXT_UNITS: usize = 20;
/// Repeated whole lines or phrases must repeat this often to count.
const MIN_REPEATS: usize = 3;
/// A table row repeats its cells legitimately, so a row starting with `|` must repeat this often.
const TABLE_ROW_MIN_REPEATS: usize = 20;
/// Only the last this-many UTF-16 units are scanned for an inline phrase loop.
const TAIL_WINDOW_UNITS: usize = 1000;
/// Phrase lengths tried, in UTF-16 units.
const PHRASE_UNITS: std::ops::RangeInclusive<usize> = 4..=120;
/// Trimmed phrases shorter than this are too short to be a loop.
const MIN_PHRASE_UNITS: usize = 3;
/// Trimmed blocks of lines shorter than this are not a loop.
const MIN_BLOCK_UNITS: usize = 8;
/// Characters that make a line structure rather than prose: rules, table separators, braces and the like.
const SYMBOLS: &str = "-=~*#_`|/\\.,;:{}()[]<>";

static REDACTED_MARKER: OnceLock<Option<JsRegex>> = OnceLock::new();
const REDACTED_MARKER_SOURCE: &str = r"==\s*\[REDACTED\]\s*==";
const REDACTED_LABEL: &str = "== [REDACTED] ==";

/// The outcome of a repetition check. `pattern` is the repeated text; `repeat_count` is absent for a phrase loop,
/// which always reports 3.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepetitionResult {
    pub has_loop: bool,
    pub pattern: Option<String>,
    pub repeat_count: Option<usize>,
    pub trimmed_text: String,
}

/// Scans the end of a stream for degenerate repetition and returns the text cut before it.
pub fn detect_repetition(text: &str) -> RepetitionResult {
    if text.is_empty() || utf16_len(text) < MIN_TEXT_UNITS {
        return no_loop(text);
    }
    if let Some(result) = redacted_loop(text) {
        return result;
    }
    if let Some(result) = line_loop(text) {
        return result;
    }
    phrase_loop(text).unwrap_or_else(|| no_loop(text))
}

fn no_loop(text: &str) -> RepetitionResult {
    RepetitionResult {
        has_loop: false,
        pattern: None,
        repeat_count: None,
        trimmed_text: text.to_string(),
    }
}

fn looped(pattern: String, repeat_count: Option<usize>, trimmed_text: String) -> RepetitionResult {
    RepetitionResult {
        has_loop: true,
        pattern: Some(pattern),
        repeat_count,
        trimmed_text,
    }
}

/// Refusal loops that repeat the redaction marker. Two markers are enough.
fn redacted_loop(text: &str) -> Option<RepetitionResult> {
    let marker = cached(
        &REDACTED_MARKER,
        REDACTED_MARKER_SOURCE,
        Flags {
            case: CaseFold::AsciiOnly,
            dot_all: false,
        },
    )?;
    let spans = marker.find_all(text);
    if spans.len() < 2 {
        return None;
    }
    let before_first = trim_end_js(&text[..spans[0].0]);
    let trimmed = if before_first.is_empty() {
        trim_end_js(&text[..spans[1].0])
    } else {
        before_first
    };
    Some(looped(
        REDACTED_LABEL.to_string(),
        Some(spans.len()),
        trimmed.to_string(),
    ))
}

/// A line, or a block of two or three lines, repeated at the end of the text.
fn line_loop(text: &str) -> Option<RepetitionResult> {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.len() < 3 {
        return None;
    }
    let end = lines.iter().rposition(|line| !trim_js(line).is_empty())?;
    if end < 2 {
        return None;
    }

    let last_line = trim_js(lines[end]);
    if utf16_len(last_line) >= 4 && !is_repeated_symbol_line(last_line) {
        let mut count = 0;
        let mut scan = isize::try_from(end).ok()?;
        while scan >= 0 {
            let current = trim_js(lines[usize::try_from(scan).ok()?]);
            if current == last_line {
                count += 1;
            } else if !current.is_empty() {
                break;
            }
            scan -= 1;
        }
        if count >= MIN_REPEATS {
            let keep = usize::try_from(scan + 2).unwrap_or(0).min(lines.len());
            return Some(looped(
                last_line.to_string(),
                Some(count),
                trim_end_js(&lines[..keep].join("\n")).to_string(),
            ));
        }
    }

    for block_size in [2_usize, 3] {
        if end + 1 < block_size * 3 {
            continue;
        }
        let block = trimmed_lines(&lines[end + 1 - block_size..=end]);
        if utf16_len(&block) < MIN_BLOCK_UNITS {
            continue;
        }
        let mut block_count = 1;
        let mut check = end - block_size;
        while check + 1 >= block_size {
            let start = check + 1 - block_size;
            if trimmed_lines(&lines[start..=check]) != block {
                break;
            }
            block_count += 1;
            if check < block_size {
                break;
            }
            check -= block_size;
        }
        if block_count >= MIN_REPEATS {
            let first_end = end - (block_count - 1) * block_size;
            return Some(looped(
                block,
                Some(block_count),
                trim_end_js(&lines[..=first_end].join("\n")).to_string(),
            ));
        }
    }
    None
}

fn trimmed_lines(lines: &[&str]) -> String {
    lines
        .iter()
        .map(|line| trim_js(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A repeated phrase in the last window of text. The tail is scanned in UTF-16 units.
fn phrase_loop(text: &str) -> Option<RepetitionResult> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let total = units.len();
    let window = total.min(TAIL_WINDOW_UNITS);
    let window_start = total - window;
    let tail = &units[window_start..];

    let last_line = &text[text.rfind('\n').map_or(0, |index| index + 1)..];
    let min_repeats = if trim_start_js(last_line).starts_with('|') {
        TABLE_ROW_MIN_REPEATS
    } else {
        MIN_REPEATS
    };

    for len in PHRASE_UNITS {
        if tail.len() < len * min_repeats {
            break;
        }
        let candidate = &tail[tail.len() - len..];
        let trimmed = trim_units(candidate);
        if trimmed.len() < MIN_PHRASE_UNITS || is_repeated_symbol_units(trimmed) {
            continue;
        }
        if let Some(start) = repeat_run_start(tail, candidate, min_repeats) {
            let mut joined = units[..window_start + start].to_vec();
            joined.extend_from_slice(candidate);
            return Some(looped(
                String::from_utf16_lossy(trimmed),
                // TS quirk: a phrase loop reports three repeats whatever its real count.
                Some(MIN_REPEATS),
                String::from_utf16_lossy(trim_end_units(&joined)),
            ));
        }
    }
    None
}

/// The leftmost start where `candidate` repeats at least `min` times, each copy optionally followed by whitespace,
/// running to the end of `tail`. Equals the match index of `(?:candidate\s*){min,}$`.
fn repeat_run_start(tail: &[u16], candidate: &[u16], min: usize) -> Option<usize> {
    let n = tail.len();
    let m = candidate.len();
    // best[p]: most copies a run starting with a copy at p can hold. Zero means no run starts at p.
    let mut best = vec![0_usize; n + 1];
    for p in (0..n).rev() {
        if p + m > n || tail[p..p + m] != *candidate {
            continue;
        }
        let mut count = 0;
        let mut pos = p + m;
        loop {
            if pos == n {
                count = count.max(1);
            } else if best[pos] > 0 {
                count = count.max(1 + best[pos]);
            }
            if pos < n && is_unit_space(tail[pos]) {
                pos += 1;
            } else {
                break;
            }
        }
        best[p] = count;
    }
    (0..n).find(|&p| best[p] >= min)
}

/// `^[\s\-=~*#_`|/\\.,;:{}()[\]<>]+$` on a trimmed line.
fn is_repeated_symbol_line(line: &str) -> bool {
    !line.is_empty() && line.chars().all(|c| is_js_space(c) || SYMBOLS.contains(c))
}

fn is_repeated_symbol_units(units: &[u16]) -> bool {
    !units.is_empty()
        && units.iter().all(|&unit| {
            is_unit_space(unit)
                || u8::try_from(unit).is_ok_and(|byte| SYMBOLS.as_bytes().contains(&byte))
        })
}

fn is_unit_space(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(is_js_space)
}

fn trim_units(units: &[u16]) -> &[u16] {
    let start = units
        .iter()
        .position(|&u| !is_unit_space(u))
        .unwrap_or(units.len());
    let end = units
        .iter()
        .rposition(|&u| !is_unit_space(u))
        .map_or(start, |index| index + 1);
    &units[start..end.max(start)]
}

fn trim_end_units(units: &[u16]) -> &[u16] {
    let end = units
        .iter()
        .rposition(|&u| !is_unit_space(u))
        .map_or(0, |index| index + 1);
    &units[..end]
}
