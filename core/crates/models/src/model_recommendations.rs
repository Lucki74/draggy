//! Which rung of the model ladder a machine can run. Port of src/modelRecommendations.ts. The MLX ladder and the
//! `modelRecommendations` name are aliases of this one ladder, so the port keeps only the ladder.

use crate::js;
use crate::vram::USABLE_VRAM_FRACTION;

/// The GGUF engine has to read the whole model into RAM before the GPU can use any of it, so a machine short on
/// system memory cannot run a model its VRAM alone would suggest.
pub const USABLE_RAM_FRACTION: f64 = 0.8;
/// No dedicated GPU still means a real machine with a real CPU, so the choice floors on a slice of RAM.
pub const CPU_ONLY_RAM_FRACTION: f64 = 0.5;
/// Dense rungs on a machine with no card stop here: past it the CPU answers too slowly, and an MoE does better.
pub const CPU_ONLY_DENSE_CAP_GB: f64 = 8.0;
/// Unified memory macOS lets the GPU wire, leaving the rest to the system.
pub const USABLE_UNIFIED_RAM_FRACTION: f64 = 0.75;

/// A dense model lives on the card; an MoE keeps its experts in RAM and the rest on the card.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Dense,
    Moe,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dense => "dense",
            Self::Moe => "moe",
        }
    }
}

/// One rung. `vram` is what a dense model needs, or the smallest card an MoE takes; `memory` is card and RAM together.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rung {
    pub vram: f64,
    pub model: &'static str,
    pub label: &'static str,
    pub params: &'static str,
    pub size_gb: f64,
    pub kind: Kind,
    pub memory: f64,
    /// Needs a llama.cpp build upstream does not ship yet, so it is never picked.
    pub pending: bool,
}

const fn dense(
    vram: f64,
    model: &'static str,
    label: &'static str,
    params: &'static str,
    size_gb: f64,
) -> Rung {
    Rung {
        vram,
        model,
        label,
        params,
        size_gb,
        kind: Kind::Dense,
        memory: vram,
        pending: false,
    }
}

const fn moe(
    vram: f64,
    memory: f64,
    model: &'static str,
    label: &'static str,
    params: &'static str,
    size_gb: f64,
    pending: bool,
) -> Rung {
    Rung {
        vram,
        model,
        label,
        params,
        size_gb,
        kind: Kind::Moe,
        memory,
        pending,
    }
}

/// The ladder, ascending by quality, so the best rung that fits is the last one that does.
pub const GGUF_LADDER: &[Rung] = &[
    dense(
        1.0,
        "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M",
        "Qwen 3.5 0.8B",
        "0.8B",
        0.53,
    ),
    dense(
        2.0,
        "unsloth/Qwen3.5-2B-GGUF:Q4_K_M",
        "Qwen 3.5 2B",
        "2B",
        1.28,
    ),
    dense(
        3.5,
        "unsloth/Qwen3.5-4B-GGUF:Q4_K_M",
        "Qwen 3.5 4B",
        "4B",
        2.74,
    ),
    dense(
        6.0,
        "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",
        "Gemma 4 E4B",
        "4B",
        4.98,
    ),
    dense(
        7.5,
        "unsloth/Qwen3.5-9B-GGUF:UD-Q4_K_XL",
        "Qwen 3.5 9B",
        "9B",
        5.97,
    ),
    dense(
        9.5,
        "unsloth/gemma-4-12b-it-GGUF:UD-Q4_K_XL",
        "Gemma 4 12B",
        "12B",
        7.37,
    ),
    dense(
        11.0,
        "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M",
        "Ministral 3 14B",
        "14B",
        8.24,
    ),
    moe(
        0.0,
        14.0,
        "ggml-org/gpt-oss-20b-GGUF:MXFP4",
        "GPT-OSS 20B",
        "20B MoE",
        12.11,
        false,
    ),
    moe(
        0.0,
        19.0,
        "unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL",
        "Gemma 4 26B",
        "26B MoE",
        17.01,
        false,
    ),
    moe(
        0.0,
        25.0,
        "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_XL",
        "Qwen 3.6 35B",
        "35B MoE",
        22.36,
        false,
    ),
    moe(
        0.0,
        30.0,
        "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q5_K_XL",
        "Qwen 3.6 35B Q5",
        "35B MoE",
        26.59,
        false,
    ),
    moe(
        0.0,
        33.0,
        "unsloth/Qwen3.6-35B-A3B-GGUF:Q6_K",
        "Qwen 3.6 35B Q6",
        "35B MoE",
        29.31,
        false,
    ),
    moe(
        0.0,
        40.0,
        "unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0",
        "Qwen 3.6 35B Q8",
        "35B MoE",
        36.9,
        false,
    ),
    dense(
        15.5,
        "unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL",
        "Qwen 3.8 27B Q3",
        "27B",
        13.15,
    ),
    moe(
        8.0,
        61.0,
        "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q3_K_XL",
        "Qwen 3.5 122B Q3",
        "122B MoE",
        56.97,
        false,
    ),
    moe(
        8.0,
        82.0,
        "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q4_K_XL",
        "Qwen 3.5 122B",
        "122B MoE",
        77.03,
        false,
    ),
    dense(
        20.0,
        "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL",
        "Qwen 3.8 27B",
        "27B",
        17.56,
    ),
    dense(
        23.0,
        "unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_XL",
        "Qwen 3.8 27B Q5",
        "27B",
        20.88,
    ),
    dense(
        32.0,
        "unsloth/Qwen3.8-27B-GGUF:Q8_0",
        "Qwen 3.8 27B Q8",
        "27B",
        29.05,
    ),
    moe(
        8.0,
        94.0,
        "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL",
        "Qwen 3.8 Flash-Next Q3",
        "125B MoE",
        89.99,
        false,
    ),
    moe(
        8.0,
        116.0,
        "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q4_K_XL",
        "Qwen 3.8 Flash-Next",
        "125B MoE",
        111.33,
        false,
    ),
    moe(
        10.0,
        135.0,
        "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q3_K_XL",
        "DeepSeek V4 Flash Q3",
        "284B MoE",
        129.45,
        false,
    ),
    moe(
        10.0,
        162.0,
        "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q4_K_XL",
        "DeepSeek V4 Flash",
        "284B MoE",
        155.1,
        false,
    ),
    moe(
        12.0,
        210.0,
        "unsloth/GLM-5.3-Flash-GGUF:UD-Q4_K_XL",
        "GLM-5.3-Flash",
        "320B MoE",
        199.71,
        false,
    ),
    moe(
        12.0,
        250.0,
        "unsloth/GLM-5.3-Flash-GGUF:UD-Q5_K_XL",
        "GLM-5.3-Flash Q5",
        "320B MoE",
        240.31,
        false,
    ),
    moe(
        16.0,
        410.0,
        "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-IQ3_XXS",
        "DeepSeek V4.1 Flash Q3",
        "552B MoE",
        394.7,
        true,
    ),
    moe(
        16.0,
        520.0,
        "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-Q4_K_XL",
        "DeepSeek V4.1 Flash",
        "552B MoE",
        500.7,
        true,
    ),
];

