//! The image engine's pure rules: smoke-test verdicts, archive entry safety, memory placement, request sizing.
//! Port of the pure parts of electron/sdServer.cjs and sdBinaryManager.cjs; the process and download half follows.

use crate::engines::image_models::requests;
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

/// The route that answers 200 once the weights are loaded.
pub const READY_PATH: &str = "/sdcpp/v1/capabilities";

/// Where a request's starting picture comes from.
#[derive(Debug, Clone, PartialEq)]
pub enum Init {
    None,
    /// A picture sent inline as a data URL.
    Data(String),
    /// A picture in the created-files folder, by the path the chat stored.
    Created(String),
    /// A picture in a project, by the path inside it.
    Project(String),
}

/// Where the finished picture goes: the chat, or a path in a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Destination {
    Chat,
    Project(String),
}

/// Whether a path ends in an extension an image can be saved as.
pub fn output_extension_ok(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

/// A checked `sd:generate` request: the engine input before LoRA and picture lookups.
#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub request_id: String,
    pub model: String,
    pub loras: Vec<(String, f64)>,
    pub init: Init,
    pub destination: Destination,
    pub input: Value,
}

fn refuse(message: impl Into<String>) -> SdError {
    SdError {
        code: "E_REQUEST",
        message: message.into(),
    }
}

fn is_image_data_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    url.len() <= requests::MAX_INIT_IMAGE_CHARS
        && ["png", "jpg", "jpeg", "webp", "bmp", "gif"]
            .iter()
            .any(|kind| lower.starts_with(&format!("data:image/{kind};base64,")))
}

/// A number clamped to [min, max], or null when it is not a finite number.
fn bounded(raw: Option<&Value>, min: f64, max: f64) -> Value {
    raw.and_then(number)
        .map_or(Value::Null, |n| json!(n.clamp(min, max)))
}

