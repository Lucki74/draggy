//! How well a model fits on a card: how much of it the GPU holds and what is left on the CPU.
//! Port of src/vram.ts. Only the fit arithmetic is here; the status dot and its text belong to the UI.

use crate::js;

const BYTES_PER_GB: f64 = 1024.0 * 1024.0 * 1024.0;

pub const RUNTIME_OVERHEAD_GB: f64 = 0.8;
pub const USABLE_VRAM_FRACTION: f64 = 0.9;
pub const USABLE_UNIFIED_FRACTION: f64 = 0.95;

/// How the fit reads, from green (fits) to red (mostly on the CPU). Unknown when the card's memory was not measured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Green,
    Amber,
    Red,
    Unknown,
}

impl Tone {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Green => "green",
            Self::Amber => "amber",
            Self::Red => "red",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FitInput {
    pub model_bytes: f64,
    pub vram_gb: f64,
    pub unified_memory: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelFit {
    pub tone: Tone,
    /// Whole percent of the model on the GPU, at most 100.
    pub gpu_percent: f64,
    pub size_gb: f64,
    pub needed_gb: f64,
    pub usable_gb: f64,
}

/// How a model of `model_bytes` fits in `vram_gb` of memory. Unified memory keeps a larger share usable.
pub fn describe_fit(input: FitInput) -> ModelFit {
    let size_gb = input.model_bytes / BYTES_PER_GB;
    let needed_gb = size_gb + RUNTIME_OVERHEAD_GB;

    if input.vram_gb.is_nan() || input.vram_gb <= 0.0 {
        return ModelFit {
            tone: Tone::Unknown,
            gpu_percent: 0.0,
            size_gb,
            needed_gb,
            usable_gb: 0.0,
        };
    }

    let share = if input.unified_memory {
        USABLE_UNIFIED_FRACTION
    } else {
        USABLE_VRAM_FRACTION
    };
    let usable_gb = input.vram_gb * share;
    let fraction = js::min(1.0, usable_gb / needed_gb);
    let gpu_percent = js::round(fraction * 100.0);
    let tone = if fraction >= 0.98 {
        Tone::Green
    } else if fraction >= 0.6 {
        Tone::Amber
    } else {
        Tone::Red
    };

    ModelFit {
        tone,
        gpu_percent,
        size_gb,
        needed_gb,
        usable_gb,
    }
}

/// The status dot beside a model, the same wherever a fit is shown. Unknown has none.
pub fn fit_status(tone: Tone) -> Option<&'static str> {
    match tone {
        Tone::Green => Some("ok"),
        Tone::Amber => Some("warn"),
        Tone::Red => Some("danger"),
        Tone::Unknown => None,
    }
}

/// The split as text: "100% GPU", "60% GPU / 40% CPU", or empty when the fit is unknown.
pub fn describe_split(fit: &ModelFit) -> String {
    if fit.tone == Tone::Unknown {
        return String::new();
    }
    // Adding zero turns a negative zero into zero, which the template string prints as "0".
    let gpu = fit.gpu_percent + 0.0;
    if gpu >= 100.0 {
        return "100% GPU".to_owned();
    }
    format!("{gpu}% GPU / {}% CPU", 100.0 - gpu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_negative_zero_split_reads_as_zero() {
        let fit = ModelFit {
            tone: Tone::Red,
            gpu_percent: -0.0,
            size_gb: 1.0,
            needed_gb: 1.0,
            usable_gb: 1.0,
        };
        assert_eq!(describe_split(&fit), "0% GPU / 100% CPU");
    }
}
