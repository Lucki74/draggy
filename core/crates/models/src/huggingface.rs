//! Hugging Face model search, repository files and download resolution. Port of electron/huggingface.cjs.
//! The reference keeps its caches in module state; here a `HuggingFace` value owns them, so each owner starts empty.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use draggy_web::policy::UrlPolicy;
use fancy_regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tracing::{debug, error, info, warn};

use crate::download::{HttpClient, Reply, TransportError, read_all};
use crate::draft_model::draft_companion_name;
use crate::js::{locale_cmp, round, string_to_number, to_fixed};
use crate::mmproj::companion_name;
use crate::shards::{basename, parse_shard};

const MODELS_API: &str = "https://huggingface.co/api/models";
// The API drops its default fields once expand[] is used, so tags, pipeline_tag and siblings are asked for.
const EXPAND: &str = "expand[]=cardData&expand[]=baseModels&expand[]=gguf&expand[]=pipeline_tag&expand[]=tags&expand[]=siblings";
const TOP_MODELS_URL: &str = "https://huggingface.co/api/models?filter=gguf&sort=trendingScore&direction=-1&limit=100&expand[]=cardData&expand[]=baseModels&expand[]=gguf&expand[]=pipeline_tag&expand[]=tags&expand[]=siblings";
const TOP_MODELS_TTL_MS: u64 = 30 * 60 * 1000;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(12);
const TREE_TIMEOUT: Duration = Duration::from_secs(20);
const TREE_MAX_PAGES: usize = 30;
const FALLBACK_SIZES: [&str; 3] = ["Q4_K_M", "Q5_K_M", "Q8_0"];
const PREFERRED_QUANTS: [&str; 19] = [
    "Q4_K_M", "Q5_K_M", "Q8_0", "Q4_0", "Q6_K", "Q4_K_S", "Q5_K_S", "Q3_K_M", "IQ4_XS", "IQ3_M",
    "IQ2_S", "IQ2_XS", "IQ3_S", "IQ3_XXS", "Q2_0", "PQ2_0", "PTQ1_0", "BF16", "F16",
];
const MAX_LISTED_QUANTS: usize = 5;

/// One file of a curated model, with the repository it comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Source {
    pub repo: &'static str,
    pub file: &'static str,
    pub bytes: u64,
}

/// One size of a curated model. A draft is the small model that speeds it up, when there is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Variant {
    pub source: Source,
    pub draft: Option<Source>,
}

/// A premier open model in the curated registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Curated {
    pub name: &'static str,
    pub description: &'static str,
    pub capabilities: &'static [&'static str],
    pub sizes: &'static [&'static str],
    pub variants: &'static [(&'static str, Variant)],
}

impl Curated {
    pub fn variant(&self, tag: &str) -> Option<Variant> {
        self.variants
            .iter()
            .find(|(key, _)| *key == tag)
            .map(|(_, variant)| *variant)
    }
}

/// Curated registry of premier open models from Hugging Face matching Draggy's download card design.
pub const CURATED_MODELS: &[Curated] = &[
    Curated {
        name: "llama3.1",
        description: "Llama 3.1 is a state-of-the-art model from Meta available in 8B and 70B parameter sizes.",
        capabilities: &["tools", "completion"],
        sizes: &["8b", "70b"],
        variants: &[
            (
                "8b",
                Variant {
                    source: Source {
                        repo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
                        file: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
                        bytes: 4920733696,
                    },
                    draft: Some(Source {
                        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
                        file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
                        bytes: 807694464,
                    }),
                },
            ),
            (
                "70b",
                Variant {
                    source: Source {
                        repo: "bartowski/Meta-Llama-3.1-70B-Instruct-GGUF",
                        file: "Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf",
                        bytes: 42520000000,
                    },
                    draft: None,
                },
            ),
        ],
    },
    Curated {
        name: "llama3.2",
        description: "Llama 3.2 is Meta's lightweight model family tuned for high-speed local inference.",
        capabilities: &["tools", "completion"],
        sizes: &["1b", "3b"],
        variants: &[
            (
                "1b",
                Variant {
                    source: Source {
                        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
                        file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
                        bytes: 807694464,
                    },
                    draft: None,
                },
            ),
            (
                "3b",
                Variant {
                    source: Source {
                        repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
                        file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
                        bytes: 2020000000,
                    },
                    draft: None,
                },
            ),
        ],
    },
    Curated {
        name: "deepseek-r1",
        description: "DeepSeek-R1 is a family of open reasoning models with performance approaching leading frontier models.",
        capabilities: &["tools", "thinking", "completion"],
        sizes: &["1.5b", "7b", "8b", "14b", "32b", "70b"],
        variants: &[
            (
                "1.5b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
                        file: "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
                        bytes: 1120000000,
                    },
                    draft: None,
                },
            ),
            (
                "7b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
                        file: "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
                        bytes: 4680000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
            (
                "8b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF",
                        file: "DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf",
                        bytes: 4920000000,
                    },
                    draft: Some(Source {
                        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
                        file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
                        bytes: 807694464,
                    }),
                },
            ),
            (
                "14b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
                        file: "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
                        bytes: 8990000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
            (
                "32b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF",
                        file: "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
                        bytes: 19900000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
            (
                "70b",
                Variant {
                    source: Source {
                        repo: "bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF",
                        file: "DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf",
                        bytes: 42500000000,
                    },
                    draft: None,
                },
            ),
        ],
    },
    Curated {
        name: "qwen2.5",
        description: "Qwen 2.5 is Alibaba's flagship series with exceptional strength in coding, math and instruction following.",
        capabilities: &["tools", "completion"],
        sizes: &["0.5b", "1.5b", "3b", "7b", "14b", "32b"],
        variants: &[
            (
                "0.5b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    },
                    draft: None,
                },
            ),
            (
                "1.5b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
                        file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
                        bytes: 986000000,
                    },
                    draft: None,
                },
            ),
            (
                "3b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
                        file: "qwen2.5-3b-instruct-q4_k_m.gguf",
                        bytes: 1930000000,
                    },
                    draft: None,
                },
            ),
            (
                "7b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
                        file: "qwen2.5-7b-instruct-q4_k_m.gguf",
                        bytes: 4680000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
            (
                "14b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-14B-Instruct-GGUF",
                        file: "qwen2.5-14b-instruct-q4_k_m.gguf",
                        bytes: 8990000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
            (
                "32b",
                Variant {
                    source: Source {
                        repo: "Qwen/Qwen2.5-32B-Instruct-GGUF",
                        file: "qwen2.5-32b-instruct-q4_k_m.gguf",
                        bytes: 19900000000,
                    },
                    draft: Some(Source {
                        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
                        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                        bytes: 398000000,
                    }),
                },
            ),
        ],
    },
    Curated {
        name: "phi-4",
        description: "Phi-4 is Microsoft's 14B state-of-the-art synthetic data reasoning model with exceptional STEM performance.",
        capabilities: &["tools", "completion"],
        sizes: &["14b"],
        variants: &[(
            "14b",
            Variant {
                source: Source {
                    repo: "bartowski/phi-4-GGUF",
                    file: "phi-4-Q4_K_M.gguf",
                    bytes: 9140000000,
                },
                draft: None,
            },
        )],
    },
    Curated {
        name: "mistral",
        description: "Mistral 7B Instruct v0.3 is a fast, capable general-purpose model with native function calling.",
        capabilities: &["tools", "completion"],
        sizes: &["7b"],
        variants: &[(
            "7b",
            Variant {
                source: Source {
                    repo: "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
                    file: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
                    bytes: 4370000000,
                },
                draft: None,
            },
        )],
    },
    Curated {
        name: "gemma-2",
        description: "Gemma 2 is Google's lightweight open model family built from Gemini research.",
        capabilities: &["tools", "completion"],
        sizes: &["2b", "9b", "27b"],
        variants: &[
            (
                "2b",
                Variant {
                    source: Source {
                        repo: "bartowski/gemma-2-2b-it-GGUF",
                        file: "gemma-2-2b-it-Q4_K_M.gguf",
                        bytes: 1630000000,
                    },
                    draft: None,
                },
            ),
            (
                "9b",
                Variant {
                    source: Source {
                        repo: "bartowski/gemma-2-9b-it-GGUF",
                        file: "gemma-2-9b-it-Q4_K_M.gguf",
                        bytes: 5880000000,
                    },
                    draft: None,
                },
            ),
            (
                "27b",
                Variant {
                    source: Source {
                        repo: "bartowski/gemma-2-27b-it-GGUF",
                        file: "gemma-2-27b-it-Q4_K_M.gguf",
                        bytes: 16800000000,
                    },
                    draft: None,
                },
            ),
        ],
    },
    Curated {
        name: "nomic-embed-text",
        description: "A high-performing open embedding model with a large token context window.",
        capabilities: &["embedding"],
        sizes: &["v1.5"],
        variants: &[(
            "v1.5",
            Variant {
                source: Source {
                    repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
                    file: "nomic-embed-text-v1.5.Q4_K_M.gguf",
                    bytes: 274000000,
                },
                draft: None,
            },
        )],
    },
];

