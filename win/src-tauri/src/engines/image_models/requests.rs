//! Image request rules: what a request may hold, how its picture is named and how a LoRA is written. Port of
//! electron/imageRequests.cjs.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// Longest prompt accepted, in characters.
pub const MAX_PROMPT: usize = 4000;
/// Largest base64 initial picture accepted, in characters.
pub const MAX_INIT_IMAGE_CHARS: usize = 30 * 1024 * 1024;
/// Extensions a picture may be saved as in a project.
pub const OUTPUT_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp"];

static REQUEST_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{1,64}$").expect("request id pattern compiles"));
static LORA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([A-Za-z0-9 _.-]{1,80}?)(?::(-?\d+(?:\.\d+)?))?$").expect("lora pattern compiles")
});
static DATA_IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^data:image/(png|jpe?g|webp|bmp|gif);base64,").expect("data url pattern compiles")
});

/// A LoRA named in a request, with its multiplier.
#[derive(Debug, Clone, PartialEq)]
pub struct Lora {
    pub name: String,
    pub multiplier: f64,
}

/// Parses `name` or `name:multiplier`. The multiplier is clamped to [-2, 2] and defaults to 1.
pub fn parse_lora(text: &str) -> Option<Lora> {
    let caps = LORA.captures(text.trim())?;
    let name = caps.get(1)?.as_str().trim().to_owned();
    if name.is_empty() || name.contains("..") {
        return None;
    }
    let multiplier = caps
        .get(2)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(1.0)
        .clamp(-2.0, 2.0);
    Some(Lora { name, multiplier })
}

/// A file name stem from a prompt: ASCII words joined by dashes, at most 40 characters, "image" when empty.
pub fn slug_for(prompt: &str) -> String {
    let ascii: String = prompt
        .chars()
        .filter(char::is_ascii)
        .collect::<String>()
        .to_lowercase();
    let words: Vec<&str> = ascii
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let mut slug = String::new();
    for word in words {
        let next_len = if slug.is_empty() {
            word.len()
        } else {
            slug.len() + 1 + word.len()
        };
        if next_len > 40 {
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(word);
    }
    if slug.is_empty() {
        "image".to_owned()
    } else {
        slug
    }
}

/// The picture's file name: a timestamp, the slug and `.png`, with `-n` added until it is not taken.
/// `stamp` is the caller's local time as `YYYY-MM-DD-HHMMSS`.
pub fn output_name(prompt: &str, stamp: &str, exists: impl Fn(&str) -> bool) -> String {
    let base = format!("{stamp}-{}", slug_for(prompt));
    let first = format!("{base}.png");
    if !exists(&first) {
        return first;
    }
    (2..)
        .map(|n| format!("{base}-{n}.png"))
        .find(|candidate| !exists(candidate))
        .unwrap_or(first)
}

/// Clamps a number into [min, max]; anything not a number takes the fallback.
fn number(value: Option<&Value>, min: f64, max: f64, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .map_or(fallback, |n| n.clamp(min, max))
}

/// A request that passed the rules, with every number in range.
#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    pub request_id: String,
    pub prompt: String,
    pub width: f64,
    pub height: f64,
    pub steps: f64,
    pub cfg_scale: f64,
    pub strength: f64,
    pub seed: i64,
    pub loras: Vec<Lora>,
    pub workspace_id: String,
    pub created: bool,
}

/// Why a request was refused. The code is the one the renderer names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    NoRequestId,
    NoPrompt,
    PromptTooLong,
    TooManyLoras,
    BadLora,
    BadInit,
}

impl Refusal {
    pub fn code(self) -> &'static str {
        match self {
            Self::NoRequestId => "no-request-id",
            Self::NoPrompt => "no-prompt",
            Self::PromptTooLong => "prompt-too-long",
            Self::TooManyLoras => "too-many-loras",
            Self::BadLora => "bad-lora",
            Self::BadInit => "bad-init-image",
        }
    }
}

