//! The image engine's pure rules: smoke-test verdicts, archive entry safety, memory placement, request sizing.
//! Port of the pure parts of electron/sdServer.cjs and sdBinaryManager.cjs; the process and download half follows.

use draggy_engine::platform::{Arch, Os};
use draggy_engine::sd_runner::default_runner;
use serde_json::{Value, json};

pub const MAX_PROMPT: usize = 4000;
pub const MAX_STEPS: i64 = 150;

/// A failure the renderer can name by its code. The message is the app's own text, never the engine's.
#[derive(Debug, Clone, PartialEq)]
pub struct SdError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmokeFailure {
    Timeout,
    MissingLibrary,
    UnsupportedCpu,
    MissingBinary,
    Failed,
}

/// The verdict of `sd-server --version`. Exit 0 with printed output is the only pass.
pub fn classify_smoke(
    exit: Option<u32>,
    timed_out: bool,
    missing: bool,
    stdout: &str,
) -> Result<(), SmokeFailure> {
    if exit == Some(0) && !timed_out && !missing && !stdout.trim().is_empty() {
        return Ok(());
    }
    if timed_out {
        return Err(SmokeFailure::Timeout);
    }
    match exit {
        Some(0xc000_0135) => Err(SmokeFailure::MissingLibrary),
        Some(0xc000_001d) => Err(SmokeFailure::UnsupportedCpu),
        _ if missing => Err(SmokeFailure::MissingBinary),
        _ => Err(SmokeFailure::Failed),
    }
}

/// Archive entries that would land outside the folder they unpack into.
pub fn unsafe_entries(entries: &[&str]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| {
            let name = entry.replace('\\', "/");
            let bad = !name.is_empty()
                && (name.starts_with('/')
                    || has_drive(&name)
                    || name.split('/').any(|part| part == ".."));
            bad.then_some(name)
        })
        .collect()
}

fn has_drive(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// The runner to try first here, from core's archive table. ROCm is never picked automatically.
pub fn preferred_runner(os: Os, arch: Arch, vram_gb: f64, nvidia: bool) -> Option<&'static str> {
    default_runner(os, arch, vram_gb, nvidia, false)
}

/// What the machine has free right now, in GB. `None` VRAM means it is not measured.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Memory {
    pub free_vram_gb: Option<f64>,
    pub total_vram_gb: f64,
    pub loaded_llm_gb: f64,
    pub unified: bool,
    pub free_ram_gb: f64,
    pub total_ram_gb: f64,
    pub runner: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    Fail,
    Gpu,
    UnloadChat,
    Offload,
}

/// Where a job runs: the GPU, the GPU once the chat model steps aside, weights in RAM, or nowhere.
pub fn plan_memory(need_gb: f64, m: &Memory) -> Placement {
    let need = need_gb.max(0.5);
    if m.runner == "cpu" || m.unified {
        let total_mem = if m.total_ram_gb > 0.0 {
            m.total_ram_gb
        } else {
            m.free_ram_gb
        };
        if total_mem > 0.0 && total_mem < need {
            return Placement::Fail;
        }
        if m.free_ram_gb >= need {
            return Placement::Gpu;
        }
        if m.loaded_llm_gb > 0.0 {
            return Placement::UnloadChat;
        }
        return if m.total_ram_gb >= need || m.free_ram_gb >= need {
            Placement::Gpu
        } else {
            Placement::Fail
        };
    }

    let ram = if m.total_ram_gb > 0.0 {
        m.total_ram_gb
    } else {
        m.free_ram_gb
    };
    let total_system = m.total_vram_gb.max(0.0) + ram;
    if total_system > 0.0 && total_system < need {
        return Placement::Fail;
    }
    let free = match m.free_vram_gb {
        Some(free) => Some(free),
        None if m.total_vram_gb > 0.0 => Some(m.total_vram_gb - m.loaded_llm_gb - 0.5),
        None => None,
    };
    match free {
        // Unknown VRAM: sd-server's own auto-fit measures it, so the job goes ahead.
        None => Placement::Gpu,
        Some(free) if free >= need => Placement::Gpu,
        _ if m.loaded_llm_gb > 0.0 => Placement::UnloadChat,
        _ => Placement::Offload,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limits {
    pub min_width: f64,
    pub max_width: f64,
    pub min_height: f64,
    pub max_height: f64,
}

pub const FALLBACK_LIMITS: Limits = Limits {
    min_width: 64.0,
    max_width: 2048.0,
    min_height: 64.0,
    max_height: 2048.0,
};

/// A model's own defaults from the catalogue. Zero or absent means the app's fallback.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Defaults {
    pub width: f64,
    pub height: f64,
    pub steps: i64,
    pub cfg_scale: Option<f64>,
    pub max_side: Option<f64>,
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            width: 512.0,
            height: 512.0,
            steps: 20,
            cfg_scale: None,
            max_side: None,
        }
    }
}

