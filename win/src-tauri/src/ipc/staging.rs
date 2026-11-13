//! Large renderer payloads arrive as chunks, since one big invoke body fails over the custom protocol.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde_json::Value;

const MAX_CHUNKS: usize = 512;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_STAGED: usize = 8;

struct Staged {
    total: usize,
    chunks: Vec<Option<String>>,
    bytes: usize,
}

static STAGED: LazyLock<Mutex<HashMap<String, Staged>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Keeps one chunk of a payload until `take` assembles it.
pub fn stage(id: &str, index: usize, total: usize, chunk: String) -> Result<(), String> {
    if !valid_id(id) || total == 0 || total > MAX_CHUNKS || index >= total {
        return Err("invalid staged payload".to_owned());
    }
    let mut map = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    if !map.contains_key(id) && map.len() >= MAX_STAGED {
        return Err("too many staged payloads".to_owned());
    }
    let entry = map.entry(id.to_owned()).or_insert_with(|| Staged {
        total,
        chunks: vec![None; total],
        bytes: 0,
    });
    if entry.total != total {
        return Err("invalid staged payload".to_owned());
    }
    let previous = entry.chunks[index].as_ref().map_or(0, String::len);
    if entry.bytes - previous + chunk.len() > MAX_BYTES {
        return Err("staged payload too large".to_owned());
    }
    entry.bytes = entry.bytes - previous + chunk.len();
    entry.chunks[index] = Some(chunk);
    Ok(())
}

/// Removes a complete payload and returns its arguments as a JSON array.
pub fn take(id: &str) -> Result<Vec<Value>, String> {
    let staged = STAGED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(id)
        .ok_or_else(|| "unknown staged payload".to_owned())?;
    let mut text = String::with_capacity(staged.bytes);
    for chunk in staged.chunks {
        text.push_str(&chunk.ok_or_else(|| "incomplete staged payload".to_owned())?);
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Array(args)) => Ok(args),
        _ => Err("invalid staged arguments".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chunks_assemble_into_the_arguments_in_any_order() {
        stage("t-order", 1, 2, "\"b\"]".to_owned()).expect("stage");
        stage("t-order", 0, 2, "[\"a\",".to_owned()).expect("stage");
        assert_eq!(take("t-order").expect("take"), vec![json!("a"), json!("b")]);
    }

    #[test]
    fn an_incomplete_or_unknown_payload_is_refused() {
        stage("t-gap", 0, 2, "[1".to_owned()).expect("stage");
        assert!(take("t-gap").is_err());
        assert!(take("t-gap").is_err());
    }

    #[test]
    fn bad_ids_and_counts_are_refused() {
        assert!(stage("../x", 0, 1, "[]".to_owned()).is_err());
        assert!(stage("t-count", 0, 0, "[]".to_owned()).is_err());
        assert!(stage("t-index", 2, 2, "[]".to_owned()).is_err());
    }

    #[test]
    fn a_payload_that_is_not_an_array_is_refused() {
        stage("t-object", 0, 1, "{}".to_owned()).expect("stage");
        assert!(take("t-object").is_err());
    }
}
