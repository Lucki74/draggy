//! The numbers and flags a llama-server launch is built from: cache type, window, batches, threads, speculation and streams.
//! Pure, so each rule is a fixture. Port of the argument-building parts of electron/llamaProcess.cjs.

use std::sync::LazyLock;

use draggy_models::gguf::GgufHeader;
use regex::Regex;

use crate::cpu_topology::CpuTopology;

const GB: f64 = 1024.0 * 1024.0 * 1024.0;
/// The window a model loads at when nothing says what it was trained for.
const DEFAULT_CEILING: u64 = 16_384;
/// The window a context-size request starts from when nobody names one.
pub const DEFAULT_CONTEXT: u64 = 8_192;
/// Windows a model is loaded at without being asked: each is a reload the conversation will not need.
const ROOMY_CONTEXTS: [u64; 3] = [32_768, 16_384, 8_192];
/// A mixture-of-experts model starts no smaller than this, since its load is the slowest.
const MOE_MIN_CONTEXT: u64 = 16_384;
/// Backends whose flash attention reads a quantised KV cache slower than f16 during generation.
const F16_KV_RUNNERS: [&str; 2] = ["metal", "vulkan"];
/// KV cost per token at q8_0 when the header does not say, from typical 7-14B GQA models.
const DEFAULT_KV_Q8_BYTES: f64 = 105.0 * 1024.0;

static MTP_NAME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[._-])mtp(?:[._-]|$)").ok());

/// The fields of a GGUF header that a launch reads. Missing keys are None, as the reference reads zero as missing.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HeaderFacts {
    pub expert_count: f64,
    pub context_length: Option<f64>,
    pub block_count: Option<f64>,
    pub head_count_kv: Option<f64>,
    pub key_length: Option<f64>,
    pub value_length: Option<f64>,
    pub mtp: bool,
}

impl From<&GgufHeader> for HeaderFacts {
    fn from(header: &GgufHeader) -> Self {
        Self {
            expert_count: header.expert_count,
            context_length: header.context_length,
            block_count: header.block_count,
            head_count_kv: header.head_count_kv,
            key_length: header.key_length,
            value_length: header.value_length,
            mtp: header.mtp,
        }
    }
}

/// What a launch needs to know about a model file: whether it is a mixture of experts, the window it was trained for,
/// what one token of q8_0 KV cache costs, and whether it carries multi-token-prediction heads.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelTraits {
    pub moe: bool,
    pub trained_context: Option<u64>,
    pub kv_bytes_q8: Option<f64>,
    pub mtp: bool,
}

impl ModelTraits {
    /// Traits from a header that was read, or None when it did not parse. The name still says whether the model is MTP.
    pub fn from_facts(facts: Option<&HeaderFacts>, file_name: &str) -> Self {
        let mtp_by_name = MTP_NAME.as_ref().is_some_and(|re| re.is_match(file_name));
        let Some(facts) = facts else {
            return Self {
                mtp: mtp_by_name,
                ..Self::default()
            };
        };
        let positive = |value: Option<f64>| value.filter(|v| *v > 0.0);
        let block_count = positive(facts.block_count);
        let head_count_kv = positive(facts.head_count_kv);
        let key_length = positive(facts.key_length);
        let value_length = positive(facts.value_length);
        // q8_0 stores 32 values in 34 bytes.
        let kv_bytes_q8 = match (block_count, head_count_kv, key_length, value_length) {
            (Some(blocks), Some(heads), Some(key), Some(value)) => {
                Some((blocks * heads * (key + value) * (34.0 / 32.0)).ceil())
            }
            _ => None,
        };
        Self {
            moe: facts.expert_count > 1.0,
            trained_context: positive(facts.context_length).map(|v| v as u64),
            kv_bytes_q8,
            mtp: facts.mtp || mtp_by_name,
        }
    }
}

/// The KV cache type and the window a launch runs at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KvPlan {
    pub cache_type: &'static str,
    pub effective_context: u64,
}

