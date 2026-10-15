//! Which small model drafts for which family, and when a model should get no automatic draft at all.
//! Port of electron/draftPairing.cjs. The background download is left for the download wave.

use std::fs::{self, File};
use std::path::Path;

use crate::draft_model::{draft_companion_name, is_companion_draft};
use crate::gguf::{GgufHeader, read_header};

/// A family whose members share a tokenizer, so any of them can draft from one small model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DraftEntry {
    pub family: &'static str,
    /// The exact architecture names the family covers, which the reference matches with an anchored pattern.
    pub architectures: &'static [&'static str],
    /// The draft's own vocabulary size. None leaves the check to the engine.
    pub vocab: Option<u64>,
    pub repo: &'static str,
    pub file: &'static str,
}

/// Most llama.cpp builds refuse a draft whose vocabulary differs by more than this.
const MAX_VOCAB_DIFFERENCE: f64 = 128.0;
/// Below this a model is about as cheap to run as its draft, so drafting only adds work: 2.5 GiB.
const MIN_TARGET_BYTES: u64 = 2_684_354_560;

pub const FAMILY_DRAFTS: &[DraftEntry] = &[
    DraftEntry {
        family: "qwen3",
        architectures: &["qwen3", "qwen3moe"],
        vocab: Some(151_936),
        repo: "Qwen/Qwen3-0.6B-GGUF",
        file: "Qwen3-0.6B-Q8_0.gguf",
    },
    DraftEntry {
        family: "qwen3.5",
        architectures: &["qwen35", "qwen35moe"],
        vocab: None,
        repo: "unsloth/Qwen3.5-0.8B-GGUF",
        file: "Qwen3.5-0.8B-Q4_K_M.gguf",
    },
    DraftEntry {
        family: "qwen2",
        architectures: &["qwen2"],
        vocab: Some(151_936),
        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    },
    DraftEntry {
        family: "llama3",
        architectures: &["llama"],
        vocab: Some(128_256),
        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
        file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    },
    DraftEntry {
        family: "gemma3",
        architectures: &["gemma3"],
        vocab: Some(262_144),
        repo: "ggml-org/gemma-3-270m-it-GGUF",
        file: "gemma-3-270m-it-Q8_0.gguf",
    },
];

/// Why a model gets no automatic draft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    Unreadable,
    MtpHeads,
    MixtureOfExperts,
    TooSmall,
}

impl SkipReason {
    /// The reason in the words the reference logs and shows.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unreadable => "unreadable header",
            Self::MtpHeads => "drafts from its own MTP heads",
            Self::MixtureOfExperts => "mixture of experts",
            Self::TooSmall => "too small to gain from a draft",
        }
    }
}

/// The family draft for a model's header, or None when none shares its tokenizer.
pub fn family_draft_for(header: Option<&GgufHeader>) -> Option<&'static DraftEntry> {
    let header = header?;
    FAMILY_DRAFTS.iter().find(|entry| {
        entry.architectures.contains(&header.architecture.as_str()) && vocab_matches(entry, header)
    })
}

fn vocab_matches(entry: &DraftEntry, header: &GgufHeader) -> bool {
    match entry.vocab {
        None => true,
        Some(vocab) => header
            .vocab_size
            .is_some_and(|size| size > 0.0 && (vocab as f64 - size).abs() <= MAX_VOCAB_DIFFERENCE),
    }
}

/// Why this model gets no automatic draft, or None when it should have one.
pub fn skip_reason(header: Option<&GgufHeader>, model_bytes: u64) -> Option<SkipReason> {
    let Some(header) = header else {
        return Some(SkipReason::Unreadable);
    };
    if header.mtp {
        return Some(SkipReason::MtpHeads);
    }
    // A mixture of experts reads only its active experts per token; a dense draft rarely beats that.
    if header.expert_count > 1.0 {
        return Some(SkipReason::MixtureOfExperts);
    }
    if (model_bytes as f64) < MIN_TARGET_BYTES as f64 {
        return Some(SkipReason::TooSmall);
    }
    None
}

/// What an automatic draft for a model would be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftPlan {
    pub family: &'static str,
    pub url: String,
    pub filename: String,
}

/// The automatic draft for the model at `model_path`, or None. Reads the file's size and header, nothing else.
pub fn plan_draft(model_path: &Path) -> Option<DraftPlan> {
    let name = basename_of_path(model_path);
    if is_companion_draft(&name) {
        return None;
    }
    let dir = model_path.parent().unwrap_or_else(|| Path::new(""));
    if dir.join(draft_companion_name(&name)).exists() {
        return None;
    }
    let bytes = fs::metadata(model_path).ok()?.len();
    let header = File::open(model_path)
        .ok()
        .and_then(|mut file| read_header(&mut file).ok());
    if skip_reason(header.as_ref(), bytes).is_some() {
        return None;
    }
    let entry = family_draft_for(header.as_ref())?;
    Some(DraftPlan {
        family: entry.family,
        url: format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            entry.repo, entry.file
        ),
        filename: draft_companion_name(&name),
    })
}

fn basename_of_path(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_llama_family_needs_its_exact_vocabulary() {
        let header = GgufHeader {
            architecture: "llama".to_owned(),
            context_length: None,
            block_count: None,
            embedding_length: None,
            file_type: None,
            name: None,
            expert_count: 0.0,
            expert_used_count: 0.0,
            head_count_kv: None,
            key_length: None,
            value_length: None,
            mtp: false,
            tokenizer_model: None,
            tokenizer_pre: None,
            vocab_size: Some(131_072.0),
            version: 3,
        };
        assert!(family_draft_for(Some(&header)).is_none());
    }
}