/// What the choice is made from: the platform, architecture, RAM (GB) and CPU model. Unset fields are absent.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RuntimeTarget {
    pub platform: Option<String>,
    pub arch: Option<String>,
    pub ram: Option<f64>,
    pub cpu_model: Option<String>,
}

/// Apple Silicon chip classes, widest memory bandwidth last.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChipClass {
    Base,
    Pro,
    Max,
    Ultra,
}

impl ChipClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Pro => "pro",
            Self::Max => "max",
            Self::Ultra => "ultra",
        }
    }
}

/// Reads "Apple M2 Pro" style CPU strings. Unknown and non-Apple CPUs are base, the class that asks least of memory.
pub fn chip_class_of(cpu_model: Option<&str>) -> ChipClass {
    let chars: Vec<char> = cpu_model.unwrap_or_default().chars().collect();
    (0..chars.len())
        .find_map(|start| apple_match(&chars, start))
        .unwrap_or(ChipClass::Base)
}

/// Matches `Apple\s+M\d+\s*(Pro|Max|Ultra)?` at `start`, ignoring ASCII case. None when it does not match there.
fn apple_match(chars: &[char], start: usize) -> Option<ChipClass> {
    let mut at = start;
    for expected in ['a', 'p', 'p', 'l', 'e'] {
        if !chars.get(at)?.eq_ignore_ascii_case(&expected) {
            return None;
        }
        at += 1;
    }
    let after_space = skip_space(chars, at);
    if after_space == at {
        return None;
    }
    at = after_space;
    if !chars.get(at)?.eq_ignore_ascii_case(&'m') {
        return None;
    }
    at += 1;
    let digits_end = skip_while(chars, at, |c| c.is_ascii_digit());
    if digits_end == at {
        return None;
    }
    Some(variant_at(chars, skip_space(chars, digits_end)))
}

fn variant_at(chars: &[char], at: usize) -> ChipClass {
    let word = |text: &str| {
        text.chars().enumerate().all(|(offset, c)| {
            chars
                .get(at + offset)
                .is_some_and(|found| found.eq_ignore_ascii_case(&c))
        })
    };
    if word("pro") {
        ChipClass::Pro
    } else if word("max") {
        ChipClass::Max
    } else if word("ultra") {
        ChipClass::Ultra
    } else {
        ChipClass::Base
    }
}

fn skip_space(chars: &[char], at: usize) -> usize {
    skip_while(chars, at, is_js_space)
}

