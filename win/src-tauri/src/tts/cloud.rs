//! Cloud voices over the user's own key. The request is made here, in the Rust process, and the renderer only
//! receives PCM frames. Nothing about the text or the audio is logged beyond its size. Port of
//! electron/tts/cloud/openai.cjs and gemini.cjs.

use base64::Engine as _;
use serde_json::{Value, json};

use super::frames::Framer;

/// The most characters sent in one request.
pub const MAX_CHARS: usize = 4000;

const OPENAI_BASE: &str = "https://api.openai.com/v1";
const OPENAI_MODEL: &str = "gpt-4o-mini-tts";
const OPENAI_VOICE: &str = "alloy";
const OPENAI_STYLE: &str =
    "Speak warmly and relaxed, like a person in a conversation, with natural pauses.";
const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL: &str = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE: &str = "Kore";
const GEMINI_STYLE: &str =
    "Say this warmly and relaxed, like a person in a conversation, with natural pauses: ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Gemini,
}

impl Provider {
    /// The catalog id, which is also the adapter id the renderer uses.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "openai" => Some(Self::OpenAi),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::OpenAi => "OpenAI",
            Self::Gemini => "Google Gemini",
        }
    }

    fn base_url(self) -> &'static str {
        match self {
            Self::OpenAi => OPENAI_BASE,
            Self::Gemini => GEMINI_BASE,
        }
    }

    /// The request for one fragment. An empty voice or model takes the adapter's default.
    pub fn build(self, key: &str, speech: &Speech<'_>) -> Result<Built, SpeakError> {
        let input = clip(speech.text)?;
        Ok(match self {
            Self::OpenAi => Built {
                url: format!("{}/audio/speech", self.base_url()),
                headers: vec![
                    ("Content-Type", "application/json".to_owned()),
                    ("Authorization", format!("Bearer {key}")),
                ],
                body: json!({
                    "model": pick(speech.model, OPENAI_MODEL),
                    "voice": pick(speech.voice, OPENAI_VOICE),
                    "input": input,
                    "instructions": OPENAI_STYLE,
                    "response_format": "pcm",
                }),
            },
            Self::Gemini => Built {
                url: format!(
                    "{}/models/{}:streamGenerateContent?alt=sse",
                    self.base_url(),
                    encode_component(pick(speech.model, GEMINI_MODEL))
                ),
                headers: vec![
                    ("Content-Type", "application/json".to_owned()),
                    ("x-goog-api-key", key.to_owned()),
                ],
                body: json!({
                    "contents": [{ "role": "user", "parts": [{ "text": format!("{GEMINI_STYLE}{input}") }] }],
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": { "voiceName": pick(speech.voice, GEMINI_VOICE) }
                            }
                        },
                    },
                }),
            },
        })
    }
}

/// What one fragment asks for. Empty voice or model means the default.
pub struct Speech<'a> {
    pub text: &'a str,
    pub voice: &'a str,
    pub model: &'a str,
}