/// Where each Hugging Face task sits: the type of model it is, for a model that does not chat.
const TASK_TYPES: &[(&str, &str)] = &[
    ("feature-extraction", "embedding"),
    ("sentence-similarity", "embedding"),
    ("text-retrieval", "embedding"),
    ("visual-document-retrieval", "embedding"),
    ("text-ranking", "reranking"),
    ("text-to-image", "image-generation"),
    ("image-to-image", "image-generation"),
    ("unconditional-image-generation", "image-generation"),
    ("text-to-video", "video-generation"),
    ("image-to-video", "video-generation"),
    ("text-to-3d", "3d-generation"),
    ("image-to-3d", "3d-generation"),
    ("automatic-speech-recognition", "speech-recognition"),
    ("text-to-speech", "text-to-speech"),
    ("text-to-audio", "audio-generation"),
    ("audio-to-audio", "audio-processing"),
    ("audio-classification", "audio-processing"),
    ("voice-activity-detection", "audio-processing"),
    ("image-classification", "image-analysis"),
    ("zero-shot-image-classification", "image-analysis"),
    ("image-feature-extraction", "image-analysis"),
    ("image-to-text", "image-analysis"),
    ("object-detection", "image-analysis"),
    ("zero-shot-object-detection", "image-analysis"),
    ("image-segmentation", "image-analysis"),
    ("mask-generation", "image-analysis"),
    ("depth-estimation", "image-analysis"),
    ("keypoint-detection", "image-analysis"),
    ("video-classification", "video-analysis"),
    ("translation", "translation"),
    ("summarization", "summarization"),
    ("question-answering", "question-answering"),
    ("table-question-answering", "question-answering"),
    ("document-question-answering", "question-answering"),
    ("multiple-choice", "question-answering"),
    ("fill-mask", "fill-mask"),
    ("text-classification", "text-classification"),
    ("token-classification", "text-classification"),
    ("zero-shot-classification", "text-classification"),
    ("time-series-forecasting", "time-series"),
    ("tabular-classification", "tabular"),
    ("tabular-regression", "tabular"),
    ("reinforcement-learning", "robotics"),
    ("robotics", "robotics"),
    ("graph-ml", "graph"),
];

const TYPE_LABELS: &[(&str, &str)] = &[
    ("embedding", "Embedding"),
    ("reranking", "Reranking"),
    ("image-generation", "Image generation"),
    ("video-generation", "Video generation"),
    ("3d-generation", "3D generation"),
    ("speech-recognition", "Speech recognition"),
    ("text-to-speech", "Text to speech"),
    ("audio-generation", "Audio generation"),
    ("audio-processing", "Audio"),
    ("image-analysis", "Image analysis"),
    ("video-analysis", "Video analysis"),
    ("translation", "Translation"),
    ("summarization", "Summarization"),
    ("question-answering", "Question answering"),
    ("fill-mask", "Fill-mask"),
    ("text-classification", "Text classification"),
    ("time-series", "Time series"),
    ("tabular", "Tabular"),
    ("robotics", "Robotics"),
    ("graph", "Graph"),
    ("other", "Other"),
];

