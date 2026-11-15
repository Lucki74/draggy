//! The Gemini TTS endpoint: `streamGenerateContent` over server-sent events, with audio in `inlineData`.

use base64::Engine as _;
use serde_json::{Value, json};

use super::{Built, Target};
use crate::tts::frames::Framer;

const STYLE: &str =
    "Say this warmly and relaxed, like a person in a conversation, with natural pauses: ";

pub fn request(target: &Target, key: &str, model: &str, voice: &str, input: &str) -> Built {
    Built {
        url: format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            target.base_url.trim_end_matches('/'),
            encode_component(model)
        ),
        headers: vec![
            ("Content-Type", "application/json".to_owned()),
            ("x-goog-api-key", key.to_owned()),
        ],
        body: json!({
            "contents": [{ "role": "user", "parts": [{ "text": format!("{STYLE}{input}") }] }],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": { "voiceName": voice }
                    }
                },
            },
        }),
    }
}

/// `encodeURIComponent`: letters, digits and `-_.!~*'()` pass, everything else is percent-encoded.
fn encode_component(text: &str) -> String {
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

/// The audio in one Gemini server event, when it carries any.
pub fn audio(data: &str) -> Option<Vec<u8>> {
    let event: Value = serde_json::from_str(data).ok()?;
    let parts = event.pointer("/candidates/0/content/parts")?.as_array()?;
    let encoded = parts.iter().find_map(|part| {
        part.pointer("/inlineData/data")
            .and_then(Value::as_str)
            .filter(|data| !data.is_empty())
    })?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
}

/// Server-sent events: only `data:` lines can carry audio.
pub fn push_event(framer: &mut Framer, line: &[u8], on_frames: &mut impl FnMut(Vec<i16>)) {
    let text = String::from_utf8_lossy(line);
    let Some(data) = text.trim().strip_prefix("data:") else {
        return;
    };
    if let Some(audio) = audio(data.trim()) {
        framer.push(&audio, on_frames);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gemini_event_yields_its_decoded_audio() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3, 4]);
        let event = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "data": encoded } }] } }] });
        assert_eq!(audio(&event.to_string()), Some(vec![1, 2, 3, 4]));
    }

    #[test]
    fn events_without_audio_yield_nothing() {
        assert_eq!(audio(r#"{"candidates":[]}"#), None);
        assert_eq!(audio("not json"), None);
        assert_eq!(
            audio(r#"{"candidates":[{"content":{"parts":[{"inlineData":{"data":""}}]}}]}"#),
            None
        );
    }

    #[test]
    fn model_names_are_encoded_in_the_path() {
        assert_eq!(encode_component("a b/c"), "a%20b%2Fc");
    }
}
