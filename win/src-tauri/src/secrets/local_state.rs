//! `Local State` in the user data folder, the file Chromium and Electron read the `os_crypt` key from.
//! Only a missing key is written; an existing key is never replaced, or every stored secret would be lost.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Map, Value};
use zeroize::Zeroizing;

use super::dpapi;

const FILE: &str = "Local State";
const PREFIX: &[u8] = b"DPAPI";
const KEY_LEN: usize = 32;

/// Returns the 32-byte AES key, creating and DPAPI-wrapping it first if Local State has none.
pub fn load_or_create(dir: &Path) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let path = dir.join(FILE);
    let mut root = read_root(&path)?;

    if let Some(wrapped) = encrypted_key(&root)? {
        return unwrap_key(&wrapped);
    }

    let mut fresh = Zeroizing::new([0u8; KEY_LEN]);
    getrandom::fill(fresh.as_mut_slice()).map_err(|_| "no randomness for the key".to_string())?;
    let wrapped =
        dpapi::protect(fresh.as_slice()).map_err(|_| "DPAPI could not wrap the key".to_string())?;

    let mut blob = PREFIX.to_vec();
    blob.extend_from_slice(&wrapped);
    let os_crypt = root
        .entry("os_crypt")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Local State has a non-object os_crypt".to_string())?;
    os_crypt.insert("encrypted_key".into(), Value::String(STANDARD.encode(blob)));
    write_root(&path, &root)?;

    Ok(fresh)
}

fn read_root(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let text =
        fs::read_to_string(path).map_err(|e| format!("Local State could not be read: {e}"))?;
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err("Local State is not a JSON object".into()),
    }
}

/// The base64 key from `os_crypt.encrypted_key`, or `None` when the file has no key yet.
fn encrypted_key(root: &Map<String, Value>) -> Result<Option<String>, String> {
    let Some(os_crypt) = root.get("os_crypt") else {
        return Ok(None);
    };
    let os_crypt = os_crypt
        .as_object()
        .ok_or_else(|| "Local State has a non-object os_crypt".to_string())?;
    match os_crypt.get("encrypted_key") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err("Local State has a non-string encrypted_key".into()),
    }
}

fn unwrap_key(encoded: &str) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let blob = STANDARD
        .decode(encoded)
        .map_err(|_| "Local State key is not base64".to_string())?;
    let wrapped = blob
        .strip_prefix(PREFIX)
        .ok_or_else(|| "Local State key has no DPAPI prefix".to_string())?;
    let raw =
        dpapi::unprotect(wrapped).map_err(|_| "DPAPI could not unwrap the key".to_string())?;
    let key: [u8; KEY_LEN] = raw
        .as_slice()
        .try_into()
        .map_err(|_| "the unwrapped key is not 32 bytes".to_string())?;
    Ok(Zeroizing::new(key))
}

/// Writes through a temp file so a crash cannot leave a half-written Local State behind.
fn write_root(path: &Path, root: &Map<String, Value>) -> Result<(), String> {
    let text =
        serde_json::to_string(root).map_err(|_| "Local State could not be encoded".to_string())?;
    let tmp: PathBuf = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| format!("Local State could not be written: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Local State could not be replaced: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_key_once_and_keeps_other_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(
            dir.path().join(FILE),
            r#"{"browser":{"enabled_labs":["x"]},"os_crypt":{"other":1}}"#,
        )
        .expect("seed");

        let first = load_or_create(dir.path()).expect("create");
        let second = load_or_create(dir.path()).expect("reuse");

        assert_eq!(first.as_slice(), second.as_slice());
        let root: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(FILE)).unwrap()).unwrap();
        assert_eq!(root["browser"]["enabled_labs"][0], "x");
        assert_eq!(root["os_crypt"]["other"], 1);
        assert!(root["os_crypt"]["encrypted_key"].is_string());
    }

    #[test]
    fn reads_a_key_written_in_the_electron_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let key = [9u8; KEY_LEN];
        let mut blob = PREFIX.to_vec();
        blob.extend(dpapi::protect(&key).expect("protect"));
        let text = format!(
            r#"{{"os_crypt":{{"encrypted_key":"{}"}}}}"#,
            STANDARD.encode(blob)
        );
        fs::write(dir.path().join(FILE), text).expect("seed");

        assert_eq!(load_or_create(dir.path()).expect("read").as_slice(), &key);
    }

    #[test]
    fn refuses_a_non_object_file_rather_than_overwriting_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(FILE), "[1,2]").expect("seed");

        assert!(load_or_create(dir.path()).is_err());
        assert_eq!(fs::read_to_string(dir.path().join(FILE)).unwrap(), "[1,2]");
    }
}