/// Checks a request the way the Electron side does. Refusals carry the app's own text and the E_REQUEST code.
pub fn parse_request(raw: &Value) -> Result<Parsed, SdError> {
    let text = |key: &str| {
        raw.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    let request_id = text("requestId");
    let id_ok = !request_id.is_empty()
        && request_id.len() <= 64
        && request_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !id_ok {
        return Err(refuse("A request needs an id"));
    }
    let prompt = text("prompt");
    if prompt.is_empty() {
        return Err(refuse("An image needs a description"));
    }
    if prompt.chars().count() > MAX_PROMPT {
        return Err(refuse(format!(
            "The description is longer than {MAX_PROMPT} characters"
        )));
    }

    let mut loras = Vec::new();
    for item in raw
        .get("lora")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(4)
    {
        let entry = item
            .as_str()
            .map_or_else(|| item.to_string(), str::to_owned);
        let lora = requests::parse_lora(&entry).ok_or_else(|| {
            refuse(format!(
                "Not a LoRA name: {}",
                entry.chars().take(80).collect::<String>()
            ))
        })?;
        loras.push((lora.name, lora.multiplier));
    }

    let init = match raw.get("init").filter(|v| v.is_object()) {
        None => Init::None,
        Some(init) => match init.get("kind").and_then(Value::as_str) {
            Some("attachment") => {
                let url = init.get("dataUrl").and_then(Value::as_str).unwrap_or("");
                if !is_image_data_url(url) {
                    return Err(refuse("The starting image is not a usable picture"));
                }
                Init::Data(url.to_owned())
            }
            Some("created") => {
                let path = init
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if path.is_empty() {
                    return Err(refuse("The starting image needs a path"));
                }
                Init::Created(path.to_owned())
            }
            Some("project") => {
                let path = init
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if path.is_empty() {
                    return Err(refuse("The starting image needs a path"));
                }
                Init::Project(path.to_owned())
            }
            _ => return Err(refuse("Unknown starting image")),
        },
    };
    let destination = match raw.get("destination").filter(|d| d.is_object()) {
        Some(dest) if dest.get("kind").and_then(Value::as_str) == Some("project") => {
            let path = dest
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if path.is_empty() {
                return Err(refuse("Saving into a project needs a path"));
            }
            if !output_extension_ok(path) {
                return Err(refuse("An image can only be saved as .png, .jpg or .webp"));
            }
            Destination::Project(path.to_owned())
        }
        _ => Destination::Chat,
    };

    let flag = |key: &str| raw.get(key).and_then(Value::as_bool) == Some(true);
    let seed = match raw.get("seed").and_then(number) {
        Some(n) if n.fract() == 0.0 && n >= 0.0 => json!(n),
        _ => json!(-1),
    };
    let negative: String = raw
        .get("negativePrompt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(MAX_PROMPT)
        .collect();
    let input = json!({
        "prompt": prompt,
        "negativePrompt": negative,
        "width": bounded(raw.get("width"), 64.0, 2048.0),
        "height": bounded(raw.get("height"), 64.0, 2048.0),
        "steps": bounded(raw.get("steps"), 1.0, 150.0),
        "cfgScale": bounded(raw.get("cfgScale"), 0.0, 30.0),
        "seed": seed,
        "strength": bounded(raw.get("strength"), 0.0, 1.0),
        "hires": flag("hires"),
        "fitModel": flag("fitModel"),
        "outputFormat": "png",
    });
    Ok(Parsed {
        request_id,
        model: raw
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(300)
            .collect(),
        loras,
        init,
        destination,
        input,
    })
}

/// A `WIDTHxHEIGHT` setting with 2 to 4 digits a side, or None.
pub fn parse_resolution(raw: &Value) -> Option<(i64, i64)> {
    let text = match raw {
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let (w, h) = text.split_once('x')?;
    let side = |s: &str| (2..=4).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    if !(side(w) && side(h)) {
        return None;
    }
    Some((w.parse().ok()?, h.parse().ok()?))
}

/// `YYYY-MM-DD-HHMMSS` in UTC for a Unix time in seconds, the stamp picture file names start with.
pub fn stamp_of(unix_secs: i64) -> String {
    let days = unix_secs.div_euclid(86_400);
    let secs = unix_secs.rem_euclid(86_400);
    // Civil date from a day count since 1970-01-01 (proleptic Gregorian).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}-{:02}{:02}{:02}",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60
    )
}

/// The MIME type of a starting picture by its file name, for the picture formats the engine reads.
pub fn created_mime(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    [
        (".png", "image/png"),
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".webp", "image/webp"),
    ]
    .iter()
    .find(|(ext, _)| lower.ends_with(ext))
    .map(|(_, mime)| *mime)
}

/// The model to draw with: the chosen one when installed, otherwise the first installed, otherwise "".
pub fn chosen_model(listed: &[Value], wanted: &str) -> String {
    let installed = |entry: &&Value| entry["installed"] == Value::Bool(true);
    if listed
        .iter()
        .filter(installed)
        .any(|entry| entry["id"].as_str() == Some(wanted))
    {
        return wanted.to_owned();
    }
    listed
        .iter()
        .find(installed)
        .and_then(|entry| entry["id"].as_str())
        .unwrap_or("")
        .to_owned()
}

/// The `sd:status` server block: whether a process runs, its model, and the queue.
pub fn server_status(running: bool, model: Option<&str>, pending: usize) -> Value {
    json!({
        "running": running,
        "model": if running { model.map_or(Value::Null, |m| json!(m)) } else { Value::Null },
        "busy": pending > 0,
        "queued": pending.saturating_sub(1),
    })
}

/// How long a model may take to load, from its size in GB: 30 s a GB, between one and ten minutes.
pub fn load_deadline_ms(size_gb: f64) -> u64 {
    (size_gb.ceil() * 30_000.0).clamp(60_000.0, 600_000.0) as u64
}

/// The engine's advertised size limits, with the app's fallbacks for anything it does not state.
pub fn limits_from(capabilities: &Value) -> Limits {
    let limits = capabilities.get("limits");
    let read = |key: &str, fallback: f64| {
        limits
            .and_then(|l| l.get(key))
            .and_then(number)
            .unwrap_or(fallback)
    };
    Limits {
        min_width: read("min_width", FALLBACK_LIMITS.min_width),
        max_width: read("max_width", FALLBACK_LIMITS.max_width),
        min_height: read("min_height", FALLBACK_LIMITS.min_height),
        max_height: read("max_height", FALLBACK_LIMITS.max_height),
    }
}

/// The installed runner names, sorted, with the preferred one first.
pub fn order_runners(mut names: Vec<String>, preferred: Option<&str>) -> Vec<String> {
    names.sort();
    if let Some(first) = preferred.and_then(|p| names.iter().position(|n| n == p)) {
        let chosen = names.remove(first);
        names.insert(0, chosen);
    }
    names
}

/// The binary's file name on this OS.
pub fn server_name(windows: bool) -> &'static str {
    if windows {
        "sd-server.exe"
    } else {
        "sd-server"
    }
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

#[cfg(test)]
mod port_tests {
    use super::*;

    #[test]
    fn stamp_is_utc_and_zero_padded() {
        assert_eq!(stamp_of(0), "1970-01-01-000000");
        assert_eq!(stamp_of(1_767_225_600 + 3723), "2026-01-01-010203");
    }

    #[test]
    fn resolution_needs_two_to_four_digits_a_side() {
        assert_eq!(parse_resolution(&json!("512x768")), Some((512, 768)));
        assert_eq!(parse_resolution(&json!("5x768")), None);
        assert_eq!(parse_resolution(&json!("512X768")), None);
        assert_eq!(parse_resolution(&json!("12345x768")), None);
        assert_eq!(parse_resolution(&json!(512)), None);
    }

    #[test]
    fn created_pictures_by_extension() {
        assert_eq!(created_mime("a.PNG"), Some("image/png"));
        assert_eq!(created_mime("a.jpeg"), Some("image/jpeg"));
        assert_eq!(created_mime("a.gif"), None);
    }

    #[test]
    fn chosen_model_prefers_wanted_then_first_installed() {
        let listed = vec![
            json!({"id": "a", "installed": true}),
            json!({"id": "b", "installed": true}),
            json!({"id": "c", "installed": false}),
        ];
        assert_eq!(chosen_model(&listed, "b"), "b");
        assert_eq!(chosen_model(&listed, "c"), "a");
        assert_eq!(chosen_model(&listed, "z"), "a");
        assert_eq!(chosen_model(&[], "a"), "");
    }

    #[test]
    fn status_hides_model_when_not_running() {
        let idle = server_status(false, Some("m"), 0);
        assert_eq!(idle["running"], json!(false));
        assert_eq!(idle["model"], Value::Null);
        let busy = server_status(true, Some("m"), 3);
        assert_eq!(busy["model"], json!("m"));
        assert_eq!(busy["busy"], json!(true));
        assert_eq!(busy["queued"], json!(2));
    }

    #[test]
    fn load_deadline_is_thirty_seconds_a_gb_within_bounds() {
        assert_eq!(load_deadline_ms(0.1), 60_000);
        assert_eq!(load_deadline_ms(5.0), 150_000);
        assert_eq!(load_deadline_ms(50.0), 600_000);
    }

    #[test]
    fn limits_read_the_engine_and_fall_back() {
        let limits = limits_from(&json!({"limits": {"max_width": 1024}}));
        assert_eq!(limits.max_width, 1024.0);
        assert_eq!(limits.max_height, FALLBACK_LIMITS.max_height);
        assert_eq!(limits_from(&Value::Null), FALLBACK_LIMITS);
    }

    #[test]
    fn runners_sorted_with_preferred_first() {
        let names = vec!["vulkan".to_owned(), "cpu".to_owned(), "cuda".to_owned()];
        assert_eq!(
            order_runners(names.clone(), Some("cuda")),
            ["cuda", "cpu", "vulkan"]
        );
        assert_eq!(order_runners(names, None), ["cpu", "cuda", "vulkan"]);
    }

    #[test]
    fn server_file_name_by_os() {
        assert_eq!(server_name(true), "sd-server.exe");
        assert_eq!(server_name(false), "sd-server");
    }

    #[test]
    fn request_needs_id_and_description() {
        let no_id = parse_request(&json!({"prompt": "x"})).unwrap_err();
        assert_eq!(no_id.code, "E_REQUEST");
        assert_eq!(no_id.message, "A request needs an id");
        let no_prompt = parse_request(&json!({"requestId": "r1", "prompt": "  "})).unwrap_err();
        assert_eq!(no_prompt.message, "An image needs a description");
        let long = "x".repeat(MAX_PROMPT + 1);
        let too_long = parse_request(&json!({"requestId": "r1", "prompt": long})).unwrap_err();
        assert_eq!(
            too_long.message,
            format!("The description is longer than {MAX_PROMPT} characters")
        );
    }

    #[test]
    fn request_refuses_unusable_starting_pictures_and_projects() {
        let svg = json!({"requestId": "r1", "prompt": "x",
            "init": {"kind": "attachment", "dataUrl": "data:image/svg+xml;base64,AA"}});
        assert_eq!(
            parse_request(&svg).unwrap_err().message,
            "The starting image is not a usable picture"
        );
        let unknown = json!({"requestId": "r1", "prompt": "x", "init": {"kind": "web"}});
        assert_eq!(
            parse_request(&unknown).unwrap_err().message,
            "Unknown starting image"
        );
        let project = json!({"requestId": "r1", "prompt": "x", "destination": {"kind": "project"}});
        assert!(parse_request(&project).is_err());
    }

    #[test]
    fn request_keeps_valid_fields_and_resets_bad_seed() {
        let parsed = parse_request(&json!({
            "requestId": "r1",
            "prompt": "  a fox  ",
            "seed": -5,
            "width": 9000,
        }))
        .unwrap();
        assert_eq!(parsed.request_id, "r1");
        assert_eq!(parsed.input["prompt"], json!("a fox"));
        assert_eq!(parsed.input["seed"], json!(-1));
        assert_eq!(parsed.input["width"], json!(2048.0));
        assert_eq!(parsed.init, Init::None);
    }
}

/// The placement once a chat model has stepped aside: the GPU when the card can take it, else weights in RAM.
pub fn placement_after_unload(need_gb: f64, total_vram_gb: f64, free_after_gb: f64) -> Placement {
    if total_vram_gb >= need_gb + 3.0 || free_after_gb >= need_gb + 3.0 {
        Placement::Gpu
    } else {
        Placement::Offload
    }
}

/// The engine flags a job's placement adds. Offload tiles the decode; a crash retry also runs lean attention
/// and weights in RAM so a driver or memory fault has less to hit.
pub fn engine_flags(offload: bool, safe: bool) -> Vec<&'static str> {
    let mut flags = Vec::new();
    if offload || safe {
        flags.push("--vae-tiling");
    }
    if safe {
        flags.extend(["--diffusion-fa", "--offload-to-cpu"]);
    }
    flags
}