const TASK_LABELS: &[(&str, &str)] = &[
    ("text-generation", "Text generation"),
    ("text2text-generation", "Text-to-text"),
    ("image-text-to-text", "Vision-language"),
    ("any-to-any", "Multimodal"),
    ("visual-question-answering", "Vision-language"),
    ("feature-extraction", "Embedding"),
    ("sentence-similarity", "Embedding"),
];

// Every chat model is tagged conversational, so it says nothing and is left out.
const TAG_LABELS: &[(&str, &str)] = &[
    ("coding", "coding"),
    ("code", "coding"),
    ("math", "math"),
    ("roleplay", "roleplay"),
    ("multilingual", "multilingual"),
    ("moe", "mixture-of-experts"),
    ("reasoning", "reasoning"),
    ("uncensored", "uncensored"),
    ("abliterated", "abliterated"),
    ("function-calling", "tool use"),
    ("tool-use", "tool use"),
];

const RELATION_VERBS: &[(&str, &str)] = &[
    ("quantized", "quantized from"),
    ("finetune", "fine-tuned from"),
    ("merge", "merged from"),
    ("adapter", "adapted from"),
];

const EMBEDDING_TASKS: &[&str] = &["feature-extraction", "sentence-similarity"];
const VISION_TASKS: &[&str] = &[
    "image-text-to-text",
    "video-text-to-text",
    "any-to-any",
    "visual-question-answering",
];
// Text and audio in, text out: the models that answer a message.
const CHAT_TASKS: &[&str] = &[
    "text-generation",
    "text2text-generation",
    "conversational",
    "audio-text-to-text",
];

/// Canonical blurbs, most specific first: the first pattern found in the repo name wins.
const FAMILIES: &[(&str, &str)] = &[
    (
        "(?i)deepseek[-_ ]?r1",
        "DeepSeek-R1 reasoning models, trained to think step by step. Distilled versions bring that to Qwen and Llama sizes.",
    ),
    (
        "(?i)deepseek",
        "DeepSeek's open mixture-of-experts models, strong at coding, math and general reasoning.",
    ),
    (
        "(?i)qwen[-_ ]?[0-9]*(\\.[0-9]+)?[-_ ]?coder",
        "Alibaba's Qwen Coder models, tuned for code generation, repair and agentic coding work.",
    ),
    (
        "(?i)qwen[-_ ]?3(?![0-9.])",
        "Alibaba's Qwen3 generation: dense and mixture-of-experts models with strong multilingual, coding and agent skills.",
    ),
    (
        "(?i)qwen[-_ ]?2\\.5",
        "Alibaba's Qwen 2.5 series, with exceptional strength in coding, math and instruction following.",
    ),
    (
        "(?i)llama[-_ ]?3\\.1",
        "Meta's Llama 3.1: multilingual instruction-tuned models with 128K context and native tool calling.",
    ),
    (
        "(?i)llama[-_ ]?3\\.2",
        "Meta's Llama 3.2: lightweight 1B and 3B models for fast local inference, plus larger vision variants.",
    ),
    (
        "(?i)llama[-_ ]?3\\.3",
        "Meta's Llama 3.3 70B, an instruction-tuned multilingual model with performance near Llama 3.1 405B.",
    ),
    (
        "(?i)(^|[^a-z])phi[-_ ]?4",
        "Microsoft's Phi-4, compact models trained heavily on synthetic data for strong reasoning and STEM results.",
    ),
    (
        "(?i)gemma[-_ ]?2",
        "Google's Gemma 2, lightweight open models built from the same research as Gemini, from 2B to 27B.",
    ),
    (
        "(?i)gemma[-_ ]?3",
        "Google's Gemma 3, multimodal open models with a long context window and wide language coverage.",
    ),
    (
        "(?i)gemma",
        "Google's Gemma family, lightweight open models built from the research behind Gemini.",
    ),
    (
        "(?i)mistral|mixtral|ministral",
        "Mistral AI's open models, fast and capable general-purpose assistants with native function calling.",
    ),
    (
        "(?i)granite",
        "IBM's Granite models, open enterprise-grade models for instruction following, tool calling and retrieval.",
    ),
    (
        "(?i)minicpm",
        "OpenBMB's MiniCPM, compact models built for efficient on-device use, with MiniCPM-V adding vision.",
    ),
    (
        "(?i)cohere|(^|[^a-z])command[-_ ]?[ar]",
        "Cohere's Command models, built for enterprise agents, retrieval and tool use; the family behind Cohere North.",
    ),
];

/// Quantization names in a file name: `Q4_K_M`, `IQ2_XS`, `F16`, `BF16`, `PQ2_0` and the like.
static QUANT_PATTERN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?:^|[-_.])([iI]?[qQ][0-9][a-zA-Z0-9_]*|[fF]16|[bB][fF]16|[fF]32|[pP][tT]?[qQ][0-9][a-zA-Z0-9_]*)(?:[-_.]|$)").ok()
});
static SHARD_PATTERN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)-[0-9]{5}-of-[0-9]{5}\.gguf$|\.part[0-9]+of[0-9]+\.gguf$").ok()
});
// Projectors, importance matrices, MTP draft heads and companion drafts are helpers, not the model.
static HELPER_FILE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)mmproj|imatrix|(^|[/_.-])mtp([/_.-]|$)|-draft\.gguf$").ok());
static GGUF_EXTENSION: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)\.gguf$").ok());
static PART_SUFFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)\.part[0-9]+of[0-9]+$").ok());
static SHARD_SUFFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)-[0-9]{5}-of-[0-9]{5}$").ok());
static MODEL_GGUF_SUFFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)[-_.]gguf$").ok());
static F16_RANK: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(^|[-_.])f16").ok());
static EMBED_NAME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)(^|[^a-z])embed").ok());
static TOOLS_TEMPLATE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"\btools?\b").ok());
static THINK_TEMPLATE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"<think>|enable_thinking").ok());
static THINK_NAME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)(^|[^a-z0-9])(r1|qwq|thinking|reasoning)([^a-z0-9]|$)").ok());
static PARAMETER_COUNT: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[-_ .])[ea]?([0-9]+(?:\.[0-9]+)?)([bm])(?![a-z])").ok());
static LINK_NEXT: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"<([^>]+)>;\s*rel="next""#).ok());
static FAMILY_PATTERNS: LazyLock<Vec<(Option<Regex>, &'static str)>> = LazyLock::new(|| {
    FAMILIES
        .iter()
        .map(|(pattern, text)| (Regex::new(pattern).ok(), *text))
        .collect()
});

