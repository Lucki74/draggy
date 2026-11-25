//! The OpenAI speech endpoint, `POST {base}/audio/speech`. Every OpenAI compatible endpoint uses this adapter.
//! Only api.openai.com takes `pcm` and the style `instructions`; other endpoints answer with WAV.

use serde_json::json;

use super::{Built, SpeakError, Target};
use crate::tts::frames::SAMPLE_RATE;

const STYLE: &str =
    "Speak warmly and relaxed, like a person in a conversation, with natural pauses.";

/// True for OpenAI itself, which streams raw PCM at the player's rate.
pub fn native_pcm(target: &Target) -> bool {
    target.id == "openai"
}

pub fn request(
    target: &Target,
    key: &str,
    model: &str,
    voice: &str,
    input: &str,
) -> Result<Built, SpeakError> {
    let native = native_pcm(target);
    let mut body = json!({
        "model": model,
        "voice": voice,
        "input": input,
        "response_format": if native { "pcm" } else { "wav" },
    });
    if native {
        body["instructions"] = json!(STYLE);
    }
    Ok(Built {
        url: format!("{}/audio/speech", target.base_url.trim_end_matches('/')),
        headers: vec![
            ("Content-Type", "application/json".to_owned()),
            ("Authorization", format!("Bearer {key}")),
        ],
        body,
    })
}

/// The 16-bit mono samples of a WAV body at the player's rate, or None for any other layout.
pub fn wav_pcm(bytes: &[u8]) -> Option<&[u8]> {
    if !bytes.starts_with(b"RIFF") || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut at = 12;
    let mut format_ok = false;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?) as usize;
        let body = at + 8;
        let end = body.checked_add(size)?.min(bytes.len());
        match id {
            b"fmt " if end - body >= 16 => {
                let fmt = &bytes[body..end];
                let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                format_ok = channels == 1 && rate == SAMPLE_RATE && bits == 16;
            }
            b"data" => return format_ok.then(|| &bytes[body..end]),
            _ => {}
        }
        at = body + size + (size & 1);
    }
    None
}
