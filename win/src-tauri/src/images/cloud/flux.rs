//! FLUX-style `POST {base}/images/generations` (Together): width and height in pixels, `response_format: "base64"`,
//! answered with `data[0].b64_json`. Docs: https://docs.together.ai/reference/post-images-generations

use serde_json::{Value, json};

use super::{Built, CloudError, Request, decode_b64};

pub fn build(request: &Request) -> Built {
    Built {
        url: format!("{}/images/generations", request.base.trim_end_matches('/')),
        headers: vec![("Authorization", format!("Bearer {}", request.key))],
        body: json!({
            "model": request.model,
            "prompt": request.prompt,
            "n": 1,
            "width": request.width,
            "height": request.height,
            "response_format": "base64",
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

    #[test]
    fn sends_width_height_and_base64_format() {
        let built = build(&Request {
            base: "https://api.together.xyz/v1",
            key: "t-test",
            model: "black-forest-labs/FLUX.2-pro",
            prompt: "a fox",
            width: 768,
            height: 512,
        });
        assert_eq!(built.url, "https://api.together.xyz/v1/images/generations");
        assert_eq!(built.body["width"], 768);
        assert_eq!(built.body["response_format"], "base64");
    }
}