fn skip_while(chars: &[char], at: usize, keep: impl Fn(char) -> bool) -> usize {
    let mut end = at;
    while chars.get(end).is_some_and(|c| keep(*c)) {
        end += 1;
    }
    end
}

/// JavaScript's `\s`, which is wider than Rust's whitespace in one place and narrower in another.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// The ladder. It has one list, so `ladderFor` returns it for any target.
pub fn ladder_for(_target: &RuntimeTarget) -> &'static [Rung] {
    GGUF_LADDER
}

/// Whether the machine could run the MLX builds. Only the GGUF engine ships, so never.
pub fn supports_mlx(_target: &RuntimeTarget) -> bool {
    false
}

/// Whether the hardware could run MLX. `supports_mlx` stays false until an MLX ladder is checked on a Mac.
pub fn mlx_capable(target: &RuntimeTarget) -> bool {
    is_apple_silicon(target)
}

fn is_apple_silicon(target: &RuntimeTarget) -> bool {
    target.platform.as_deref() == Some("darwin") && target.arch.as_deref() == Some("arm64")
}

/// A reported RAM of zero, negative or NaN counts as not reported.
fn known_ram(target: &RuntimeTarget) -> Option<f64> {
    target.ram.filter(|ram| *ram > 0.0)
}

fn safe_vram(vram: f64) -> f64 {
    if vram.is_finite() && vram > 0.0 {
        vram
    } else {
        0.0
    }
}

/// The whole unified pool on a Mac. Its real memory wins over the `vram` copy the specs report.
fn unified_memory(vram: f64, target: &RuntimeTarget) -> f64 {
    known_ram(target).unwrap_or(vram)
}

/// What a dense rung is held to: the card, floored on a slice of RAM when there is none, capped by RAM.
fn dense_budget(vram: f64, ram: f64) -> f64 {
    if ram <= 0.0 {
        return vram;
    }
    let floor = if vram < 2.0 {
        (ram * CPU_ONLY_RAM_FRACTION).min(CPU_ONLY_DENSE_CAP_GB)
    } else {
        0.0
    };
    vram.max(floor).min(ram * USABLE_RAM_FRACTION)
}

/// Dense rungs need the card; an MoE needs card and RAM together, plus a card big enough for its active part.
pub fn rung_fits(rung: &Rung, vram: f64, target: &RuntimeTarget) -> bool {
    let vram = safe_vram(vram);
    if is_apple_silicon(target) {
        return rung.memory <= unified_memory(vram, target) * USABLE_UNIFIED_RAM_FRACTION;
    }
    let ram = known_ram(target).unwrap_or(0.0);
    match rung.kind {
        Kind::Dense => rung.vram <= dense_budget(vram, ram),
        Kind::Moe => {
            vram >= rung.vram
                && rung.memory <= vram * USABLE_VRAM_FRACTION + ram * USABLE_RAM_FRACTION
        }
    }
}

/// The best rung that fits, or the one above it on a Max or Ultra chip when all its memory can hold that.
pub fn get_recommended_model(vram: f64, target: &RuntimeTarget) -> &'static str {
    let Some(index) = GGUF_LADDER
        .iter()
        .rposition(|rung| !rung.pending && rung_fits(rung, vram, target))
    else {
        return GGUF_LADDER[0].model;
    };
    let wide = is_apple_silicon(target)
        && matches!(
            chip_class_of(target.cpu_model.as_deref()),
            ChipClass::Max | ChipClass::Ultra
        );
    let whole = unified_memory(safe_vram(vram), target);
    match GGUF_LADDER.get(index + 1) {
        Some(next) if wide && !next.pending && next.memory <= whole => next.model,
        _ => GGUF_LADDER[index].model,
    }
}

/// The rung a machine can carry, as something the downloader understands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecommendedDownload {
    pub model: &'static str,
    pub label: &'static str,
    /// What the downloader resolves into files, split ones included.
    pub reference: &'static str,
    /// Roughly what it takes on disk, in bytes, for checking free space before asking.
    pub size: u64,
}

pub fn get_recommended_download(vram: f64, target: &RuntimeTarget) -> RecommendedDownload {
    let model = get_recommended_model(vram, target);
    let rung = GGUF_LADDER
        .iter()
        .find(|entry| entry.model == model)
        .unwrap_or(&GGUF_LADDER[0]);
    RecommendedDownload {
        model: rung.model,
        label: rung.label,
        reference: rung.model,
        size: js::round(rung.size_gb * 1e9) as u64,
    }
}

#[cfg(test)]
mod mlx_tests {
    use super::*;

    #[test]
    fn only_apple_silicon_is_mlx_capable() {
        let mac = RuntimeTarget { platform: Some("darwin".into()), arch: Some("arm64".into()), ..Default::default() };
        assert!(mlx_capable(&mac));
        assert!(!mlx_capable(&RuntimeTarget { arch: Some("x64".into()), ..mac.clone() }));
        assert!(!supports_mlx(&mac));
    }
}