/// Checks a request from the renderer. Numbers are clamped rather than refused, as the Electron app does.
pub fn check_request(raw: &Value) -> Result<Checked, Refusal> {
    let request_id = raw
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !REQUEST_ID.is_match(request_id) {
        return Err(Refusal::NoRequestId);
    }
    let prompt = raw
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if prompt.is_empty() {
        return Err(Refusal::NoPrompt);
    }
    if prompt.chars().count() > MAX_PROMPT {
        return Err(Refusal::PromptTooLong);
    }
    let lora_items = raw
        .get("loras")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if lora_items.len() > 4 {
        return Err(Refusal::TooManyLoras);
    }
    let mut loras = Vec::with_capacity(lora_items.len());
    for item in &lora_items {
        let text = item.as_str().ok_or(Refusal::BadLora)?;
        loras.push(parse_lora(text).ok_or(Refusal::BadLora)?);
    }
    let init_bad = raw
        .get("initImage")
        .and_then(Value::as_str)
        .is_some_and(|init| !DATA_IMAGE.is_match(init) || init.len() > MAX_INIT_IMAGE_CHARS);
    if init_bad {
        return Err(Refusal::BadInit);
    }
    let seed = raw
        .get("seed")
        .and_then(Value::as_i64)
        .filter(|s| *s >= 0)
        .unwrap_or(-1);
    let workspace_id = raw
        .get("workspaceId")
        .and_then(Value::as_str)
        .filter(|w| !w.is_empty())
        .unwrap_or("default")
        .to_owned();
    Ok(Checked {
        request_id: request_id.to_owned(),
        prompt,
        width: number(raw.get("width"), 64.0, 2048.0, 1024.0),
        height: number(raw.get("height"), 64.0, 2048.0, 1024.0),
        steps: number(raw.get("steps"), 1.0, 150.0, 20.0),
        cfg_scale: number(raw.get("cfgScale"), 0.0, 30.0, 7.0),
        strength: number(raw.get("strength"), 0.0, 1.0, 0.75),
        seed,
        loras,
        workspace_id,
        created: raw.get("created").and_then(Value::as_bool) == Some(true),
    })
}

/// True when a destination file name ends in an extension a picture may be saved as.
pub fn output_allowed(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    OUTPUT_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({ "requestId": "req-1", "prompt": "a cat" })
    }

    #[test]
    fn slugs_are_ascii_and_bounded() {
        assert_eq!(slug_for("A Lighthouse, at DUSK!"), "a-lighthouse-at-dusk");
        assert_eq!(slug_for("日本語"), "image");
        assert!(slug_for(&"word ".repeat(30)).len() <= 40);
    }

    #[test]
    fn names_avoid_taken_files() {
        let stamp = "2026-09-22-210509";
        assert_eq!(
            output_name("A Lighthouse", stamp, |_| false),
            "2026-09-22-210509-a-lighthouse.png"
        );
        let taken = "2026-09-22-210509-a-lighthouse.png";
        assert_eq!(
            output_name("A Lighthouse", stamp, |n| n == taken),
            "2026-09-22-210509-a-lighthouse-2.png"
        );
    }

    #[test]
    fn loras_parse_names_and_clamp_multipliers() {
        assert_eq!(
            parse_lora("style"),
            Some(Lora {
                name: "style".into(),
                multiplier: 1.0
            })
        );
        assert_eq!(parse_lora("style:5").map(|l| l.multiplier), Some(2.0));
        assert_eq!(parse_lora("style:-9").map(|l| l.multiplier), Some(-2.0));
        assert!(parse_lora("../secret").is_none());
        assert!(parse_lora("bad/name").is_none());
    }

    #[test]
    fn requests_are_refused_by_rule() {
        assert_eq!(
            check_request(&json!({ "prompt": "x" })),
            Err(Refusal::NoRequestId)
        );
        assert_eq!(
            check_request(&json!({ "requestId": "r", "prompt": "  " })),
            Err(Refusal::NoPrompt)
        );
        let long = json!({ "requestId": "r", "prompt": "x".repeat(MAX_PROMPT + 1) });
        assert_eq!(check_request(&long), Err(Refusal::PromptTooLong));
        let many = json!({ "requestId": "r", "prompt": "x", "loras": ["a", "b", "c", "d", "e"] });
        assert_eq!(check_request(&many), Err(Refusal::TooManyLoras));
        let bad_init =
            json!({ "requestId": "r", "prompt": "x", "initImage": "data:text/plain;base64,AAAA" });
        assert_eq!(check_request(&bad_init), Err(Refusal::BadInit));
    }

    #[test]
    fn numbers_clamp_and_defaults_hold() {
        let raw = json!({ "requestId": "r", "prompt": "x", "width": 9999, "steps": 0, "cfgScale": 40, "seed": -5 });
        let checked = check_request(&raw).expect("valid request");
        assert_eq!(checked.width, 2048.0);
        assert_eq!(checked.steps, 1.0);
        assert_eq!(checked.cfg_scale, 30.0);
        assert_eq!(checked.seed, -1);
        assert_eq!(checked.workspace_id, "default");
        assert!(!checked.created);
    }

    #[test]
    fn destinations_take_only_picture_extensions() {
        assert!(output_allowed("pic.PNG"));
        assert!(output_allowed("pic.webp"));
        assert!(!output_allowed("pic.txt"));
        assert!(base().get("requestId").is_some());
    }
}