/// Picks the KV cache type and a context that fits VRAM, since WDDM spills overflow into slow system RAM.
/// When the card has room to spare, the window is also rounded up, so a growing conversation does not reload.
pub fn determine_kv_cache(
    model_bytes: Option<u64>,
    context: u64,
    vram_gb: f64,
    traits: &ModelTraits,
    exact: bool,
    runner: Option<&str>,
) -> KvPlan {
    let ceiling = traits
        .trained_context
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_CEILING);
    // A mixture of experts is mostly expert weights, which --fit parks in system RAM before it gives up any cache.
    if traits.moe {
        let floor = if exact {
            context
        } else {
            MOE_MIN_CONTEXT.min(ceiling)
        };
        return KvPlan {
            cache_type: "q8_0",
            effective_context: context.max(floor),
        };
    }

    let usable = if vram_gb > 0.0 {
        vram_gb * 0.9 - 0.8
    } else {
        0.0
    };
    let model_gb = model_bytes.map_or(0.0, |bytes| bytes as f64 / GB);
    let known = vram_gb > 0.0 && model_gb > 0.0;
    let free = usable - model_gb;
    let q8_per_token = traits
        .kv_bytes_q8
        .filter(|value| *value > 0.0)
        .unwrap_or(DEFAULT_KV_Q8_BYTES);
    // q4_0 stores 32 values in 18 bytes.
    let q4_per_token = q8_per_token * (18.0 / 34.0);
    let fits_gb = |tokens: f64, per_token: f64| (tokens * per_token) / GB;

    let cache_type = if known && free < fits_gb(context as f64, q8_per_token) {
        "q4_0"
    } else {
        "q8_0"
    };
    let mut effective = if known && free > 0.0 {
        let affordable = ((free * GB) / q4_per_token).floor() as u64;
        4096u64.max(context.min(affordable))
    } else {
        context
    };

    // A window the user fixed is theirs; only an automatic one is rounded up.
    if known && cache_type == "q8_0" && !exact {
        // Keep a fifth of the headroom free: --fit, the compute buffer and the desktop share it.
        let roomy = ROOMY_CONTEXTS
            .iter()
            .copied()
            .find(|size| *size <= ceiling && fits_gb(*size as f64, q8_per_token) <= free * 0.8);
        if let Some(size) = roomy {
            effective = effective.max(size);
        }
        // f16 is twice the size of q8_0 (32 values in 64 bytes against 34), so only where it still fits.
        let f16_fits = fits_gb(effective as f64, q8_per_token * (64.0 / 34.0)) <= free * 0.8;
        if runner.is_some_and(|name| F16_KV_RUNNERS.contains(&name)) && f16_fits {
            return KvPlan {
                cache_type: "f16",
                effective_context: effective,
            };
        }
    }
    KvPlan {
        cache_type,
        effective_context: effective,
    }
}

/// Prompt batch sizes. A bigger micro-batch processes a long prompt much faster on CUDA, and --fit budgets
/// the larger compute buffer, so it is paid for with weights moved off the card rather than a failed load.
pub fn batch_sizes(runner: Option<&str>, vram_gb: f64, moe: bool) -> (u64, u64) {
    let ubatch = match runner {
        Some("cuda") => {
            if moe || vram_gb >= 10.0 {
                2048
            } else {
                1024
            }
        }
        Some("rocm") if vram_gb >= 12.0 => 1024,
        _ => 512,
    };
    (2048u64.max(ubatch), ubatch)
}

/// Headroom --fit reserves so the desktop and browser do not push allocations over physical VRAM into shared memory.
pub fn fit_target_mib(vram_gb: f64, windows: bool) -> i64 {
    if vram_gb <= 0.0 || vram_gb.is_nan() {
        return 1024;
    }
    let reserved_gb = if windows {
        2.0f64.max((vram_gb * 0.25).min(vram_gb * 0.15 + 0.8))
    } else {
        1.0f64.max(vram_gb * 0.1)
    };
    js_round(reserved_gb * 1024.0)
}