/// A request ready to send.
#[derive(Debug, PartialEq)]
pub struct Built {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SpeakError {
    /// Nothing to say after trimming.
    Empty,
    /// The service answered with this status.
    Http(u16),
    /// No answer arrived, or the body broke off.
    Transport,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub characters: usize,
    pub frames: usize,
}

fn clip(text: &str) -> Result<String, SpeakError> {
    let input: String = text.chars().take(MAX_CHARS).collect();
    if input.trim().is_empty() {
        Err(SpeakError::Empty)
    } else {
        Ok(input)
    }
}

fn pick<'a>(value: &'a str, default: &'a str) -> &'a str {
    if value.is_empty() { default } else { value }
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
pub fn gemini_audio(data: &str) -> Option<Vec<u8>> {
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

/// Streams one fragment as 40 ms frames through `on_frames`. Dropping the future ends the request.
pub async fn speak(
    provider: Provider,
    key: &str,
    speech: &Speech<'_>,
    mut on_frames: impl FnMut(Vec<i16>),
) -> Result<Outcome, SpeakError> {
    let built = provider.build(key, speech)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|_| SpeakError::Transport)?;
    let mut request = client.post(&built.url).body(built.body.to_string());
    for (name, value) in built.headers {
        request = request.header(name, value);
    }
    let mut response = request.send().await.map_err(|_| SpeakError::Transport)?;
    let status = response.status();
    if !status.is_success() {
        return Err(SpeakError::Http(status.as_u16()));
    }

    let mut framer = Framer::default();
    match provider {
        Provider::OpenAi => {
            while let Some(chunk) = response.chunk().await.map_err(|_| SpeakError::Transport)? {
                framer.push(&chunk, &mut on_frames);
            }
        }
        Provider::Gemini => {
            let mut line = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| SpeakError::Transport)? {
                line.extend_from_slice(&chunk);
                while let Some(end) = line.iter().position(|byte| *byte == b'\n') {
                    let event: Vec<u8> = line.drain(..=end).collect();
                    push_event(&mut framer, &event, &mut on_frames);
                }
            }
            push_event(&mut framer, &line, &mut on_frames);
        }
    }
    let frames = framer.end(&mut on_frames);
    Ok(Outcome {
        characters: speech.text.chars().count(),
        frames,
    })
}

/// Server-sent events: only `data:` lines can carry audio.
fn push_event(framer: &mut Framer, line: &[u8], on_frames: &mut impl FnMut(Vec<i16>)) {
    let text = String::from_utf8_lossy(line);
    let Some(data) = text.trim().strip_prefix("data:") else {
        return;
    };
    if let Some(audio) = gemini_audio(data.trim()) {
        framer.push(&audio, on_frames);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speech(text: &str) -> Speech<'_> {
        Speech {
            text,
            voice: "",
            model: "",
        }
    }

    #[test]
    fn openai_asks_for_raw_pcm_with_defaults() {
        let built = Provider::OpenAi
            .build("k", &speech("Hi there"))
            .expect("built");
        assert_eq!(built.url, "https://api.openai.com/v1/audio/speech");
        assert!(
            built
                .headers
                .contains(&("Authorization", "Bearer k".to_owned()))
        );
        assert_eq!(built.body["model"], "gpt-4o-mini-tts");
        assert_eq!(built.body["voice"], "alloy");
        assert_eq!(built.body["response_format"], "pcm");
        assert_eq!(built.body["input"], "Hi there");
    }

    #[test]
    fn blank_text_is_refused_before_any_request() {
        assert_eq!(
            Provider::OpenAi.build("k", &speech("  \n ")).err(),
            Some(SpeakError::Empty)
        );
        assert_eq!(
            Provider::Gemini.build("k", &speech("")).err(),
            Some(SpeakError::Empty)
        );
    }

    #[test]
    fn long_text_is_cut_to_the_limit() {
        let long = "a".repeat(MAX_CHARS + 50);
        let built = Provider::OpenAi.build("k", &speech(&long)).expect("built");
        assert_eq!(built.body["input"].as_str().map(str::len), Some(MAX_CHARS));
    }

    #[test]
    fn gemini_encodes_the_model_name_in_the_path() {
        let model = Speech {
            text: "x",
            voice: "",
            model: "a b/c",
        };
        let built = Provider::Gemini.build("k", &model).expect("built");
        assert_eq!(
            built.url,
            "https://generativelanguage.googleapis.com/v1beta/models/a%20b%2Fc:streamGenerateContent?alt=sse"
        );
        assert!(built.headers.contains(&("x-goog-api-key", "k".to_owned())));
    }

    #[test]
    fn gemini_asks_for_audio_in_the_default_voice() {
        let built = Provider::Gemini
            .build("k", &speech("Hello"))
            .expect("built");
        assert_eq!(
            built.body["generationConfig"]["responseModalities"][0],
            "AUDIO"
        );
        assert_eq!(
            built.body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"],
            "Kore"
        );
    }

    #[test]
    fn a_gemini_event_yields_its_decoded_audio() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3, 4]);
        let event = json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "data": encoded } }] } }] });
        assert_eq!(gemini_audio(&event.to_string()), Some(vec![1, 2, 3, 4]));
    }

    #[test]
    fn events_without_audio_yield_nothing() {
        assert_eq!(gemini_audio(r#"{"candidates":[]}"#), None);
        assert_eq!(gemini_audio("not json"), None);
        assert_eq!(
            gemini_audio(r#"{"candidates":[{"content":{"parts":[{"inlineData":{"data":""}}]}}]}"#),
            None
        );
    }

    #[test]
    fn provider_ids_map_both_ways() {
        assert_eq!(Provider::from_id("openai"), Some(Provider::OpenAi));
        assert_eq!(
            Provider::from_id("gemini").map(Provider::name),
            Some("Google Gemini")
        );
        assert_eq!(Provider::from_id("anthropic"), None);
    }
}
