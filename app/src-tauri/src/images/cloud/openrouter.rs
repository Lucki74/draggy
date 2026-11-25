//! OpenRouter Image API: `POST {base}/images` with `model`, `prompt` and `aspect_ratio`, answered with
//! `data[0].b64_json`. Docs: https://openrouter.ai/docs/features/multimodal/image-generation

use serde_json::{Value, json};

use super::{Built, CloudError, Request, aspect_ratio, decode_b64};

pub fn build(request: &Request) -> Built {
    Built {
        url: format!("{}/images", request.base.trim_end_matches('/')),
        headers: vec![("Authorization", format!("Bearer {}", request.key))],
        body: json!({
            "model": request.model,
            "prompt": request.prompt,
            "n": 1,
            "aspect_ratio": aspect_ratio(request.width, request.height),
        }),
    }
}

pub fn parse(body: &[u8]) -> Result<Vec<u8>, CloudError> {
    let reply: Value = serde_json::from_slice(body).map_err(|_| CloudError::Malformed)?;
    let encoded = reply
        .pointer("/data/0/b64_json")
        .and_then(Value::as_str)
        .ok_or(CloudError::Malformed)?;
    decode_b64(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn builds_an_images_request_with_aspect_ratio() {
        let built = build(&Request {
            base: "https://openrouter.ai/api/v1",
            key: "or-test",
            model: "google/gemini-3.1-flash-image",
            prompt: "a fox",
            width: 1024,
            height: 1792,
        });
        assert_eq!(built.url, "https://openrouter.ai/api/v1/images");
        assert_eq!(built.body["aspect_ratio"], "9:16");
        assert_eq!(built.body["prompt"], "a fox");
    }

    #[test]
    fn parses_b64_json_from_data() {
        let reply = format!(
            r#"{{"created":1,"data":[{{"b64_json":"{PNG_1PX}","media_type":"image/png"}}]}}"#
        );
        let bytes = parse(reply.as_bytes()).unwrap();
        assert!(bytes.starts_with(super::super::PNG_MAGIC));
    }

    #[test]
    fn reply_without_data_is_malformed() {
        assert_eq!(
            parse(br#"{"error":{"message":"no"}}"#).unwrap_err(),
            CloudError::Malformed
        );
    }
}