/// How much RAM llama-server may keep earlier prompts in, from what the weights leave in RAM.
pub fn prompt_cache_mib(model_bytes: Option<u64>, total_ram_bytes: u64) -> i64 {
    let spare_gb = (total_ram_bytes as f64 - model_bytes.unwrap_or(0) as f64) / GB - 6.0;
    let mib = (spare_gb / 2.0 * 1024.0).clamp(1024.0, 16_384.0);
    js_round(mib)
}

/// Whether a draft model can sit on the card beside a dense model without pushing the model's own layers into RAM.
/// A mixture of experts already keeps its experts in RAM, and without a known card there is nothing to protect.
pub fn draft_fits(
    model_bytes: Option<u64>,
    draft_bytes: Option<u64>,
    vram_gb: f64,
    moe: bool,
) -> bool {
    if vram_gb.is_nan() || vram_gb <= 0.0 || moe {
        return true;
    }
    let gigabytes = |bytes: Option<u64>| bytes.map_or(0.0, |value| value as f64 / GB);
    let usable = vram_gb * 0.9 - 0.8;
    // The draft brings its own KV cache and compute buffer; a quarter of its size covers both.
    gigabytes(model_bytes) + gigabytes(draft_bytes) * 1.25 <= usable
}

/// Generation threads on the performance cores; prompt processing on every physical core.
pub fn thread_counts(requested: Option<i64>, topology: &CpuTopology) -> (i64, i64) {
    let threads = match requested {
        Some(count) if count > 0 => count,
        _ => topology.performance as i64,
    };
    (threads, threads.max(topology.physical as i64))
}

/// Whether a model loaded at `loaded` can serve a start that works out to `wanted`: the same window, or a bigger one
/// when the window was not fixed, since shrinking would reload the model and lose its cache for nothing.
pub fn serves_window(loaded: u64, wanted: u64, exact: bool) -> bool {
    loaded == wanted || (!exact && loaded > wanted)
}

/// The window a start asks for. A caller that names none gets the window the same model is already loaded or
/// loading at, instead of a default that would reload it at another size.
pub fn requested_context(
    explicit: Option<u64>,
    starting: Option<u64>,
    running: Option<u64>,
) -> u64 {
    explicit
        .filter(|value| *value > 0)
        .or(starting)
        .or(running)
        .unwrap_or(DEFAULT_CONTEXT)
}

/// How long a model may take to load before the start is given up: 20 s per GB, between 30 s and 180 s.
pub fn ready_timeout_ms(model_bytes: Option<u64>) -> u64 {
    let Some(bytes) = model_bytes else {
        return 90_000;
    };
    let size_gb = (bytes as f64 / GB).ceil();
    (size_gb * 20_000.0).clamp(30_000.0, 180_000.0) as u64
}

/// Overlays values on the inherited environment, dropping other-case twins such as Path.
pub fn build_env(
    inherited: &[(String, String)],
    overrides: &[(String, String)],
) -> Vec<(String, String)> {
    let wanted: Vec<String> = overrides
        .iter()
        .map(|(key, _)| key.to_uppercase())
        .collect();
    let mut env: Vec<(String, String)> = inherited
        .iter()
        .filter(|(key, _)| !wanted.contains(&key.to_uppercase()))
        .cloned()
        .collect();
    env.extend(overrides.iter().cloned());
    env
}

/// Speculative decoding in use: none, a companion draft model, MTP heads, or context n-grams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speculation {
    Off,
    Draft,
    Mtp,
    Ngram,
}

impl Speculation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "none",
            Self::Draft => "draft",
            Self::Mtp => "mtp",
            Self::Ngram => "ngram",
        }
    }
}

/// Settings for streaming routed experts from disk, for builds that list the flags (llama.cpp PR 25294).
#[derive(Debug, Clone, PartialEq)]
pub struct MoeStream {
    pub cache_gb: f64,
    pub io_threads: Option<i64>,
    pub direct: bool,
    pub vram_slots: f64,
}

