//! What one line of llama-server output says: GPU layers, prompt timing, cache reuse and draft acceptance.
//! Port of watchEngineLine and failureReason in electron/llamaProcess.cjs, and parseAcceptance in draftStats.cjs.

use std::sync::LazyLock;

use regex::Regex;

use crate::failure::{EngineLine, watch_line};

static OFFLOAD: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)offloaded ([0-9]+)/([0-9]+) layers to GPU").ok());
static ACCEPTANCE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(
        r"(?i)draft acceptance rate\s*=\s*[0-9.]+\s*\(\s*([0-9]+)\s*accepted\s*/\s*([0-9]+)\s*generated",
    )
    .ok()
});
static ERROR_WORD: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i-u)\b(error|failed|cannot|unable)\b").ok());
static LOG_PREFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^[0-9]+(\.[0-9]+)+\s+[A-Z]\s+").ok());

/// One draft-acceptance report: how many of the reply's drafted tokens were accepted, out of how many generated.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Acceptance {
    pub rate: f64,
    pub accepted: u64,
    pub generated: u64,
}

/// A line that the app reports on, or that feeds the speed the engine is running at.
#[derive(Debug, Clone, PartialEq)]
pub enum Signal {
    /// The model's layers placed on the GPU. A partial placement is only worth a warning outside a mixture of experts.
    Offload {
        layers: u64,
        total: u64,
    },
    PromptEvaluated {
        ms: f64,
        tokens: u64,
    },
    PromptCacheReused {
        how: String,
        similarity: f64,
        kept: f64,
    },
    DraftAcceptance(Acceptance),
}

/// Reads the acceptance from llama-server's report, "draft acceptance rate = 0.62857 (   44 accepted /    70 generated)".
/// A report with nothing generated carries no rate and reads as None.
pub fn parse_acceptance(line: &str) -> Option<Acceptance> {
    let captures = ACCEPTANCE.as_ref()?.captures(line)?;
    let accepted: u64 = captures.get(1)?.as_str().parse().ok()?;
    let generated: u64 = captures.get(2)?.as_str().parse().ok()?;
    if generated == 0 {
        return None;
    }
    Some(Acceptance {
        rate: accepted as f64 / generated as f64,
        accepted,
        generated,
    })
}

/// Reads one line of engine output. The offload is reported for every model; the warning about it is the caller's.
pub fn read_line(line: &str) -> Option<Signal> {
    if let Some(captures) = OFFLOAD.as_ref().and_then(|re| re.captures(line)) {
        let layers = captures.get(1)?.as_str().parse().ok()?;
        let total = captures.get(2)?.as_str().parse().ok()?;
        return Some(Signal::Offload { layers, total });
    }
    // The offload is handled above, so the shared reader only sees prompt and slot lines here.
    if let Some(event) = watch_line(line, true) {
        return Some(match event {
            EngineLine::PromptEvaluated { ms, tokens } => Signal::PromptEvaluated { ms, tokens },
            EngineLine::PromptCacheReused {
                how,
                similarity,
                kept,
            } => Signal::PromptCacheReused {
                how,
                similarity,
                kept,
            },
            EngineLine::LowOffload { layers, total } => Signal::Offload { layers, total },
        });
    }
    parse_acceptance(line).map(Signal::DraftAcceptance)
}

/// The last error lines the engine printed, without the log prefix it adds, or the last two lines when none says
/// "error" or similar.
pub fn failure_reason(lines: &[String]) -> String {
    let errors: Vec<&str> = lines
        .iter()
        .map(String::as_str)
        .filter(|line| ERROR_WORD.as_ref().is_some_and(|re| re.is_match(line)))
        .collect();
    let source: Vec<&str> = if errors.is_empty() {
        lines.iter().map(String::as_str).collect()
    } else {
        errors
    };
    source[source.len().saturating_sub(2)..]
        .iter()
        .map(|line| strip_log_prefix(line))
        .collect::<Vec<String>>()
        .join(" ")
}

/// Drops the "0.00.130.001 E " prefix llama.cpp puts on each log line, once, at the start.
fn strip_log_prefix(line: &str) -> String {
    match LOG_PREFIX.as_ref() {
        Some(re) => re.replace(line, "").into_owned(),
        None => line.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_offload_is_reported_too() {
        assert_eq!(
            read_line("load_tensors: offloaded 33/33 layers to GPU"),
            Some(Signal::Offload {
                layers: 33,
                total: 33
            })
        );
    }

    #[test]
    fn prompt_evaluation_and_slot_lines_are_read() {
        assert_eq!(
            read_line("prompt eval time =  123.4 ms / 56 tokens"),
            Some(Signal::PromptEvaluated {
                ms: 123.4,
                tokens: 56
            })
        );
        assert!(matches!(
            read_line("selected slot by LRU, f_sim_best = 0.000 (> 0.100 thold), f_keep = 0.000"),
            Some(Signal::PromptCacheReused { .. })
        ));
    }

    #[test]
    fn a_draft_report_is_read_as_an_acceptance() {
        assert_eq!(
            read_line("draft acceptance rate = 0.50000 (    4 accepted /     8 generated)"),
            Some(Signal::DraftAcceptance(Acceptance {
                rate: 0.5,
                accepted: 4,
                generated: 8,
            }))
        );
    }

    #[test]
    fn an_unrelated_line_says_nothing() {
        assert_eq!(read_line("srv  update_slots: all slots are idle"), None);
    }

    #[test]
    fn the_log_prefix_is_dropped_from_a_reason_once() {
        let lines = vec!["0.00.130.001 E llama_model_load: error loading model".to_owned()];
        assert_eq!(
            failure_reason(&lines),
            "llama_model_load: error loading model"
        );
    }
}
