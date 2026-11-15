//! Cloud voices over the user's own key. The request is made here, in the Rust process, and the renderer only
//! receives PCM frames. Nothing about the text or the audio is logged beyond its size.

pub mod gemini;
pub mod openai;

use draggy_providers::catalog::CatalogEntry;

use super::frames::Framer;

/// The most characters sent in one request.
pub const MAX_CHARS: usize = 4000;

/// The wire format of a catalog `speech` block. One adapter per protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    OpenAiSpeech,
    GeminiTts,
}

impl Protocol {
    pub fn from_catalog(protocol: &str) -> Option<Self> {
        match protocol {
            "openai-speech" => Some(Self::OpenAiSpeech),
            "gemini-tts" => Some(Self::GeminiTts),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Model {
    pub id: String,
    pub voices: Vec<String>,
}

/// A provider that can speak, as the catalog describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub models: Vec<Model>,
}

impl Target {
    pub fn from_entry(entry: &CatalogEntry) -> Option<Self> {
        let protocol = Protocol::from_catalog(entry.speech_protocol()?)?;
        let models: Vec<Model> = entry
            .speech_models()
            .iter()
            .map(|model| Model {
                id: model.id.clone(),
                voices: model.voices.clone(),
            })
            .collect();
        if models.is_empty() {
            return None;
        }
        Some(Self {
            id: entry.id.clone(),
            name: entry.name.clone(),
            base_url: entry.base_url.clone(),
            protocol,
            models,
        })
    }

    /// The model and voice a request uses. A name the catalog does not list falls back to the first model,
    /// and a voice the model does not offer falls back to its first voice. An empty name takes the default.
    pub fn resolve(&self, model: &str, voice: &str) -> Option<(String, String)> {
        let model = self
            .models
            .iter()
            .find(|candidate| candidate.id == model)
            .or_else(|| self.models.first())?;
        let voice = if model.voices.iter().any(|candidate| candidate == voice) {
            voice.to_owned()
        } else {
            model.voices.first()?.clone()
        };
        Some((model.id.clone(), voice))
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
    pub body: serde_json::Value,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SpeakError {
    /// Nothing to say after trimming.
    Empty,
    /// The model or voice list in the catalog is empty.
    Unsupported,
    /// The service answered with this status.
    Http(u16),
    /// No answer arrived, the body broke off, or the audio was in a layout the player cannot take.
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

/// The request for one fragment, shaped by the target's protocol.
pub fn build(target: &Target, key: &str, speech: &Speech<'_>) -> Result<Built, SpeakError> {
    let (model, voice) = target
        .resolve(speech.model, speech.voice)
        .ok_or(SpeakError::Unsupported)?;
    let input = clip(speech.text)?;
    match target.protocol {
        Protocol::OpenAiSpeech => openai::request(target, key, &model, &voice, &input),
        Protocol::GeminiTts => Ok(gemini::request(target, key, &model, &voice, &input)),
    }
}

/// Streams one fragment as 40 ms frames through `on_frames`. Dropping the future ends the request.
pub async fn speak(
    target: &Target,
    key: &str,
    speech: &Speech<'_>,
    mut on_frames: impl FnMut(Vec<i16>),
) -> Result<Outcome, SpeakError> {
    let built = build(target, key, speech)?;
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
    match target.protocol {
        Protocol::OpenAiSpeech if openai::native_pcm(target) => {
            while let Some(chunk) = response.chunk().await.map_err(|_| SpeakError::Transport)? {
                framer.push(&chunk, &mut on_frames);
            }
        }
        Protocol::OpenAiSpeech => {
            // Other endpoints answer with a WAV file. It is short, so it is read whole and its samples framed.
            let mut wav = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| SpeakError::Transport)? {
                wav.extend_from_slice(&chunk);
            }
            let samples = openai::wav_pcm(&wav).ok_or(SpeakError::Transport)?;
            framer.push(samples, &mut on_frames);
        }
        Protocol::GeminiTts => {
            let mut line = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| SpeakError::Transport)? {
                line.extend_from_slice(&chunk);
                while let Some(end) = line.iter().position(|byte| *byte == b'\n') {
                    let event: Vec<u8> = line.drain(..=end).collect();
                    gemini::push_event(&mut framer, &event, &mut on_frames);
                }
            }
            gemini::push_event(&mut framer, &line, &mut on_frames);
        }
    }
    let frames = framer.end(&mut on_frames);
    Ok(Outcome {
        characters: speech.text.chars().count(),
        frames,
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use base64::Engine as _;
    use draggy_providers::catalog::Catalog;

    use super::*;
    use crate::tts::frames::{FRAME_BYTES, SAMPLE_RATE};

    fn target(id: &str) -> Target {
        Catalog::bundled()
            .find(id)
            .and_then(Target::from_entry)
            .expect("speech target")
    }

    fn speech(text: &str) -> Speech<'_> {
        Speech {
            text,
            voice: "",
            model: "",
        }
    }

    /// A one-shot HTTP server on localhost. It answers with `status` and `body`, and hands back the request it read.
    fn serve(status: &str, body: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let status = status.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let read = stream.read(&mut buf).expect("read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..read]);
                if let Some(end) = find(&request, b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                    let length: usize = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse().ok())
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes()).expect("write");
            stream.write_all(&body).expect("write");
            String::from_utf8_lossy(&request).into_owned()
        });
        (format!("http://{addr}"), handle)
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    fn wav(samples: &[u8], rate: u32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((36 + samples.len()) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        out.extend_from_slice(samples);
        out
    }

    #[test]
    fn the_catalog_gives_three_speaking_targets() {
        let ids: Vec<String> = Catalog::bundled()
            .speech_entries()
            .filter_map(Target::from_entry)
            .map(|target| target.id)
            .collect();
        assert!(ids.contains(&"openai".to_owned()));
        assert!(ids.contains(&"gemini".to_owned()));
        assert!(ids.contains(&"groq".to_owned()));
    }

    #[test]
    fn resolve_falls_back_to_listed_defaults() {
        let openai = target("openai");
        assert_eq!(
            openai.resolve("", ""),
            Some(("gpt-4o-mini-tts".to_owned(), "alloy".to_owned()))
        );
        assert_eq!(
            openai.resolve("unknown", "nova"),
            Some(("gpt-4o-mini-tts".to_owned(), "nova".to_owned()))
        );
        assert_eq!(
            openai.resolve("gpt-4o-mini-tts", "not-a-voice"),
            Some(("gpt-4o-mini-tts".to_owned(), "alloy".to_owned()))
        );
    }

    #[test]
    fn openai_asks_for_raw_pcm_with_style() {
        let built = build(&target("openai"), "k", &speech("Hi there")).expect("built");
        assert_eq!(built.url, "https://api.openai.com/v1/audio/speech");
        assert!(
            built
                .headers
                .contains(&("Authorization", "Bearer k".to_owned()))
        );
        assert_eq!(built.body["response_format"], "pcm");
        assert_eq!(built.body["voice"], "alloy");
        assert!(built.body["instructions"].is_string());
        assert_eq!(built.body["input"], "Hi there");
    }

    #[test]
    fn groq_asks_for_wav_and_no_openai_only_fields() {
        let built = build(&target("groq"), "k", &speech("Hi")).expect("built");
        assert_eq!(built.url, "https://api.groq.com/openai/v1/audio/speech");
        assert_eq!(built.body["response_format"], "wav");
        assert_eq!(built.body["model"], "canopylabs/orpheus-v1-english");
        assert_eq!(built.body["voice"], "troy");
        assert!(built.body.get("instructions").is_none());
    }

    #[test]
    fn blank_text_and_long_text() {
        assert_eq!(
            build(&target("openai"), "k", &speech("  \n ")).err(),
            Some(SpeakError::Empty)
        );
        let long = "a".repeat(MAX_CHARS + 50);
        let built = build(&target("openai"), "k", &speech(&long)).expect("built");
        assert_eq!(built.body["input"].as_str().map(str::len), Some(MAX_CHARS));
    }

    #[test]
    fn gemini_puts_the_encoded_model_in_the_path() {
        let gemini = target("gemini");
        let built = build(
            &gemini,
            "k",
            &Speech {
                text: "x",
                voice: "",
                model: &gemini.models[0].id,
            },
        )
        .expect("built");
        assert_eq!(
            built.url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:streamGenerateContent?alt=sse"
        );
        assert_eq!(
            built.body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"],
            gemini.models[0].voices[0]
        );
    }

    #[test]
    fn wav_payload_is_taken_only_for_the_player_layout() {
        let samples = vec![1u8, 2, 3, 4];
        assert_eq!(
            openai::wav_pcm(&wav(&samples, SAMPLE_RATE)),
            Some(&samples[..])
        );
        assert_eq!(openai::wav_pcm(&wav(&samples, 44_100)), None);
        assert_eq!(openai::wav_pcm(b"not a wav file at all"), None);
    }

    #[tokio::test]
    async fn openai_pcm_streams_as_frames_over_http() {
        let body = vec![0u8; FRAME_BYTES * 2];
        let (base, handle) = serve("200 OK", body);
        let mut target = target("openai");
        target.base_url = format!("{base}/v1");
        let mut frames = 0;
        let outcome = speak(&target, "secret", &speech("Hello"), |_| frames += 1)
            .await
            .expect("spoke");
        assert_eq!(frames, 2);
        assert_eq!(
            outcome,
            Outcome {
                characters: 5,
                frames: 2
            }
        );
        let request = handle.join().expect("server");
        assert!(request.starts_with("POST /v1/audio/speech"));
        assert!(request.contains("Bearer secret"));
        assert!(request.contains("\"response_format\":\"pcm\""));
    }

    #[tokio::test]
    async fn groq_wav_is_unwrapped_before_framing() {
        let body = wav(&vec![0u8; FRAME_BYTES], SAMPLE_RATE);
        let (base, handle) = serve("200 OK", body);
        let mut target = target("groq");
        target.base_url = format!("{base}/openai/v1");
        let mut frames = 0;
        speak(&target, "k", &speech("Hello"), |_| frames += 1)
            .await
            .expect("spoke");
        assert_eq!(frames, 1);
        let request = handle.join().expect("server");
        assert!(request.contains("\"response_format\":\"wav\""));
    }

    #[tokio::test]
    async fn gemini_events_stream_as_frames_over_http() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(vec![0u8; FRAME_BYTES]);
        let event = serde_json::json!({ "candidates": [{ "content": { "parts": [{ "inlineData": { "data": encoded } }] } }] });
        let body = format!("data: {event}\r\n\r\n").into_bytes();
        let (base, handle) = serve("200 OK", body);
        let mut target = target("gemini");
        target.base_url = format!("{base}/v1beta");
        let mut frames = 0;
        speak(&target, "k", &speech("Hello"), |_| frames += 1)
            .await
            .expect("spoke");
        assert_eq!(frames, 1);
        let request = handle.join().expect("server");
        assert!(request.to_ascii_lowercase().contains("x-goog-api-key: k"));
    }

    #[tokio::test]
    async fn a_refused_request_reports_its_status() {
        let (base, handle) = serve("401 Unauthorized", b"{}".to_vec());
        let mut target = target("openai");
        target.base_url = format!("{base}/v1");
        let result = speak(&target, "bad", &speech("Hello"), |_| {}).await;
        assert_eq!(result, Err(SpeakError::Http(401)));
        handle.join().expect("server");
    }
}