/// Arguments that stream routed experts from disk. A build that does not list the flags gets none, so the server
/// starts as it always did.
pub fn moe_stream_args(supports: &dyn Fn(&str) -> bool, stream: Option<&MoeStream>) -> Vec<String> {
    let Some(stream) = stream else {
        return Vec::new();
    };
    let mut args = Vec::new();
    if supports("--moe-stream-cache") && stream.cache_gb > 0.0 {
        let gigabytes = 1.0f64.max(stream.cache_gb.floor()) as u64;
        args.extend(["--moe-stream-cache".to_owned(), format!("{gigabytes}G")]);
        if supports("--moe-stream-io-threads") {
            let threads = stream.io_threads.filter(|count| *count != 0).unwrap_or(4);
            args.extend(["--moe-stream-io-threads".to_owned(), threads.to_string()]);
        }
        if stream.direct && supports("--moe-stream-direct") {
            args.push("--moe-stream-direct".to_owned());
        }
    }
    if stream.vram_slots > 0.0 && supports("--moe-expert-cache") {
        args.extend([
            "--moe-expert-cache".to_owned(),
            (stream.vram_slots.floor() as u64).to_string(),
        ]);
    }
    args
}

/// A draft model that may be used, with its size and the number of tokens it drafts per step.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftCandidate<'a> {
    pub path: &'a str,
    pub bytes: Option<u64>,
    /// Zero or absent means the default of 8, as the reference's `max || 8` reads it.
    pub max: Option<u64>,
}

/// Everything a launch's arguments depend on, with the file and host reads already made.
#[derive(Debug, Clone)]
pub struct LaunchInput<'a> {
    pub model: &'a str,
    pub model_bytes: Option<u64>,
    pub traits: &'a ModelTraits,
    pub context: u64,
    pub exact_context: bool,
    pub vram_gb: f64,
    pub windows: bool,
    pub runner: Option<&'a str>,
    pub port: u16,
    pub gpu_layers: Option<i64>,
    pub requested_threads: Option<i64>,
    pub topology: CpuTopology,
    pub total_ram_bytes: u64,
    pub speculative: bool,
    pub draft: Option<DraftCandidate<'a>>,
    pub moe_stream: Option<&'a MoeStream>,
    pub projector: Option<&'a str>,
}

/// The arguments for one launch, and the decisions behind them that the log and the status report.
#[derive(Debug, Clone, PartialEq)]
pub struct Launch {
    pub args: Vec<String>,
    pub cache_type: &'static str,
    pub context: u64,
    pub batch: u64,
    pub ubatch: u64,
    pub threads: i64,
    pub threads_batch: i64,
    pub fit_target: Option<i64>,
    pub speculation: Speculation,
    pub draft_in_use: bool,
    /// The draft was offered but would push the model's layers off the card.
    pub draft_dropped_for_fit: bool,
    /// Expert streaming was planned, but this build does not list its flags.
    pub stream_unsupported: bool,
}