#[cfg(test)]
mod placement_tests {
    use super::*;

    #[test]
    fn unloaded_chat_stays_on_gpu_only_with_three_gb_spare() {
        assert_eq!(placement_after_unload(6.0, 12.0, 0.0), Placement::Gpu);
        assert_eq!(placement_after_unload(6.0, 8.0, 0.0), Placement::Offload);
        assert_eq!(placement_after_unload(6.0, 4.0, 9.5), Placement::Gpu);
    }

    #[test]
    fn offload_and_safe_add_the_same_flags_as_electron() {
        assert!(engine_flags(false, false).is_empty());
        assert_eq!(engine_flags(true, false), vec!["--vae-tiling"]);
        assert_eq!(
            engine_flags(false, true),
            vec!["--vae-tiling", "--diffusion-fa", "--offload-to-cpu"]
        );
    }

    #[test]
    fn project_destination_needs_an_image_extension() {
        assert!(output_extension_ok("art/cat.PNG"));
        assert!(output_extension_ok("a.jpeg"));
        assert!(!output_extension_ok("notes.txt"));
        let bad = json!({"requestId": "r1", "prompt": "x",
            "destination": {"kind": "project", "path": "a.txt"}});
        assert_eq!(
            parse_request(&bad).unwrap_err().message,
            "An image can only be saved as .png, .jpg or .webp"
        );
        let good = json!({"requestId": "r1", "prompt": "x",
            "destination": {"kind": "project", "path": "a.webp"}});
        assert_eq!(
            parse_request(&good).unwrap().destination,
            Destination::Project("a.webp".into())
        );
    }
}