/// A pattern that is missing (it failed to compile) matches nothing; the tests catch that.
fn matches(pattern: &LazyLock<Option<Regex>>, text: &str) -> bool {
    pattern
        .as_ref()
        .is_some_and(|regex| regex.is_match(text).unwrap_or(false))
}

/// The text the first match captured in group 1, or None.
fn first_group(pattern: &LazyLock<Option<Regex>>, text: &str) -> Option<String> {
    let captures = pattern.as_ref()?.captures(text).ok()??;
    captures.get(1).map(|found| found.as_str().to_owned())
}

/// The text with the first match removed, as JavaScript's `replace` without a global flag does.
fn strip_first(pattern: &LazyLock<Option<Regex>>, text: &str) -> String {
    match pattern.as_ref() {
        Some(regex) => regex.replace(text, "").into_owned(),
        None => text.to_owned(),
    }
}

/// `String.prototype.trim`, which also strips the line terminators and the byte-order mark.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// `encodeURIComponent`: everything but letters, digits and `-_.!~*'()` becomes UTF-8 percent escapes.
fn encode_uri_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `Number(value)`: a missing value is NaN (`undefined`), null is zero, and a one-item array reads as its item.
fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => string_to_number(text),
        Some(Value::Array(items)) => match items.as_slice() {
            [] => 0.0,
            [Value::Null] => 0.0,
            [item @ (Value::Number(_) | Value::String(_))] => js_number(Some(item)),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `value || 0` for a size read from the tree.
fn size_of(value: Option<&Value>) -> u64 {
    let number = js_number(value);
    if number.is_finite() && number > 0.0 {
        number as u64
    } else {
        0
    }
}

static NULL_VALUE: Value = Value::Null;

/// A file in a Hugging Face repository, with its exact size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoFile {
    pub path: String,
    pub size: u64,
}

/// The files that make up one quantization: one file, or every part of a split model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagMatch {
    pub files: Vec<RepoFile>,
    pub primary: RepoFile,
    pub bytes: u64,
}

/// One entry of the library: a model a search or the top list found.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibraryModel {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub description: String,
    pub capabilities: Vec<String>,
    pub sizes: Vec<String>,
}

/// A file a download fetches besides the main one: a split part, a projector or a draft.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Companion {
    pub url: String,
    pub filename: String,
    pub size: u64,
}

/// What downloading one reference fetches: the main file, its draft, and the parts when they are fetched together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Download {
    pub url: String,
    pub filename: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<Companion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<Companion>>,
}

#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("HTTP {0}")]
    Status(u16),
    #[error("unreadable answer: {0}")]
    Json(#[from] serde_json::Error),
}

/// The type of a model whose task is not a chat task, or None for one that chats.
/// A task the list does not know is "other", so a new Hugging Face task still shows.
pub fn type_of_task(task: &str) -> Option<&'static str> {
    if task.is_empty() || CHAT_TASKS.contains(&task) || VISION_TASKS.contains(&task) {
        return None;
    }
    Some(
        TASK_TYPES
            .iter()
            .find(|(name, _)| *name == task)
            .map_or("other", |(_, kind)| *kind),
    )
}

fn type_label(kind: &str) -> &str {
    TYPE_LABELS
        .iter()
        .find(|(name, _)| *name == kind)
        .map_or(kind, |(_, label)| *label)
}

fn lookup(table: &'static [(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, label)| *label)
}

/// The quantization a file name carries, read from the file, then from its folders when the name has none.
fn extract_quant(file_path: &str) -> String {
    let mut segments: Vec<&str> = file_path.split('/').collect();
    let last = segments.pop().unwrap_or_default();
    let name = strip_first(&GGUF_EXTENSION, last);
    let name = strip_first(&PART_SUFFIX, &name);
    let name = strip_first(&SHARD_SUFFIX, &name);
    let mut candidates = vec![name];
    candidates.extend(segments.iter().rev().map(|segment| (*segment).to_owned()));
    for candidate in candidates {
        if let Some(found) = first_group(&QUANT_PATTERN, &candidate) {
            return found.to_uppercase();
        }
    }
    String::new()
}

fn is_model_file(file_path: &str) -> bool {
    let lower = file_path.to_lowercase();
    lower.ends_with(".gguf") && !matches(&HELPER_FILE, &lower)
}

/// The projector a vision model reads images through: a GGUF whose own name, in its folder, carries `mmproj`.
fn is_projector_file(file_path: &str) -> bool {
    let lower = file_path.to_lowercase();
    lower.ends_with(".gguf")
        && lower
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains("mmproj"))
}

/// The quantizations a repository really has, so the picker never offers one that cannot be downloaded.
pub fn extract_available_sizes(siblings: &Value) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for sibling in siblings.as_array().map_or(&[][..], Vec::as_slice) {
        let file = sibling
            .get("rfilename")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !is_model_file(file) {
            continue;
        }
        let quant = extract_quant(file);
        if !quant.is_empty() && !found.contains(&quant) {
            found.push(quant);
        }
    }
    if found.is_empty() {
        return FALLBACK_SIZES
            .iter()
            .map(|size| (*size).to_owned())
            .collect();
    }
    let mut sizes: Vec<String> = PREFERRED_QUANTS
        .iter()
        .filter(|quant| found.iter().any(|f| f == *quant))
        .map(|quant| (*quant).to_owned())
        .collect();
    sizes.extend(
        found
            .iter()
            .filter(|quant| !PREFERRED_QUANTS.contains(&quant.as_str()))
            .cloned(),
    );
    sizes.truncate(MAX_LISTED_QUANTS);
    sizes
}