/// Builds the llama-server arguments for one launch, in the reference's order. `supports` says whether this build
/// lists a flag, so a newer flag never reaches an older engine.
pub fn plan_launch(input: &LaunchInput<'_>, supports: &dyn Fn(&str) -> bool) -> Launch {
    let kv = determine_kv_cache(
        input.model_bytes,
        input.context,
        input.vram_gb,
        input.traits,
        input.exact_context,
        input.runner,
    );
    let (batch, ubatch) = batch_sizes(input.runner, input.vram_gb, input.traits.moe);
    let (threads, threads_batch) = thread_counts(input.requested_threads, &input.topology);

    let mut args: Vec<String> = [
        "-m",
        input.model,
        "--port",
        &input.port.to_string(),
        "--host",
        "127.0.0.1",
        "-c",
        &kv.effective_context.to_string(),
        "-ctk",
        kv.cache_type,
        "-ctv",
        kv.cache_type,
    ]
    .iter()
    .map(|arg| (*arg).to_owned())
    .collect();
    // Any -ngl, even 99, disables --fit, so a model bigger than VRAM spills into shared memory.
    if let Some(layers) = input.gpu_layers {
        args.extend(["-ngl".to_owned(), layers.to_string()]);
    }
    // One slot: each extra slot multiplies the KV cache and pushes layers back onto the CPU.
    args.extend([
        "--parallel".to_owned(),
        "1".to_owned(),
        "-b".to_owned(),
        batch.to_string(),
        "-ub".to_owned(),
        ubatch.to_string(),
        "-t".to_owned(),
        threads.to_string(),
        "-tb".to_owned(),
        threads_batch.to_string(),
        "--cache-reuse".to_owned(),
        "256".to_owned(),
        "--jinja".to_owned(),
    ]);

    // A draft that would push the model off the card is dropped before any flag is chosen.
    let mut draft_dropped_for_fit = false;
    let draft = match &input.draft {
        Some(candidate)
            if !draft_fits(
                input.model_bytes,
                candidate.bytes,
                input.vram_gb,
                input.traits.moe,
            ) =>
        {
            draft_dropped_for_fit = true;
            None
        }
        other => other.as_ref(),
    };

    let mut speculation = Speculation::Off;
    let mut draft_in_use = false;
    let draft_flag_known = supports("--model-draft") || supports("-md");
    if let Some(candidate) = draft.filter(|_| draft_flag_known) {
        speculation = Speculation::Draft;
        draft_in_use = true;
        let flag = if supports("--model-draft") {
            "--model-draft"
        } else {
            "-md"
        };
        args.extend([flag.to_owned(), candidate.path.to_owned()]);
        let max = candidate.max.filter(|value| *value > 0).unwrap_or(8);
        if supports("--draft-max") {
            args.extend(["--draft-max".to_owned(), max.to_string()]);
        }
        if supports("--draft-min") {
            args.extend(["--draft-min".to_owned(), "1".to_owned()]);
        }
        if supports("--draft-p-min") {
            args.extend(["--draft-p-min".to_owned(), "0.75".to_owned()]);
        }
        if supports("-ngld") {
            args.extend(["-ngld".to_owned(), "99".to_owned()]);
        }
    } else if input.traits.mtp && supports("--spec-type") {
        speculation = Speculation::Mtp;
        args.extend(["--spec-type".to_owned(), "draft-mtp".to_owned()]);
        if supports("--spec-draft-n-max") {
            args.extend(["--spec-draft-n-max".to_owned(), "3".to_owned()]);
        }
    } else if input.speculative && supports("--spec-default") {
        speculation = Speculation::Ngram;
        args.push("--spec-default".to_owned());
    }

    if supports("--cache-ram") {
        let mib = prompt_cache_mib(input.model_bytes, input.total_ram_bytes);
        args.extend(["--cache-ram".to_owned(), mib.to_string()]);
    }
    let stream_args = moe_stream_args(supports, input.moe_stream);
    let stream_unsupported = input.moe_stream.is_some() && stream_args.is_empty();
    args.extend(stream_args);

    let fit_target =
        if input.gpu_layers.is_none() && supports("--fit-target") && input.vram_gb > 0.0 {
            Some(fit_target_mib(input.vram_gb, input.windows))
        } else {
            None
        };
    if let Some(target) = fit_target {
        args.extend(["--fit-target".to_owned(), target.to_string()]);
    }

    if input.runner == Some("cpu") {
        if supports("--cpu-strict") {
            args.extend(["--cpu-strict".to_owned(), "1".to_owned()]);
        }
        let range_flag = if supports("-Cr") {
            Some("-Cr")
        } else if supports("--cpu-range") {
            Some("--cpu-range")
        } else {
            None
        };
        if let Some(flag) = range_flag.filter(|_| threads > 1) {
            args.extend([flag.to_owned(), format!("0-{}", threads - 1)]);
        }
    }

    // Without its projector a vision model answers as if no image had been sent.
    if let Some(projector) = input.projector {
        args.extend(["--mmproj".to_owned(), projector.to_owned()]);
    }

    Launch {
        args,
        cache_type: kv.cache_type,
        context: kv.effective_context,
        batch,
        ubatch,
        threads,
        threads_batch,
        fit_target,
        speculation,
        draft_in_use,
        draft_dropped_for_fit,
        stream_unsupported,
    }
}

