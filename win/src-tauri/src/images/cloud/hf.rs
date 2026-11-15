//! Hugging Face inference text-to-image: `POST https://router.huggingface.co/hf-inference/models/{model}` with
//! `{"inputs": prompt}`. The reply is the raw image bytes, not JSON. Docs:
//! https://huggingface.co/docs/inference-providers/tasks/text-to-image

use serde_json::json;

use super::{Built, CloudError, Request};

const BASE: &str = "https://router.huggingface.co/hf-inference/models";

pub fn build(request: &Request) -> Built {
    Built {
        url: format!("{BASE}/{}", request.model),
        headers: vec![("Authorization", format!("Bearer {}", request.key))],
        body: json!({
            "inputs": request.prompt,
            "parameters": { "width": request.width, "height": request.height },
        }),
    }
}

/// The reply is the image itself. An empty body is malformed; the format check happens in the caller.
pub fn parse(body: &[u8]) -> Result<Vec<u8>, CloudError> {
    if body.is_empty() {
        return Err(CloudError::Malformed);
    }
    Ok(body.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_model_path_with_inputs_payload() {
        let built = build(&Request {
            base: "ignored",
            key: "hf-test",
            model: "Qwen/Qwen-Image",
            prompt: "a fox",
            width: 1024,
            height: 1024,
        });
        assert_eq!(
            built.url,
            "https://router.huggingface.co/hf-inference/models/Qwen/Qwen-Image"
        );
        assert_eq!(built.body["inputs"], "a fox");
    }

    #[test]
    fn raw_bytes_pass_through_and_empty_is_malformed() {
        assert_eq!(parse(b"\x89PNG").unwrap(), b"\x89PNG".to_vec());
        assert_eq!(parse(b"").unwrap_err(), CloudError::Malformed);
    }
}
