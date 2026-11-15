//! Cloud image models. Each protocol builds one request and reads one picture out of the reply. The key stays in
//! the Rust process; callers only receive PNG, JPEG or WebP bytes.

pub mod flux;
pub mod gemini;
pub mod hf;
pub mod openai;
pub mod openrouter;

use base64::Engine as _;
use serde_json::Value;

pub const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// The picture format of `bytes` as a MIME type and file extension, or `None` when it is not a picture.
pub fn format_of(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(PNG_MAGIC) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// A request ready to send. The headers carry the key, so this type is never logged.
#[derive(Debug, Clone, PartialEq)]
pub struct Built {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    OpenAiImages,
    Gemini,
    OpenRouterImages,
    Flux,
    HfInference,
}

impl Protocol {
    /// The catalog `image.protocol` value.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "openai-images" => Some(Self::OpenAiImages),
            "gemini" => Some(Self::Gemini),
            "openrouter-images" => Some(Self::OpenRouterImages),
            "flux" => Some(Self::Flux),
            "hf-inference" => Some(Self::HfInference),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudError {
    MissingKey,
    Http(u16),
    Transport,
    Malformed,
    NotImage,
}

impl CloudError {
    pub fn code(self) -> &'static str {
        match self {
            Self::MissingKey => "no-key",
            Self::Http(_) => "http",
            Self::Transport => "transport",
            Self::Malformed => "malformed",
            Self::NotImage => "not-image",
        }
    }
}

/// One picture request. `base` is the provider's base URL from the catalog.
#[derive(Debug, Clone, Copy)]
pub struct Request<'a> {
    pub base: &'a str,
    pub key: &'a str,
    pub model: &'a str,
    pub prompt: &'a str,
    pub width: u32,
    pub height: u32,
}

pub fn build(protocol: Protocol, request: &Request) -> Result<Built, CloudError> {
    if request.key.trim().is_empty() {
        return Err(CloudError::MissingKey);
    }
    Ok(match protocol {
        Protocol::OpenAiImages => openai::build(request),
        Protocol::Gemini => gemini::build(request),
        Protocol::OpenRouterImages => openrouter::build(request),
        Protocol::Flux => flux::build(request),
        Protocol::HfInference => hf::build(request),
    })
}

/// The picture in a reply body. Anything that is not PNG, JPEG or WebP is refused.
pub fn parse(protocol: Protocol, body: &[u8]) -> Result<Vec<u8>, CloudError> {
    let png = match protocol {
        Protocol::OpenAiImages => openai::parse(body)?,
        Protocol::Gemini => gemini::parse(body)?,
        Protocol::OpenRouterImages => openrouter::parse(body)?,
        Protocol::Flux => flux::parse(body)?,
        Protocol::HfInference => hf::parse(body)?,
    };
    if format_of(&png).is_some() {
        Ok(png)
    } else {
        Err(CloudError::NotImage)
    }
}

/// Sends one picture request and returns the picture bytes.
pub async fn generate(protocol: Protocol, request: &Request<'_>) -> Result<Vec<u8>, CloudError> {
    let built = build(protocol, request)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|_| CloudError::Transport)?;
    let mut sent = client
        .post(&built.url)
        .header("Content-Type", "application/json")
        .body(built.body.to_string());
    for (name, value) in built.headers {
        sent = sent.header(name, value);
    }
    let response = sent.send().await.map_err(|_| CloudError::Transport)?;
    let status = response.status();
    if !status.is_success() {
        return Err(CloudError::Http(status.as_u16()));
    }
    let bytes = response.bytes().await.map_err(|_| CloudError::Transport)?;
    parse(protocol, &bytes)
}

/// The supported aspect ratio closest to `width` x `height`, for the APIs that take a ratio instead of pixels.
pub fn aspect_ratio(width: u32, height: u32) -> &'static str {
    const RATIOS: [(&str, f64); 11] = [
        ("1:1", 1.0),
        ("16:9", 16.0 / 9.0),
        ("9:16", 9.0 / 16.0),
        ("4:3", 4.0 / 3.0),
        ("3:4", 3.0 / 4.0),
        ("3:2", 1.5),
        ("2:3", 2.0 / 3.0),
        ("5:4", 1.25),
        ("4:5", 0.8),
        ("21:9", 21.0 / 9.0),
        ("9:21", 9.0 / 21.0),
    ];
    let wanted = (f64::from(width.max(1)) / f64::from(height.max(1))).ln();
    RATIOS
        .iter()
        .min_by(|a, b| {
            (a.1.ln() - wanted)
                .abs()
                .total_cmp(&(b.1.ln() - wanted).abs())
        })
        .map_or("1:1", |(name, _)| name)
}

/// Decodes standard base64, the encoding every JSON reply here uses for pictures.
pub fn decode_b64(encoded: &str) -> Result<Vec<u8>, CloudError> {
    base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| CloudError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(key: &str) -> Request<'_> {
        Request {
            base: "https://example.test/v1",
            key,
            model: "m",
            prompt: "a fox",
            width: 1024,
            height: 1024,
        }
    }

    #[test]
    fn missing_key_is_refused_before_any_request() {
        assert_eq!(
            build(Protocol::OpenAiImages, &request("  ")).unwrap_err(),
            CloudError::MissingKey
        );
    }

    #[test]
    fn bytes_that_are_not_a_picture_are_refused() {
        assert_eq!(
            parse(Protocol::HfInference, b"<html>busy</html>").unwrap_err(),
            CloudError::NotImage
        );
    }

    #[test]
    fn jpeg_and_webp_replies_are_kept() {
        let jpeg = [0xff_u8, 0xd8, 0xff, 0xe0];
        assert_eq!(parse(Protocol::HfInference, &jpeg).unwrap(), jpeg);
        assert_eq!(format_of(&jpeg), Some(("image/jpeg", "jpg")));
        assert_eq!(
            format_of(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(("image/webp", "webp"))
        );
    }

    #[test]
    fn sizes_map_to_the_nearest_ratio() {
        assert_eq!(aspect_ratio(1024, 1024), "1:1");
        assert_eq!(aspect_ratio(1920, 1080), "16:9");
        assert_eq!(aspect_ratio(832, 1216), "2:3");
    }

    #[test]
    fn protocol_ids_map_to_adapters() {
        assert_eq!(Protocol::from_id("gemini"), Some(Protocol::Gemini));
        assert_eq!(Protocol::from_id("nope"), None);
    }
}