/// A request after the engine's limits are applied: sizes in multiples of 64, every value in range.
#[derive(Debug, Clone, PartialEq)]
pub struct Clamped {
    pub prompt: String,
    pub negative_prompt: String,
    pub width: i64,
    pub height: i64,
    pub steps: i64,
    pub cfg_scale: f64,
    pub seed: i64,
    pub init_image: Option<String>,
    pub reference_mode: Option<String>,
    pub reference_dropped: bool,
    pub strength: f64,
    pub lora: Vec<Value>,
    pub hires: bool,
    pub output_format: &'static str,
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

fn positive_or(value: &Value, fallback: f64) -> f64 {
    number(value).filter(|n| *n > 0.0).unwrap_or(fallback)
}

fn integer(value: &Value) -> Option<i64> {
    number(value).filter(|n| n.fract() == 0.0).map(|n| n as i64)
}

/// Rounds to a multiple of 64, then keeps it inside the engine's limits.
fn snap(raw: f64, min: f64, max: f64) -> i64 {
    let rounded = (raw / 64.0).round() * 64.0;
    let low = (min / 64.0).ceil() * 64.0;
    let high = (max / 64.0).floor() * 64.0;
    high.min(low.max(rounded)) as i64
}

fn bounded_text(value: &Value, limit: usize) -> String {
    value.as_str().unwrap_or("").chars().take(limit).collect()
}

/// Sizes a request the way the engine accepts them. A reference mode of None draws from the text alone.
pub fn clamp_request(
    request: &Value,
    limits: Limits,
    defaults: Defaults,
    reference_mode: Option<&str>,
) -> Result<Clamped, SdError> {
    let get = |key: &str| request.get(key).unwrap_or(&Value::Null);
    let prompt = bounded_text(get("prompt"), MAX_PROMPT).trim().to_owned();
    if prompt.is_empty() {
        return Err(SdError {
            code: "E_PROMPT",
            message: "An image needs a description".into(),
        });
    }

    let base_width = if defaults.width > 0.0 {
        defaults.width
    } else {
        512.0
    };
    let base_height = if defaults.height > 0.0 {
        defaults.height
    } else {
        512.0
    };
    let mut width = positive_or(get("width"), base_width);
    let mut height = positive_or(get("height"), base_height);
    // A size the chat model picked is scaled to what the image model was trained on.
    let fit = get("fitModel").as_bool() == Some(true);
    if let Some(max_side) = defaults
        .max_side
        .filter(|m| fit && *m > 0.0 && width.max(height) > *m)
    {
        let scale = max_side / width.max(height);
        width = ((width * scale) / 64.0).floor() * 64.0;
        height = ((height * scale) / 64.0).floor() * 64.0;
    }

    let fallback_steps = if defaults.steps > 0 {
        defaults.steps
    } else {
        20
    };
    let steps = integer(get("steps"))
        .unwrap_or(fallback_steps)
        .clamp(1, MAX_STEPS);
    let cfg_scale = match number(get("cfgScale")) {
        Some(value) => value.clamp(0.0, 30.0),
        None => defaults.cfg_scale.unwrap_or(7.0),
    };
    let seed = integer(get("seed")).filter(|s| *s >= 0).unwrap_or(-1);
    let strength = number(get("strength")).map_or(0.75, |s| s.clamp(0.0, 1.0));

    let mode = reference_mode.filter(|m| !m.is_empty());
    let given = get("initImage").as_str().filter(|s| !s.is_empty());
    let lora = get("lora")
        .as_array()
        .map(|entries| entries.iter().take(4).cloned().collect())
        .unwrap_or_default();

    Ok(Clamped {
        prompt,
        negative_prompt: bounded_text(get("negativePrompt"), MAX_PROMPT),
        width: snap(width, limits.min_width, limits.max_width),
        height: snap(height, limits.min_height, limits.max_height),
        steps,
        cfg_scale,
        seed,
        init_image: mode.and(given).map(str::to_owned),
        reference_mode: mode.map(str::to_owned),
        reference_dropped: mode.is_none() && given.is_some(),
        strength,
        lora,
        hires: get("hires").as_bool() == Some(true),
        output_format: match get("outputFormat").as_str() {
            Some("jpeg") => "jpeg",
            Some("webp") => "webp",
            _ => "png",
        },
    })
}

/// The native job request. Only the fields the pinned server documents are sent.
pub fn build_job_body(clamped: &Clamped) -> Value {
    let lora: Vec<Value> = clamped
        .lora
        .iter()
        .map(|entry| {
            json!({
                "path": entry.get("path").cloned().unwrap_or(Value::Null),
                "multiplier": entry.get("multiplier").and_then(Value::as_f64).unwrap_or(1.0),
                "is_high_noise": false,
            })
        })
        .collect();
    let mut body = json!({
        "prompt": clamped.prompt,
        "negative_prompt": clamped.negative_prompt,
        "width": clamped.width,
        "height": clamped.height,
        "seed": clamped.seed,
        "batch_count": 1,
        "strength": clamped.strength,
        "lora": lora,
        "hires": { "enabled": clamped.hires, "upscaler": "Latent", "scale": 2 },
        "sample_params": {
            "sample_steps": clamped.steps,
            "guidance": { "txt_cfg": clamped.cfg_scale },
        },
        "output_format": clamped.output_format,
    });
    // An edit model is shown the original as a reference; any other model starts from it, noised by `strength`.
    if clamped.reference_mode.as_deref() == Some("edit") {
        let refs: Vec<Value> = clamped.init_image.iter().map(|s| json!(s)).collect();
        body["ref_images"] = Value::Array(refs);
    } else {
        body["init_image"] = clamped
            .init_image
            .as_ref()
            .map_or(Value::Null, |s| json!(s));
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_passes_only_on_exit_zero_with_output() {
        assert_eq!(classify_smoke(Some(0), false, false, "sd 1.0\n"), Ok(()));
        assert_eq!(
            classify_smoke(Some(0), false, false, "  \n"),
            Err(SmokeFailure::Failed)
        );
    }

    #[test]
    fn smoke_names_the_failure_kind() {
        assert_eq!(
            classify_smoke(None, true, false, ""),
            Err(SmokeFailure::Timeout)
        );
        assert_eq!(
            classify_smoke(Some(0xc000_0135), false, false, ""),
            Err(SmokeFailure::MissingLibrary)
        );
        assert_eq!(
            classify_smoke(Some(0xc000_001d), false, false, ""),
            Err(SmokeFailure::UnsupportedCpu)
        );
        assert_eq!(
            classify_smoke(None, false, true, ""),
            Err(SmokeFailure::MissingBinary)
        );
        assert_eq!(
            classify_smoke(Some(3), false, false, "x"),
            Err(SmokeFailure::Failed)
        );
    }

    #[test]
    fn archive_entries_outside_the_folder_are_refused() {
        let bad = unsafe_entries(&["../evil.dll", "/abs/x", "C:/x", "a\\..\\b", "ok/sd.exe"]);
        assert_eq!(bad, vec!["../evil.dll", "/abs/x", "C:/x", "a/../b"]);
    }

    #[test]
    fn preferred_runner_follows_the_gpu() {
        assert_eq!(
            preferred_runner(Os::Windows, Arch::X64, 8.0, true),
            Some("cuda")
        );
        assert_eq!(
            preferred_runner(Os::Windows, Arch::X64, 4.0, false),
            Some("vulkan")
        );
        assert_eq!(
            preferred_runner(Os::Windows, Arch::X64, 0.0, false),
            Some("cpu")
        );
    }

    #[test]
    fn memory_fits_the_gpu_when_free_vram_is_enough() {
        let m = Memory {
            free_vram_gb: Some(10.0),
            total_vram_gb: 12.0,
            total_ram_gb: 32.0,
            runner: "cuda".into(),
            ..Default::default()
        };
        assert_eq!(plan_memory(6.0, &m), Placement::Gpu);
    }

    #[test]
    fn memory_steps_the_chat_model_aside_then_offloads() {
        let busy = Memory {
            free_vram_gb: Some(2.0),
            total_vram_gb: 12.0,
            loaded_llm_gb: 5.0,
            total_ram_gb: 32.0,
            runner: "cuda".into(),
            ..Default::default()
        };
        assert_eq!(plan_memory(6.0, &busy), Placement::UnloadChat);
        let empty = Memory {
            free_vram_gb: Some(2.0),
            total_vram_gb: 12.0,
            total_ram_gb: 32.0,
            runner: "cuda".into(),
            ..Default::default()
        };
        assert_eq!(plan_memory(6.0, &empty), Placement::Offload);
    }

    #[test]
    fn memory_fails_when_the_machine_is_too_small() {
        let tiny = Memory {
            free_vram_gb: Some(1.0),
            total_vram_gb: 2.0,
            total_ram_gb: 3.0,
            runner: "cuda".into(),
            ..Default::default()
        };
        assert_eq!(plan_memory(16.0, &tiny), Placement::Fail);
        let cpu = Memory {
            free_ram_gb: 4.0,
            total_ram_gb: 8.0,
            runner: "cpu".into(),
            ..Default::default()
        };
        assert_eq!(plan_memory(6.0, &cpu), Placement::Gpu);
    }

    #[test]
    fn sizes_snap_to_multiples_of_64_inside_limits() {
        let r = clamp_request(
            &json!({ "prompt": "a cat", "width": 1000, "height": 10 }),
            FALLBACK_LIMITS,
            Defaults::default(),
            Some("img2img"),
        )
        .unwrap();
        assert_eq!((r.width, r.height), (1024, 64));
    }

    #[test]
    fn empty_prompt_is_refused_with_its_code() {
        let err = clamp_request(
            &json!({ "prompt": "   " }),
            FALLBACK_LIMITS,
            Defaults::default(),
            None,
        )
        .unwrap_err();
        assert_eq!(
            err,
            SdError {
                code: "E_PROMPT",
                message: "An image needs a description".into()
            }
        );
    }

    #[test]
    fn steps_strength_and_cfg_are_bounded() {
        let r = clamp_request(
            &json!({ "prompt": "x", "steps": 500, "cfgScale": 99, "strength": 3 }),
            FALLBACK_LIMITS,
            Defaults::default(),
            None,
        )
        .unwrap();
        assert_eq!((r.steps, r.cfg_scale, r.strength), (150, 30.0, 1.0));
        let d = clamp_request(
            &json!({ "prompt": "x" }),
            FALLBACK_LIMITS,
            Defaults::default(),
            None,
        )
        .unwrap();
        assert_eq!(
            (d.steps, d.cfg_scale, d.strength, d.seed),
            (20, 7.0, 0.75, -1)
        );
    }

    #[test]
    fn fit_model_scales_an_oversized_request() {
        let defaults = Defaults {
            max_side: Some(768.0),
            ..Defaults::default()
        };
        let r = clamp_request(
            &json!({ "prompt": "x", "width": 1024, "height": 1024, "fitModel": true }),
            FALLBACK_LIMITS,
            defaults,
            None,
        )
        .unwrap();
        assert_eq!((r.width, r.height), (768, 768));
    }

    #[test]
    fn a_reference_is_dropped_when_the_model_has_no_mode() {
        let r = clamp_request(
            &json!({ "prompt": "x", "initImage": "data:image/png;base64,AA" }),
            FALLBACK_LIMITS,
            Defaults::default(),
            None,
        )
        .unwrap();
        assert!(r.reference_dropped);
        assert_eq!(r.init_image, None);
        let kept = clamp_request(
            &json!({ "prompt": "x", "initImage": "data:image/png;base64,AA" }),
            FALLBACK_LIMITS,
            Defaults::default(),
            Some("img2img"),
        )
        .unwrap();
        assert!(!kept.reference_dropped);
        assert_eq!(kept.init_image.as_deref(), Some("data:image/png;base64,AA"));
    }

    #[test]
    fn job_body_sends_the_reference_as_init_or_ref_images() {
        let img = json!({ "prompt": "x", "initImage": "IMG" });
        let edit = clamp_request(&img, FALLBACK_LIMITS, Defaults::default(), Some("edit")).unwrap();
        let body = build_job_body(&edit);
        assert_eq!(body["ref_images"], json!(["IMG"]));
        assert!(body.get("init_image").is_none());

        let plain =
            clamp_request(&img, FALLBACK_LIMITS, Defaults::default(), Some("img2img")).unwrap();
        let body = build_job_body(&plain);
        assert_eq!(body["init_image"], json!("IMG"));
        assert_eq!(body["sample_params"]["sample_steps"], json!(20));
        assert_eq!(body["hires"]["upscaler"], json!("Latent"));
    }
}