/// JavaScript's `Math.round` for the non-negative values sizing produces: halves round up.
fn js_round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1024 * 1024 * 1024;

    fn dense(trained: Option<u64>, kv: Option<f64>) -> ModelTraits {
        ModelTraits {
            moe: false,
            trained_context: trained,
            kv_bytes_q8: kv,
            mtp: false,
        }
    }

    #[test]
    fn traits_read_the_cache_shape_from_the_header() {
        let facts = HeaderFacts {
            expert_count: 0.0,
            context_length: Some(131_072.0),
            block_count: Some(32.0),
            head_count_kv: Some(8.0),
            key_length: Some(128.0),
            value_length: Some(128.0),
            mtp: false,
        };
        let traits = ModelTraits::from_facts(Some(&facts), "m.gguf");
        assert_eq!(traits.trained_context, Some(131_072));
        assert_eq!(traits.kv_bytes_q8, Some(69_632.0));
        assert!(!traits.moe);
    }

    #[test]
    fn a_name_alone_marks_an_mtp_model_when_the_header_is_unreadable() {
        assert!(ModelTraits::from_facts(None, "qwen-mtp-Q4.gguf").mtp);
        assert!(!ModelTraits::from_facts(None, "smtpx.gguf").mtp);
    }

    #[test]
    fn a_mixture_of_experts_keeps_q8_and_starts_at_16k() {
        let moe = ModelTraits {
            moe: true,
            trained_context: Some(262_144),
            ..ModelTraits::default()
        };
        let plan = determine_kv_cache(Some(16 * GIB), 4096, 8.0, &moe, false, None);
        assert_eq!(
            plan,
            KvPlan {
                cache_type: "q8_0",
                effective_context: 16_384
            }
        );
    }

    #[test]
    fn a_fixed_window_is_never_rounded_up() {
        let traits = dense(Some(131_072), Some(72.0 * 1024.0));
        let plan = determine_kv_cache(Some(4 * GIB), 4096, 12.0, &traits, true, None);
        assert_eq!(plan.effective_context, 4096);
    }

    #[test]
    fn f16_is_used_only_on_metal_and_vulkan_with_room() {
        let traits = dense(Some(32_768), Some(64.0 * 1024.0));
        let vulkan = determine_kv_cache(Some(4 * GIB), 8192, 16.0, &traits, false, Some("vulkan"));
        assert_eq!(vulkan.cache_type, "f16");
        let cuda = determine_kv_cache(Some(4 * GIB), 8192, 16.0, &traits, false, Some("cuda"));
        assert_eq!(cuda.cache_type, "q8_0");
    }

    #[test]
    fn cuda_gets_a_bigger_micro_batch_and_moe_the_biggest() {
        assert_eq!(batch_sizes(Some("cuda"), 12.0, false), (2048, 2048));
        assert_eq!(batch_sizes(Some("cuda"), 8.0, false), (2048, 1024));
        assert_eq!(batch_sizes(Some("cuda"), 8.0, true), (2048, 2048));
        assert_eq!(batch_sizes(Some("vulkan"), 12.0, false), (2048, 512));
        assert_eq!(batch_sizes(None, 0.0, false), (2048, 512));
    }

    #[test]
    fn fit_target_reserves_more_on_windows() {
        assert_eq!(fit_target_mib(12.0, true), 2662);
        assert_eq!(fit_target_mib(8.0, true), 2048);
        assert_eq!(fit_target_mib(0.0, true), 1024);
        assert_eq!(fit_target_mib(12.0, false), 1229);
        assert_eq!(fit_target_mib(8.0, false), 1024);
    }

    #[test]
    fn prompt_cache_is_clamped_between_1g_and_16g() {
        assert_eq!(prompt_cache_mib(Some(16 * GIB), 64 * GIB), 16_384);
        assert_eq!(prompt_cache_mib(Some(16 * GIB), 32 * GIB), 5120);
        assert_eq!(prompt_cache_mib(Some(16 * GIB), 16 * GIB), 1024);
    }

    #[test]
    fn a_draft_is_dropped_when_it_would_crowd_a_dense_model_off_the_card() {
        let model = Some(7 * GIB);
        let draft = Some(GIB);
        assert!(draft_fits(model, draft, 12.0, false));
        assert!(!draft_fits(model, draft, 8.0, false));
        assert!(draft_fits(model, draft, 8.0, true));
        assert!(draft_fits(model, draft, 0.0, false));
    }

    #[test]
    fn threads_come_from_the_topology_unless_asked() {
        let topology = CpuTopology {
            logical: 16,
            physical: 8,
            performance: 6,
        };
        assert_eq!(thread_counts(None, &topology), (6, 8));
        assert_eq!(thread_counts(Some(12), &topology), (12, 12));
        assert_eq!(thread_counts(Some(0), &topology), (6, 8));
    }

    #[test]
    fn a_bigger_window_serves_a_smaller_automatic_request() {
        assert!(serves_window(32_768, 8192, false));
        assert!(!serves_window(32_768, 8192, true));
        assert!(!serves_window(8192, 32_768, false));
    }

    #[test]
    fn a_caller_that_names_no_window_keeps_the_running_one() {
        assert_eq!(requested_context(None, None, Some(32_768)), 32_768);
        assert_eq!(requested_context(Some(4096), None, Some(32_768)), 4096);
        assert_eq!(requested_context(None, None, None), DEFAULT_CONTEXT);
    }

    #[test]
    fn the_load_wait_scales_with_the_file() {
        assert_eq!(ready_timeout_ms(None), 90_000);
        assert_eq!(ready_timeout_ms(Some(0)), 30_000);
        assert_eq!(ready_timeout_ms(Some(5 * GIB)), 100_000);
        assert_eq!(ready_timeout_ms(Some(40 * GIB)), 180_000);
    }

    #[test]
    fn overrides_replace_other_case_twins() {
        let inherited = vec![
            ("Path".to_owned(), "/bin".to_owned()),
            ("HOME".to_owned(), "/h".to_owned()),
        ];
        let overrides = vec![("PATH".to_owned(), "/engine".to_owned())];
        assert_eq!(
            build_env(&inherited, &overrides),
            vec![
                ("HOME".to_owned(), "/h".to_owned()),
                ("PATH".to_owned(), "/engine".to_owned())
            ]
        );
    }

    #[test]
    fn expert_streaming_passes_only_what_the_build_lists() {
        let stream = MoeStream {
            cache_gb: 38.6,
            io_threads: Some(6),
            direct: true,
            vram_slots: 12.9,
        };
        let all = |flag: &str| {
            [
                "--moe-stream-cache",
                "--moe-stream-io-threads",
                "--moe-stream-direct",
                "--moe-expert-cache",
            ]
            .contains(&flag)
        };
        assert_eq!(
            moe_stream_args(&all, Some(&stream)),
            vec![
                "--moe-stream-cache",
                "38G",
                "--moe-stream-io-threads",
                "6",
                "--moe-stream-direct",
                "--moe-expert-cache",
                "12",
            ]
        );
        let none = |_: &str| false;
        assert!(moe_stream_args(&none, Some(&stream)).is_empty());
        assert!(moe_stream_args(&all, None).is_empty());
    }

    fn launch_input<'a>(traits: &'a ModelTraits) -> LaunchInput<'a> {
        LaunchInput {
            model: "m.gguf",
            model_bytes: None,
            traits,
            context: 8192,
            exact_context: false,
            vram_gb: 0.0,
            windows: false,
            runner: None,
            port: 11435,
            gpu_layers: None,
            requested_threads: None,
            topology: CpuTopology {
                logical: 8,
                physical: 4,
                performance: 4,
            },
            total_ram_bytes: 64 * GIB,
            speculative: true,
            draft: None,
            moe_stream: None,
            projector: None,
        }
    }

    #[test]
    fn a_fixed_layer_count_switches_off_fit_and_a_bare_build_gets_only_base_flags() {
        let traits = ModelTraits::default();
        let mut input = launch_input(&traits);
        input.vram_gb = 12.0;
        let base = plan_launch(&input, &|_| false);
        assert!(!base.args.contains(&"-ngl".to_owned()));
        assert!(base.args.contains(&"--jinja".to_owned()));
        assert_eq!(base.speculation, Speculation::Off);
        assert_eq!(base.fit_target, None);

        input.gpu_layers = Some(20);
        let forced = plan_launch(&input, &|flag| flag == "--fit-target");
        let layers = forced
            .args
            .iter()
            .position(|a| a == "-ngl")
            .map(|i| forced.args[i + 1].as_str());
        assert_eq!(layers, Some("20"));
        assert!(!forced.args.contains(&"--fit-target".to_owned()));
    }

    #[test]
    fn speculation_prefers_a_draft_then_mtp_then_ngrams() {
        let traits = ModelTraits::default();
        let mut input = launch_input(&traits);
        input.draft = Some(DraftCandidate {
            path: "m-draft.gguf",
            bytes: None,
            max: None,
        });
        let all = |_: &str| true;
        let drafted = plan_launch(&input, &all);
        assert_eq!(drafted.speculation, Speculation::Draft);
        assert!(drafted.draft_in_use);
        let at = |flag: &str| {
            drafted
                .args
                .iter()
                .position(|a| a == flag)
                .map(|i| drafted.args[i + 1].clone())
        };
        assert_eq!(at("--model-draft").as_deref(), Some("m-draft.gguf"));
        assert_eq!(at("--draft-max").as_deref(), Some("8"));
        assert_eq!(at("-ngld").as_deref(), Some("99"));

        let mtp_traits = ModelTraits {
            mtp: true,
            ..ModelTraits::default()
        };
        let mut mtp_input = launch_input(&mtp_traits);
        mtp_input.draft = None;
        let mtp = plan_launch(&mtp_input, &all);
        assert_eq!(mtp.speculation, Speculation::Mtp);
        assert!(mtp.args.contains(&"draft-mtp".to_owned()));

        let ngram = plan_launch(&launch_input(&traits), &|flag| flag == "--spec-default");
        assert_eq!(ngram.speculation, Speculation::Ngram);
    }

    #[test]
    fn a_draft_that_crowds_the_card_is_dropped_and_reported() {
        let traits = ModelTraits::default();
        let mut input = launch_input(&traits);
        input.model_bytes = Some(7 * GIB);
        input.vram_gb = 8.0;
        input.draft = Some(DraftCandidate {
            path: "m-draft.gguf",
            bytes: Some(GIB),
            max: Some(12),
        });
        let plan = plan_launch(&input, &|flag| flag == "--model-draft");
        assert!(plan.draft_dropped_for_fit);
        assert_eq!(plan.speculation, Speculation::Off);
        assert!(!plan.args.contains(&"--model-draft".to_owned()));
    }

    #[test]
    fn cpu_runs_pin_their_threads_when_the_build_can() {
        let traits = ModelTraits::default();
        let mut input = launch_input(&traits);
        input.runner = Some("cpu");
        let plan = plan_launch(&input, &|flag| {
            flag == "--cpu-range" || flag == "--cpu-strict"
        });
        let at = |flag: &str| {
            plan.args
                .iter()
                .position(|a| a == flag)
                .map(|i| plan.args[i + 1].clone())
        };
        assert_eq!(at("--cpu-strict").as_deref(), Some("1"));
        assert_eq!(at("--cpu-range").as_deref(), Some("0-3"));
    }

    #[test]
    fn a_projector_goes_last() {
        let traits = ModelTraits::default();
        let mut input = launch_input(&traits);
        input.projector = Some("m-mmproj.gguf");
        let plan = plan_launch(&input, &|_| false);
        assert_eq!(
            plan.args[plan.args.len() - 2..],
            ["--mmproj", "m-mmproj.gguf"]
        );
    }
}
