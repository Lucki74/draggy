//! Embedding requests and replies: reading `input`, counting tokens and writing vectors as floats or base64.
//! `dimensions` is ignored, since the embedding model has one size.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

/// Most inputs one request may carry, as OpenAI allows.
pub const MAX_INPUTS: usize = 2048;

/// How a vector is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Float,
    Base64,
}

/// The `encoding_format` a body asks for.
pub fn read_format(body: &Value) -> Result<Format, String> {
    match body.get("encoding_format") {
        None | Some(Value::Null) => Ok(Format::Float),
        Some(Value::String(name)) if name == "float" => Ok(Format::Float),
        Some(Value::String(name)) if name == "base64" => Ok(Format::Base64),
        Some(_) => Err("encoding_format must be float or base64.".to_owned()),
    }
}

/// The inputs of a body: a string, an array of strings, one array of token ids or an array of those.
/// Each result is a string or an array of ids.
pub fn read_inputs(input: Option<&Value>) -> Result<Vec<Value>, String> {
    let wrong =
        || "input must be a string, an array of strings or an array of token arrays.".to_owned();
    let inputs: Vec<Value> = match input {
        Some(Value::String(text)) => vec![Value::String(text.clone())],
        Some(Value::Array(items)) if items.iter().all(Value::is_string) => items.clone(),
        Some(Value::Array(items)) if items.iter().all(is_ids) && !items.is_empty() => {
            vec![Value::Array(items.clone())]
        }
        Some(Value::Array(items))
            if items
                .iter()
                .all(|item| item.as_array().is_some_and(|ids| ids.iter().all(is_id))) =>
        {
            items.clone()
        }
        _ => return Err(wrong()),
    };
    if inputs.is_empty() {
        return Err("input must not be empty.".to_owned());
    }
    if inputs.len() > MAX_INPUTS {
        return Err(format!("input may hold at most {MAX_INPUTS} items."));
    }
    let blank = inputs.iter().any(|item| match item {
        Value::String(text) => text.is_empty(),
        Value::Array(ids) => ids.is_empty(),
        _ => false,
    });
    if blank {
        return Err("input must not hold an empty item.".to_owned());
    }
    Ok(inputs)
}

fn is_id(value: &Value) -> bool {
    value.as_u64().is_some()
}

fn is_ids(value: &Value) -> bool {
    is_id(value)
}

/// A token count for inputs the engine did not count: ids as they are, text at four characters to the token.
pub fn estimate_tokens(inputs: &[Value]) -> u64 {
    inputs
        .iter()
        .map(|item| match item {
            Value::String(text) => (text.chars().count() as u64).div_ceil(4),
            Value::Array(ids) => ids.len() as u64,
            _ => 0,
        })
        .sum()
}

/// One vector as the format wants it: an array of numbers, or the base64 of its little-endian `f32` bytes.
pub fn encode_vector(vector: &[f32], format: Format) -> Value {
    match format {
        Format::Float => json!(vector),
        Format::Base64 => {
            let bytes: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
            Value::String(STANDARD.encode(bytes))
        }
    }
}

/// The reply of `POST /v1/embeddings`.
pub fn reply_body(model: &str, vectors: &[Vec<f32>], format: Format, tokens: u64) -> Value {
    let data: Vec<Value> = vectors
        .iter()
        .enumerate()
        .map(|(index, vector)| {
            json!({"object": "embedding", "index": index, "embedding": encode_vector(vector, format)})
        })
        .collect();
    json!({
        "object": "list",
        "data": data,
        "model": model,
        "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_input_shape() {
        assert_eq!(read_inputs(Some(&json!("a"))), Ok(vec![json!("a")]));
        assert_eq!(
            read_inputs(Some(&json!(["a", "b"]))),
            Ok(vec![json!("a"), json!("b")])
        );
        assert_eq!(
            read_inputs(Some(&json!([1, 2, 3]))),
            Ok(vec![json!([1, 2, 3])])
        );
        assert_eq!(
            read_inputs(Some(&json!([[1], [2, 3]]))),
            Ok(vec![json!([1]), json!([2, 3])])
        );
    }

    #[test]
    fn refuses_bad_inputs() {
        for bad in [
            json!([]),
            json!(""),
            json!([""]),
            json!(7),
            json!(["a", 1]),
            json!([[]]),
            json!([1.5]),
        ] {
            assert!(read_inputs(Some(&bad)).is_err(), "{bad}");
        }
        assert!(read_inputs(None).is_err());
    }

    #[test]
    fn writes_base64_as_little_endian_floats() {
        let one = encode_vector(&[1.0], Format::Base64);
        assert_eq!(one, json!("AACAPw=="));
    }

    #[test]
    fn estimates_tokens() {
        assert_eq!(estimate_tokens(&[json!("abcdefghi"), json!([1, 2])]), 5);
    }
}
