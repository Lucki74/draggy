//! Which rung of the model ladder a machine can run. Port of src/modelRecommendations.ts. The MLX ladder and the
//! `modelRecommendations` name are aliases of this one ladder, so the port keeps only the ladder.

use crate::js;

/// The GGUF engine has to read the whole model into RAM before the GPU can use any of it, so a machine short on
/// system memory cannot run a model its VRAM alone would suggest.
pub const USABLE_RAM_FRACTION: f64 = 0.8;
/// No dedicated GPU still means a real machine with a real CPU, so the choice floors on a slice of RAM.
pub const CPU_ONLY_RAM_FRACTION: f64 = 0.5;

/// One rung: the memory it is for, the Hugging Face repository and quantisation it resolves to, and its download size in GB.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rung {
    pub vram: f64,
    pub model: &'static str,
    pub label: &'static str,
    pub params: &'static str,
    pub size_gb: f64,
}

/// The ladder, ascending by memory. Each rung's download is no bigger than the memory it is for.
pub const GGUF_LADDER: &[Rung] = &[
    Rung {
        vram: 1.0,
        model: "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M",
        label: "Qwen 3.5 0.8B",
        params: "0.8B",
        size_gb: 0.53,
    },
    Rung {
        vram: 2.0,
        model: "unsloth/Qwen3.5-2B-GGUF:Q4_K_M",
        label: "Qwen 3.5 2B",
        params: "2B",
        size_gb: 1.28,
    },
    Rung {
        vram: 3.0,
        model: "unsloth/Qwen3.5-4B-GGUF:Q4_K_M",
        label: "Qwen 3.5 4B",
        params: "4B",
        size_gb: 2.74,
    },
    Rung {
        vram: 4.0,
        model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
        label: "Gemma 4 E2B",
        params: "2B",
        size_gb: 3.11,
    },
    Rung {
        vram: 6.0,
        model: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",
        label: "Gemma 4 E4B",
        params: "4B",
        size_gb: 4.98,
    },
    Rung {
        vram: 8.0,
        model: "unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
        label: "Qwen 3.5 9B",
        params: "9B",
        size_gb: 5.68,
    },
    Rung {
        vram: 10.0,
        model: "unsloth/gemma-4-12b-it-GGUF:Q4_K_M",
        label: "Gemma 4 12B",
        params: "12B",
        size_gb: 7.12,
    },
    Rung {
        vram: 12.0,
        model: "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M",
        label: "Ministral 3 14B",
        params: "14B",
        size_gb: 8.24,
    },
    Rung {
        vram: 16.0,
        model: "ggml-org/gpt-oss-20b-GGUF:MXFP4",
        label: "GPT-OSS 20B",
        params: "20B MoE",
        size_gb: 12.11,
    },
    Rung {
        vram: 20.0,
        model: "unsloth/Qwen3.8-27B-GGUF:Q4_K_M",
        label: "Qwen 3.8 27B",
        params: "27B",
        size_gb: 16.46,
    },
    Rung {
        vram: 24.0,
        model: "unsloth/gemma-4-31B-it-GGUF:Q4_K_M",
        label: "Gemma 4 31B",
        params: "31B",
        size_gb: 18.32,
    },
    Rung {
        vram: 32.0,
        model: "unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_M",
        label: "Qwen 3.6 35B",
        params: "35B MoE",
        size_gb: 22.13,
    },
    Rung {
        vram: 40.0,
        model: "unsloth/Qwen3.8-27B-GGUF:Q8_0",
        label: "Qwen 3.8 27B Q8",
        params: "27B",
        size_gb: 29.05,
    },
    Rung {
        vram: 48.0,
        model: "unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0",
        label: "Qwen 3.6 35B Q8",
        params: "35B MoE",
        size_gb: 36.9,
    },
    Rung {
        vram: 80.0,
        model: "ggml-org/gpt-oss-120b-GGUF:MXFP4",
        label: "GPT-OSS 120B",
        params: "120B MoE",
        size_gb: 63.39,
    },
    Rung {
        vram: 96.0,
        model: "unsloth/Qwen3.5-122B-A10B-GGUF:Q4_K_M",
        label: "Qwen 3.5 122B",
        params: "122B MoE",
        size_gb: 76.54,
    },
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

fn is_apple_silicon(target: &RuntimeTarget) -> bool {
    target.platform.as_deref() == Some("darwin") && target.arch.as_deref() == Some("arm64")
}

/// The memory the ladder is climbed against. A Mac with its memory known reads that, not the VRAM figure, since unified memory is the
/// only pool there.
fn effective_budget(vram: f64, target: &RuntimeTarget) -> f64 {
    let safe_vram = if vram.is_finite() && vram > 0.0 {
        vram
    } else {
        0.0
    };
    // A reported RAM of zero, negative or NaN counts as not reported.
    let ram = target.ram.filter(|ram| *ram > 0.0);
    if is_apple_silicon(target) {
        return ram.unwrap_or(safe_vram);
    }
    let Some(ram) = ram else { return safe_vram };
    let ceiling = ram * USABLE_RAM_FRACTION;
    let floor = if safe_vram < 2.0 {
        ram * CPU_ONLY_RAM_FRACTION
    } else {
        0.0
    };
    safe_vram.max(floor).min(ceiling)
}

/// The highest rung the machine can afford, one higher on a Max or Ultra chip, whose wide memory bandwidth carries a bigger model.
pub fn get_recommended_model(vram: f64, target: &RuntimeTarget) -> &'static str {
    let budget = effective_budget(vram, target);
    let mut climbing: Vec<&Rung> = GGUF_LADDER.iter().collect();
    climbing.sort_by(|a, b| a.vram.total_cmp(&b.vram));

    let Some(index) = climbing.iter().rposition(|rung| rung.vram <= budget) else {
        return climbing[0].model;
    };
    // A wide-bandwidth Max or Ultra die pushes the same memory through a model a base or Pro chip only just manages.
    let chip = if is_apple_silicon(target) {
        chip_class_of(target.cpu_model.as_deref())
    } else {
        ChipClass::Base
    };
    let bump = usize::from(matches!(chip, ChipClass::Max | ChipClass::Ultra));
    climbing[(index + bump).min(climbing.len() - 1)].model
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