/// The file, or every shard, that holds one quantization; None when the repository has none.
pub fn match_files_for_tag(files: &[RepoFile], tag: &str) -> Option<TagMatch> {
    let wanted = tag.to_uppercase();
    // A substring match is only trusted for names with no readable quant, or Q2_0 would pick PQ2_0.
    let hits: Vec<&RepoFile> = files
        .iter()
        .filter(|file| {
            let quant = extract_quant(&file.path);
            if quant.is_empty() {
                file.path.to_uppercase().contains(&wanted)
            } else {
                quant == wanted
            }
        })
        .collect();
    let first = *hits.first()?;

    let mut shards: Vec<&RepoFile> = hits
        .iter()
        .copied()
        .filter(|file| matches(&SHARD_PATTERN, &file.path))
        .collect();
    if shards.is_empty() {
        return Some(TagMatch {
            files: vec![first.clone()],
            primary: first.clone(),
            bytes: first.size,
        });
    }
    // TS quirk: the reference sorts with localeCompare; code point order matches it for shard names of one stem.
    shards.sort_by(|a, b| locale_cmp(&a.path, &b.path));
    let group = strip_first(&SHARD_PATTERN, &shards[0].path);
    let parts: Vec<RepoFile> = shards
        .iter()
        .filter(|file| strip_first(&SHARD_PATTERN, &file.path) == group)
        .map(|file| (*file).clone())
        .collect();
    let bytes = parts
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.size));
    let primary = parts[0].clone();
    Some(TagMatch {
        files: parts,
        primary,
        bytes,
    })
}

/// The projector to fetch: half precision when the repository has it, since every backend reads it.
pub fn pick_projector(files: &[RepoFile]) -> Option<RepoFile> {
    let rank = |file: &RepoFile| -> u8 {
        let name = file.path.to_lowercase();
        if matches(&F16_RANK, &name) {
            0
        } else if name.contains("bf16") {
            1
        } else if name.contains("q8") {
            2
        } else if name.contains("f32") {
            4
        } else {
            3
        }
    };
    let folder = |file: &RepoFile| u8::from(file.path.contains('/'));
    files
        .iter()
        .min_by(|a, b| {
            folder(a)
                .cmp(&folder(b))
                .then(rank(a).cmp(&rank(b)))
                .then_with(|| locale_cmp(&a.path, &b.path))
        })
        .cloned()
}

/// The repo's own name without its author or GGUF suffix: "bartowski/Llama-3.2-3B-Instruct-GGUF" is "Llama-3.2-3B-Instruct".
fn clean_model_name(repo: &str) -> String {
    let base = repo.rsplit('/').next().unwrap_or(repo);
    let stripped = strip_first(&MODEL_GGUF_SUFFIX, base);
    if stripped.is_empty() {
        base.to_owned()
    } else {
        stripped
    }
}

/// The parameter count from the name, or from the GGUF total when the name says none.
fn format_parameters(repo: &str, total: f64) -> String {
    if let Some(regex) = PARAMETER_COUNT.as_ref()
        && let Ok(Some(captures)) = regex.captures(&clean_model_name(repo))
        && let (Some(number), Some(unit)) = (captures.get(1), captures.get(2))
    {
        return format!("{}{}", number.as_str(), unit.as_str().to_uppercase());
    }
    if total >= 1e9 {
        let digits = if total < 1e10 { 1 } else { 0 };
        return format!("{}B", to_fixed(total / 1e9, digits));
    }
    if total >= 1e8 {
        return format!("{}M", round(total / 1e6) as u64);
    }
    String::new()
}

/// Everything a description and the capabilities are read from.
struct Context<'a> {
    repo: &'a str,
    author: &'a str,
    base: &'a str,
    task: &'a str,
    tags: &'a [String],
    kind: Option<&'static str>,
}

fn describe_model(item: &Value, context: &Context<'_>) -> String {
    // Only the repo's own name counts; a community model built on Qwen is not stock Qwen. A model that does not chat
    // is never the family's language model, whatever its name.
    if context.kind.is_none() {
        let name = clean_model_name(context.repo);
        let family = FAMILY_PATTERNS.iter().find(|(pattern, _)| {
            pattern
                .as_ref()
                .is_some_and(|regex| regex.is_match(&name).unwrap_or(false))
        });
        if let Some((_, text)) = family {
            return format!("{text} GGUF by {}.", context.author);
        }
    }

    let total = js_number(item.get("gguf").and_then(|gguf| gguf.get("total")));
    let params = format_parameters(context.repo, if total.is_nan() { 0.0 } else { total });
    let verb = item
        .get("baseModels")
        .and_then(|models| models.get("relation"))
        .and_then(Value::as_str)
        .and_then(|relation| lookup(RELATION_VERBS, relation))
        .unwrap_or("based on");
    let label = match context.kind {
        Some(kind) => type_label(kind),
        None => lookup(TASK_LABELS, context.task).unwrap_or("Language"),
    };
    let mut text = format!("{label} model");
    if !params.is_empty() {
        text.push_str(&format!(" with {params} parameters"));
    }
    if !context.base.is_empty() {
        text.push_str(&format!(", {verb} {}", context.base));
    }
    text.push('.');
    text.push_str(&format!(" GGUF by {}.", context.author));

    let mut traits: Vec<&str> = Vec::new();
    for tag in context.tags {
        if let Some(label) = lookup(TAG_LABELS, tag)
            && !traits.contains(&label)
        {
            traits.push(label);
        }
    }
    traits.truncate(3);
    if !traits.is_empty() {
        text.push_str(&format!(" Tagged {}.", traits.join(", ")));
    }
    text
}

fn detect_capabilities(context: &Context<'_>, chat_template: &str) -> Vec<String> {
    let named = format!("{} {}", context.repo, context.base);
    let has_tag = |tag: &str| context.tags.iter().any(|t| t == tag);
    let is_embedding = EMBEDDING_TASKS.contains(&context.task)
        || has_tag("text-embeddings-inference")
        || matches(&EMBED_NAME, &clean_model_name(context.repo));
    if is_embedding {
        return vec!["embedding".to_owned()];
    }

    let tools = matches(&TOOLS_TEMPLATE, chat_template)
        || has_tag("function-calling")
        || has_tag("tool-use");
    let thinking = matches(&THINK_TEMPLATE, chat_template)
        || has_tag("reasoning")
        || has_tag("thinking")
        || matches(&THINK_NAME, &named);
    let vision = VISION_TASKS.contains(&context.task) || has_tag("vision") || has_tag("multimodal");

    let mut capabilities = Vec::new();
    if tools {
        capabilities.push("tools".to_owned());
    }
    if thinking {
        capabilities.push("thinking".to_owned());
    }
    if vision {
        capabilities.push("vision".to_owned());
    }
    capabilities.push("completion".to_owned());
    capabilities
}

