//! OpenAI-compatible `POST {base}/images/generations`, answered with `data[0].b64_json`.
//! Used by OpenAI and xAI. Docs: https://developers.openai.com/api/docs/guides/image-generation

use serde_json::{Value, json};

use super::{Built, CloudError, Request, decode_b64};

pub fn build(request: &Request) -> Built {
    let mut body = json!({
        "model": request.model,
        "prompt": request.prompt,
        "n": 1,
        "size": format!("{}x{}", request.width, request.height),
    });
    // gpt-image models always return base64 and reject the field, other models need it to return it.
    if !request.model.starts_with("gpt-image") {
        body["response_format"] = json!("b64_json");
    }
    Built {
        url: format!("{}/images/generations", request.base.trim_end_matches('/')),
        headers: vec![("Authorization", format!("Bearer {}", request.key))],
        body,
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

    fn request(model: &'static str) -> Request<'static> {
        Request {
            base: "https://api.openai.com/v1/",
            key: "k-test",
            model,
            prompt: "a fox",
            width: 1024,
            height: 768,
        }
    }

    #[test]
    fn builds_generation_request_with_size_and_bearer_key() {
        let built = build(&request("gpt-image-2.6-flare"));
        assert_eq!(built.url, "https://api.openai.com/v1/images/generations");
        assert_eq!(
            built.headers,
            vec![("Authorization", "Bearer k-test".to_owned())]
        );
        assert_eq!(built.body["size"], "1024x768");
        assert!(built.body.get("response_format").is_none());
    }

    #[test]
    fn other_models_ask_for_base64() {
        let built = build(&request("grok-imagine-image"));
        assert_eq!(built.body["response_format"], "b64_json");
    }

    #[test]
    fn parses_first_b64_image() {
        let reply = format!(r#"{{"data":[{{"b64_json":"{PNG_1PX}"}}]}}"#);
        let bytes = parse(reply.as_bytes()).unwrap();
        assert!(bytes.starts_with(super::super::PNG_MAGIC));
    }

    #[test]
    fn reply_without_image_is_malformed() {
        assert_eq!(parse(br#"{"data":[]}"#).unwrap_err(), CloudError::Malformed);
    }
}
