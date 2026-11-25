//! Gemini Interactions `POST {base}/interactions` with `response_format: {type: "image"}`. Docs:
//! https://aistudio.google.com/docs/image-generation. The docs show the reply only through the SDK
//! (`output_image.data`, or `steps[].content[]` blocks of type image), so the parser takes the first image block
//! wherever it sits, and still reads the older `inlineData` parts.

use serde_json::{Value, json};

use super::{Built, CloudError, Request, aspect_ratio, decode_b64};

/// The API revision the docs' REST examples pin.
const REVISION: &str = "2026-05-20";

pub fn build(request: &Request) -> Built {
    Built {
        url: format!("{}/interactions", request.base.trim_end_matches('/')),
        headers: vec![
            ("x-goog-api-key", request.key.to_owned()),
            ("Api-Revision", REVISION.to_owned()),
        ],
        body: json!({
            "model": request.model,
            "input": request.prompt,
            "response_format": {
                "type": "image",
                "mime_type": "image/png",
                "aspect_ratio": aspect_ratio(request.width, request.height),
                "image_size": "1K",
            },
        }),
    }
}

/// The base64 of the first picture in `value`, searched depth first.
fn image_data(value: &Value) -> Option<&str> {
    match value {
        Value::Object(map) => {
            for key in ["output_image", "inlineData", "inline_data"] {
                let data = map.get(key).and_then(|inner| inner.get("data"));
                if let Some(data) = data.and_then(Value::as_str) {
                    return Some(data);
                }
            }
            if map.get("type").and_then(Value::as_str) == Some("image")
                && let Some(data) = map.get("data").and_then(Value::as_str)
            {
                return Some(data);
            }
            map.values().find_map(image_data)
        }
        Value::Array(items) => items.iter().find_map(image_data),
        _ => None,
    }
}

pub fn parse(body: &[u8]) -> Result<Vec<u8>, CloudError> {
    let reply: Value = serde_json::from_slice(body).map_err(|_| CloudError::Malformed)?;
    decode_b64(image_data(&reply).ok_or(CloudError::Malformed)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn builds_an_interactions_request_with_image_format_and_revision() {
        let built = build(&Request {
            base: "https://generativelanguage.googleapis.com/v1beta",
            key: "g-test",
            model: "gemini-3.1-flash-image",
            prompt: "a fox",
            width: 1536,
            height: 1024,
        });
        assert_eq!(
            built.url,
            "https://generativelanguage.googleapis.com/v1beta/interactions"
        );
        assert_eq!(
            built.headers,
            vec![
                ("x-goog-api-key", "g-test".to_owned()),
                ("Api-Revision", REVISION.to_owned()),
            ]
        );
        assert_eq!(built.body["input"], "a fox");
        assert_eq!(built.body["response_format"]["type"], "image");
        assert_eq!(built.body["response_format"]["aspect_ratio"], "3:2");
    }

    #[test]
    fn reads_output_image_step_blocks_and_inline_parts() {
        for reply in [
            format!(r#"{{"output_image":{{"mime_type":"image/png","data":"{PNG_1PX}"}}}}"#),
            format!(
                r#"{{"steps":[{{"type":"model_output","content":[{{"type":"text","text":"here"}},{{"type":"image","data":"{PNG_1PX}"}}]}}]}}"#
            ),
            format!(
                r#"{{"candidates":[{{"content":{{"parts":[{{"inlineData":{{"data":"{PNG_1PX}"}}}}]}}}}]}}"#
            ),
        ] {
            let bytes = parse(reply.as_bytes()).unwrap();
            assert!(bytes.starts_with(super::super::PNG_MAGIC), "{reply}");
        }
    }

    #[test]
    fn text_only_reply_is_malformed() {
        let reply = br#"{"steps":[{"type":"model_output","content":[{"type":"text","text":"no picture"}]}]}"#;
        assert_eq!(parse(reply).unwrap_err(), CloudError::Malformed);
    }
}