/// The first declared or linked base model that is not the repo itself, or "".
fn first_base_model(item: &Value, repo: &str) -> String {
    let declared = item.get("cardData").and_then(|card| card.get("base_model"));
    let declared: Vec<&Value> = match declared {
        Some(Value::Array(list)) => list.iter().collect(),
        Some(value) if truthy(value) => vec![value],
        _ => Vec::new(),
    };
    let linked: Vec<&Value> = item
        .get("baseModels")
        .and_then(|models| models.get("models"))
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|model| model.get("id")).collect())
        .unwrap_or_default();
    declared
        .into_iter()
        .chain(linked)
        .filter_map(Value::as_str)
        .find(|id| !id.is_empty() && *id != repo)
        .unwrap_or("")
        .to_owned()
}

/// The first of the given values that is truthy, read as text.
fn first_truthy_text<'a>(values: &[Option<&'a Value>]) -> &'a str {
    values
        .iter()
        .flatten()
        .find(|value| truthy(value))
        .and_then(|value| value.as_str())
        .unwrap_or("")
}

/// Turns one API item into a library entry, or None when it has no repo id. A model that does not chat is listed
/// with the type of model it is instead of being left out.
fn to_library_model(item: &Value) -> Option<LibraryModel> {
    let repo = item.get("id").and_then(Value::as_str).unwrap_or("");
    if !repo.contains('/') {
        return None;
    }
    let card = item.get("cardData");
    let task = first_truthy_text(&[
        item.get("pipeline_tag"),
        card.and_then(|c| c.get("pipeline_tag")),
    ]);
    let kind = type_of_task(task);

    let card_tags = card.and_then(|c| c.get("tags")).and_then(Value::as_array);
    let source: &[Value] = match (item.get("tags").and_then(Value::as_array), card_tags) {
        (Some(list), _) => list.as_slice(),
        (None, Some(list)) => list.as_slice(),
        (None, None) => &[],
    };
    let tags: Vec<String> = source
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_lowercase)
        .collect();
    let base = first_base_model(item, repo);
    let template = item
        .get("gguf")
        .and_then(|gguf| gguf.get("chat_template"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let author = repo.split('/').next().unwrap_or("");
    let context = Context {
        repo,
        author,
        base: &base,
        task,
        tags: &tags,
        kind,
    };
    let capabilities = match kind {
        Some(kind) => vec![kind.to_owned()],
        None => detect_capabilities(&context, template),
    };
    Some(LibraryModel {
        name: clean_model_name(repo),
        repo: Some(repo.to_owned()),
        description: describe_model(item, &context),
        capabilities,
        sizes: extract_available_sizes(item.get("siblings").unwrap_or(&NULL_VALUE)),
    })
}

/// The URL of the next tree page, named by a `Link` header with rel="next".
fn link_next(header: Option<&str>) -> Option<String> {
    first_group(&LINK_NEXT, header?)
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn repo_file_of(item: &Value) -> RepoFile {
    let lfs_size = item
        .get("lfs")
        .and_then(|lfs| lfs.get("size"))
        .filter(|value| !value.is_null());
    RepoFile {
        path: item
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        // An LFS file's real size is on its lfs entry; the plain size can be the pointer's.
        size: size_of(lfs_size.or_else(|| item.get("size"))),
    }
}

#[derive(Default)]
struct State {
    sizes: HashMap<String, u64>,
    files: HashMap<String, Vec<RepoFile>>,
    projectors: HashMap<String, Vec<RepoFile>>,
    top: Option<(Vec<LibraryModel>, u64)>,
}

/// Searches the model hub, lists repository files and resolves downloads. Caches live on the value.
pub struct HuggingFace<C> {
    client: C,
    policy: Mutex<UrlPolicy>,
    state: Mutex<State>,
    /// Held while the top list loads, so overlapping searches wait for one request rather than sending another.
    top_loader: tokio::sync::Mutex<()>,
}

impl<C: HttpClient> HuggingFace<C> {
    pub fn new(client: C) -> Self {
        Self {
            client,
            policy: Mutex::new(UrlPolicy::new()),
            state: Mutex::new(State::default()),
            top_loader: tokio::sync::Mutex::new(()),
        }
    }

    pub fn reset_search_cache(&self) {
        locked(&self.state).top = None;
    }

    fn allowed(&self, url: &str) -> bool {
        locked(&self.policy).is_fetchable_url(url, false)
    }

    /// Searches the hub for GGUF models; an empty query lists the most downloaded ones. Curated matches come first.
    pub async fn search(&self, query: &str, now_ms: u64) -> Vec<LibraryModel> {
        let term = js_trim(query).to_lowercase();
        if term.is_empty() {
            return self.load_top_models(now_ms).await;
        }
        let local: Vec<LibraryModel> = CURATED_MODELS
            .iter()
            .filter(|model| {
                model.name.to_lowercase().contains(&term)
                    || model.description.to_lowercase().contains(&term)
            })
            .map(|model| LibraryModel {
                name: model.name.to_owned(),
                repo: None,
                description: model.description.to_owned(),
                capabilities: model.capabilities.iter().map(|c| (*c).to_owned()).collect(),
                sizes: model.sizes.iter().map(|s| (*s).to_owned()).collect(),
            })
            .collect();
        let url = format!(
            "{MODELS_API}?search={}&filter=gguf&sort=downloads&direction=-1&limit=20&{EXPAND}",
            encode_uri_component(&term)
        );
        match self.fetch_model_list(&url, SEARCH_TIMEOUT).await {
            Ok(remote) => {
                let mut models = local;
                models.extend(remote.unwrap_or_default());
                models
            }
            Err(_) => {
                error!(target: "providers.huggingface", query_length = term.encode_utf16().count(), "search failed");
                local
            }
        }
    }

    fn fresh_top(&self, now_ms: u64) -> Option<Vec<LibraryModel>> {
        locked(&self.state)
            .top
            .as_ref()
            .filter(|(_, expires)| *expires > now_ms)
            .map(|(models, _)| models.clone())
    }

    /// The most downloaded GGUF models, kept in memory so repeated empty searches cost nothing.
    async fn load_top_models(&self, now_ms: u64) -> Vec<LibraryModel> {
        if let Some(models) = self.fresh_top(now_ms) {
            return models;
        }
        let _loading = self.top_loader.lock().await;
        if let Some(models) = self.fresh_top(now_ms) {
            return models;
        }
        match self.fetch_model_list(TOP_MODELS_URL, SEARCH_TIMEOUT).await {
            Ok(Some(models)) => {
                // An empty answer is not kept, so the next search asks again.
                if !models.is_empty() {
                    locked(&self.state).top = Some((models.clone(), now_ms + TOP_MODELS_TTL_MS));
                }
                models
            }
            Ok(None) => Vec::new(),
            Err(err) => {
                error!(target: "providers.huggingface", reason = %err, "top models failed");
                Vec::new()
            }
        }
    }

    async fn fetch_model_list(
        &self,
        url: &str,
        timeout: Duration,
    ) -> Result<Option<Vec<LibraryModel>>, HubError> {
        if !self.allowed(url) {
            return Ok(None);
        }
        let mut reply = self.client.get(url, &[], Some(timeout)).await?;
        if !(200..300).contains(&reply.status) {
            return Ok(None);
        }
        let data: Value = serde_json::from_slice(&read_all(&mut reply.body).await?)?;
        Ok(data
            .as_array()
            .map(|items| items.iter().filter_map(to_library_model).collect()))
    }

    async fn get_ok(&self, url: &str, timeout: Duration) -> Result<Reply<C::Body>, HubError> {
        let reply = self.client.get(url, &[], Some(timeout)).await?;
        if (200..300).contains(&reply.status) {
            Ok(reply)
        } else {
            Err(HubError::Status(reply.status))
        }
    }

    /// One page of a repository tree; a slow answer is tried once more before the lookup gives up.
    async fn tree_page(&self, url: &str) -> Result<Reply<C::Body>, HubError> {
        let mut attempt = 0;
        loop {
            match self.get_ok(url, TREE_TIMEOUT).await {
                Ok(reply) => return Ok(reply),
                Err(err) if attempt >= 1 => return Err(err),
                Err(err) => {
                    attempt += 1;
                    debug!(target: "providers.huggingface", attempt, reason = %err, "tree page retry");
                }
            }
        }
    }

    /// Every entry of a repository tree, across its pages. None when a page is not a list.
    async fn walk_tree(&self, first: &str) -> Result<Option<Vec<Value>>, HubError> {
        let mut tree = Vec::new();
        let mut next = Some(first.to_owned());
        for _ in 0..TREE_MAX_PAGES {
            let Some(url) = next.take() else { break };
            let mut reply = self.tree_page(&url).await?;
            let entries: Value = serde_json::from_slice(&read_all(&mut reply.body).await?)?;
            let Some(items) = entries.as_array() else {
                return Ok(None);
            };
            tree.extend(items.iter().cloned());
            next = link_next(reply.header("link")).filter(|candidate| self.allowed(candidate));
        }
        Ok(Some(tree))
    }

    fn cached_files(&self, repo: &str) -> Option<Vec<RepoFile>> {
        locked(&self.state).files.get(repo).cloned()
    }

    /// The GGUF files of a repository, with exact sizes. The projectors are kept beside them. A failed lookup is not kept.
    async fn repo_files(&self, repo: &str) -> Vec<RepoFile> {
        if let Some(files) = self.cached_files(repo) {
            return files;
        }
        let url = format!("{MODELS_API}/{repo}/tree/main?recursive=true");
        if !self.allowed(&url) {
            return Vec::new();
        }
        match self.walk_tree(&url).await {
            Ok(Some(tree)) => {
                let files: Vec<RepoFile> = tree
                    .iter()
                    .map(repo_file_of)
                    .filter(|file| is_model_file(&file.path))
                    .collect();
                let projectors: Vec<RepoFile> = tree
                    .iter()
                    .map(repo_file_of)
                    .filter(|file| is_projector_file(&file.path))
                    .collect();
                let mut state = locked(&self.state);
                state.files.insert(repo.to_owned(), files.clone());
                state.projectors.insert(repo.to_owned(), projectors);
                files
            }
            Ok(None) => Vec::new(),
            Err(err) => {
                warn!(target: "providers.huggingface", repo = %repo, reason = %err, "repo tree unavailable");
                Vec::new()
            }
        }
    }

    async fn repo_projector(&self, repo: &str) -> Option<RepoFile> {
        self.repo_files(repo).await;
        let projectors = locked(&self.state)
            .projectors
            .get(repo)
            .cloned()
            .unwrap_or_default();
        pick_projector(&projectors)
    }

    /// The size in bytes of one variant, with the projector a vision model reads images through. None when it cannot be found.
    pub async fn model_size(&self, name: &str, tag: &str) -> Option<u64> {
        let key = format!("{name}:{tag}");
        if let Some(bytes) = locked(&self.state).sizes.get(&key).copied() {
            return Some(bytes);
        }
        if let Some(variant) = CURATED_MODELS
            .iter()
            .find(|model| model.name == name)
            .and_then(|model| model.variant(tag))
        {
            let bytes = variant.source.bytes;
            locked(&self.state).sizes.insert(key, bytes);
            return Some(bytes);
        }
        if name.contains('/') {
            let files = self.repo_files(name).await;
            if let Some(found) = match_files_for_tag(&files, tag).filter(|found| found.bytes > 0) {
                let projector = self.repo_projector(name).await.map_or(0, |file| file.size);
                let bytes = found.bytes.saturating_add(projector);
                locked(&self.state).sizes.insert(key, bytes);
                return Some(bytes);
            }
        }
        None
    }

    /// Resolves `name:tag` into the files to fetch. With `include_draft`, a curated model's draft joins the parts.
    pub async fn resolve_download(&self, reference: &str, include_draft: bool) -> Option<Download> {
        let mut pieces = reference.split(':');
        let name = pieces.next().unwrap_or("");
        let tag = pieces.next().unwrap_or("latest");

        if let Some(curated) = CURATED_MODELS.iter().find(|model| model.name == name) {
            let key = if curated.variant(tag).is_some() {
                tag
            } else {
                curated.sizes.first().copied().unwrap_or("")
            };
            if let Some(variant) = curated.variant(key) {
                let source = variant.source;
                let mut primary = Download {
                    url: hub_url(source.repo, source.file),
                    filename: source.file.to_owned(),
                    size: source.bytes,
                    draft: None,
                    parts: None,
                };
                if let Some(draft) = variant.draft {
                    let companion = Companion {
                        url: hub_url(draft.repo, draft.file),
                        filename: draft_companion_name(source.file),
                        size: draft.bytes,
                    };
                    primary.draft = Some(companion.clone());
                    if include_draft {
                        primary.parts = Some(vec![
                            Companion {
                                url: primary.url.clone(),
                                filename: primary.filename.clone(),
                                size: primary.size,
                            },
                            companion.clone(),
                        ]);
                        primary.size = primary.size.saturating_add(companion.size);
                    }
                }
                return Some(primary);
            }
        }

        if name.contains('/') {
            let files = self.repo_files(name).await;
            if let Some(found) = match_files_for_tag(&files, tag) {
                let url_of = |file: &RepoFile| {
                    format!(
                        "https://huggingface.co/{name}/resolve/main/{}?download=true",
                        file.path
                    )
                };
                let mut download = Download {
                    url: url_of(&found.primary),
                    filename: basename(&found.primary.path).to_owned(),
                    size: found.bytes,
                    draft: None,
                    parts: None,
                };
                // A model split into parts needs every one on disk; llama-server exits at once when one is missing.
                if found.files.len() > 1
                    && found
                        .files
                        .iter()
                        .all(|file| parse_shard(&file.path).is_some())
                {
                    download.parts = Some(
                        found
                            .files
                            .iter()
                            .map(|file| Companion {
                                url: url_of(file),
                                filename: basename(&file.path).to_owned(),
                                size: file.size,
                            })
                            .collect(),
                    );
                }
                if let Some(projector) = self.repo_projector(name).await {
                    let companion = Companion {
                        url: url_of(&projector),
                        filename: companion_name(&download.filename),
                        size: projector.size,
                    };
                    let mut parts = download.parts.take().unwrap_or_else(|| {
                        vec![Companion {
                            url: download.url.clone(),
                            filename: download.filename.clone(),
                            size: download.size,
                        }]
                    });
                    parts.push(companion);
                    download.parts = Some(parts);
                    download.size = download.size.saturating_add(projector.size);
                }
                info!(
                    target: "providers.huggingface",
                    repo = %name,
                    file = %download.filename,
                    bytes = download.size,
                    parts = download.parts.as_ref().map_or(1, Vec::len),
                    "download resolved"
                );
                return Some(download);
            }
        }
        None
    }
}

pub(crate) fn hub_url(repo: &str, file: &str) -> String {
    format!("https://huggingface.co/{repo}/resolve/main/{file}?download=true")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64) -> RepoFile {
        RepoFile {
            path: path.to_owned(),
            size,
        }
    }

    #[test]
    fn a_quant_is_read_from_the_name_then_the_folders() {
        assert_eq!(extract_quant("m-Q4_K_M-00001-of-00002.gguf"), "Q4_K_M");
        assert_eq!(extract_quant("IQ2_XS/Flash.gguf"), "IQ2_XS");
        assert_eq!(extract_quant("plain.gguf"), "");
    }

    #[test]
    fn a_projector_is_never_a_model_file() {
        assert!(!is_model_file("mmproj-F16.gguf"));
        assert!(!is_model_file("MTP/mtp-x-Q8_0.gguf"));
        assert!(is_projector_file("sub/mmproj-F16.gguf"));
    }

    #[test]
    fn half_precision_projectors_come_first() {
        let picked = pick_projector(&[file("mmproj-F32.gguf", 40), file("mmproj-F16.gguf", 20)]);
        assert_eq!(
            picked.map(|found| found.path),
            Some("mmproj-F16.gguf".to_owned())
        );
    }

    #[test]
    fn a_shard_group_is_summed_and_a_lone_file_is_taken_as_is() {
        let parts = match_files_for_tag(
            &[
                file("big-Q4_K_M-00002-of-00002.gguf", 12),
                file("big-Q4_K_M-00001-of-00002.gguf", 30),
            ],
            "Q4_K_M",
        );
        assert_eq!(parts.map(|found| found.bytes), Some(42));
        assert_eq!(
            match_files_for_tag(&[file("a-PQ2_0.gguf", 5)], "Q2_0"),
            None
        );
    }

    #[test]
    fn the_fallback_quants_stand_in_for_a_repo_with_no_siblings() {
        assert_eq!(
            extract_available_sizes(&NULL_VALUE),
            vec!["Q4_K_M", "Q5_K_M", "Q8_0"]
        );
    }

    #[test]
    fn parameters_round_ties_up_like_to_fixed() {
        assert_eq!(format_parameters("acme/Odd-GGUF", 2_250_000_000.0), "2.3B");
        assert_eq!(format_parameters("acme/Named-7B-GGUF", 0.0), "7B");
    }

    #[test]
    fn js_trim_keeps_next_line_out_of_the_trim() {
        assert_eq!(js_trim("\u{FEFF} hi \u{A0}"), "hi");
        assert_eq!(js_trim("\u{85}x"), "\u{85}x");
    }

    #[test]
    fn query_escaping_matches_encode_uri_component() {
        assert_eq!(encode_uri_component("qwen 2.5"), "qwen%202.5");
        assert_eq!(encode_uri_component("a&b"), "a%26b");
    }
}
