//! Why a llama-server process stopped, read from the lines it printed, and the lines that report speed while it runs.
//! Port of `classifyFailure` and `watchEngineLine` in electron/llamaProcess.cjs.

use std::sync::LazyLock;

use regex::Regex;

use crate::js;

/// Known causes, in the order they are tried, matched against what the engine printed.
const FAILURE_CAUSES: [(&str, &str); 7] = [
    (
        "out-of-vram",
        r"out of memory|cudaMalloc failed|failed to allocate .*(cuda|vulkan|metal)|vk::.*OutOfDeviceMemory|ErrorOutOfDeviceMemory",
    ),
    (
        "out-of-ram",
        r"unable to allocate|std::bad_alloc|failed to allocate .*(cpu|host)|not enough memory",
    ),
    (
        "port-in-use",
        r"address already in use|couldn't bind|failed to bind|EADDRINUSE",
    ),
    (
        "missing-shard",
        r"(split|shard).*(missing|not found|no such)|failed to open GGUF.*-0000d-of-",
    ),
    (
        "unsupported-architecture",
        r"unknown model architecture|unsupported .*architecture|unknown .*architecture",
    ),
    (
        "corrupt-gguf",
        r"not a gguf|invalid magic|failed to load model|tensor .* data is not within|corrupt|truncated (file|gguf|model)|file .*truncated|GGUF.*(invalid|error)",
    ),
    (
        "gpu-init",
        r"cuda error|CUDA.*(init|driver)|ggml_vulkan.*(error|fail)|vkCreate|no CUDA-capable|failed to initialize.*(cuda|vulkan|metal)",
    ),
];

static CAUSES: LazyLock<Vec<(&'static str, Option<Regex>)>> = LazyLock::new(|| {
    FAILURE_CAUSES
        .iter()
        .map(|(cause, pattern)| (*cause, Regex::new(&format!("(?i){pattern}")).ok()))
        .collect()
});

/// A short slug for why the engine stopped, or "unknown". The raw lines are logged beside it.
pub fn classify_failure(lines: &[&str]) -> &'static str {
    let text = lines.join("\n");
    for (cause, pattern) in CAUSES.iter() {
        if pattern.as_ref().is_some_and(|re| re.is_match(&text)) {
            return cause;
        }
    }
    "unknown"
}

/// One line of engine output that the app reports on.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineLine {
    /// Fewer layers reached the GPU than the model has, outside a mixture of experts: generation runs at RAM speed for the rest.
    LowOffload { layers: u64, total: u64 },
    /// How long one prompt took to evaluate.
    PromptEvaluated { ms: f64, tokens: u64 },
    /// How much of the last prompt the slot kept, so a slow reply can be told from a cold cache.
    PromptCacheReused {
        how: String,
        similarity: f64,
        kept: f64,
    },
}

static OFFLOAD: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)offloaded ([0-9]+)/([0-9]+) layers to GPU").ok());
static PROMPT_EVAL: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)prompt eval time\s*=\s*([0-9.]+)\s*ms\s*/\s*([0-9]+)\s*tokens").ok()
});
static SLOT: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(
        r"(?i)selected slot by (LCP similarity|LRU).*?f_sim_best = ([0-9.]+).*?f_keep = ([0-9.]+)",
    )
    .ok()
});

/// Reads one line of engine output. Lines that report nothing the app shows return None.
pub fn watch_line(line: &str, moe: bool) -> Option<EngineLine> {
    if let Some(captures) = OFFLOAD.as_ref().and_then(|re| re.captures(line)) {
        let layers = captures.get(1).and_then(|m| js::parse_int(m.as_str()))?;
        let total = captures.get(2).and_then(|m| js::parse_int(m.as_str()))?;
        return (layers < total && !moe).then_some(EngineLine::LowOffload {
            layers: layers as u64,
            total: total as u64,
        });
    }
    if let Some(captures) = PROMPT_EVAL.as_ref().and_then(|re| re.captures(line)) {
        let ms = captures
            .get(1)
            .map_or(f64::NAN, |m| parse_number(m.as_str()));
        let tokens = captures.get(2).and_then(|m| js::parse_int(m.as_str()))?;
        return Some(EngineLine::PromptEvaluated {
            ms,
            tokens: tokens as u64,
        });
    }
    let captures = SLOT.as_ref().and_then(|re| re.captures(line))?;
    Some(EngineLine::PromptCacheReused {
        how: captures
            .get(1)
            .map_or_else(String::new, |m| m.as_str().to_owned()),
        similarity: captures
            .get(2)
            .map_or(f64::NAN, |m| parse_number(m.as_str())),
        kept: captures
            .get(3)
            .map_or(f64::NAN, |m| parse_number(m.as_str())),
    })
}

/// `Number(text)` for the decimal text the patterns above accept.
fn parse_number(text: &str) -> f64 {
    text.parse::<f64>().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_known_cause() {
        assert_eq!(
            classify_failure(&["ggml_cuda_init: failed", "CUDA error: out of memory"]),
            "out-of-vram"
        );
        assert_eq!(
            classify_failure(&["terminate called after throwing std::bad_alloc"]),
            "out-of-ram"
        );
        assert_eq!(
            classify_failure(&["couldn't bind HTTP server socket, address already in use"]),
            "port-in-use"
        );
        assert_eq!(
            classify_failure(&[
                "llama_model_load: error loading model architecture: unknown model architecture: 'foo'"
            ]),
            "unsupported-architecture"
        );
        assert_eq!(
            classify_failure(&["gguf_init_from_file: invalid magic characters"]),
            "corrupt-gguf"
        );
    }

    #[test]
    fn anything_else_is_unknown() {
        assert_eq!(classify_failure(&["something nobody has seen"]), "unknown");
        assert_eq!(
            classify_failure(&[
                "slot release: id  0 | task 0 | stop processing: n_tokens = 22, truncated = 0"
            ]),
            "unknown"
        );
        assert_eq!(classify_failure(&[]), "unknown");
    }

    #[test]
    fn the_first_matching_cause_wins() {
        assert_eq!(
            classify_failure(&["out of memory", "invalid magic"]),
            "out-of-vram"
        );
    }

    #[test]
    fn a_slot_line_reports_how_much_of_the_prompt_was_kept() {
        let line = "slot get_availabl: id  0 | task -1 | selected slot by LCP similarity, f_sim_best = 0.778 (> 0.100 thold), f_keep = 0.636";
        assert_eq!(
            watch_line(line, false),
            Some(EngineLine::PromptCacheReused {
                how: "LCP similarity".to_owned(),
                similarity: 0.778,
                kept: 0.636,
            })
        );
    }

    #[test]
    fn a_low_offload_is_reported_unless_the_model_is_a_mixture_of_experts() {
        assert_eq!(
            watch_line("load_tensors: offloaded 30/33 layers to GPU", false),
            Some(EngineLine::LowOffload {
                layers: 30,
                total: 33
            })
        );
        assert_eq!(
            watch_line("load_tensors: offloaded 33/33 layers to GPU", false),
            None
        );
        assert_eq!(
            watch_line("load_tensors: offloaded 30/33 layers to GPU", true),
            None
        );
    }

    #[test]
    fn prompt_evaluation_time_is_reported() {
        assert_eq!(
            watch_line("prompt eval time =  123.4 ms / 56 tokens", false),
            Some(EngineLine::PromptEvaluated {
                ms: 123.4,
                tokens: 56
            })
        );
        assert_eq!(watch_line("eval time = 10 ms / 2 tokens", false), None);
    }
}
