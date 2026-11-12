//! Handlers for read-document and chat:export. Text extraction comes from draggy_documents; the save dialog is the
//! only way a chat leaves the app, so nothing is written before the user picks a path.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_documents::office_files::{DOCUMENT_TEXT_LIMIT, extract_text};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::storage::blocking;
use super::{IpcError, Registry};
use crate::AppState;

const DEFAULT_CHAT_NAME: &str = "Conversation";

pub fn register_all(registry: &mut Registry) {
    register!(registry, "read-document" => read_document);
    register!(registry, "chat:export" => export_chat);
}

/// The bridge sends a Uint8Array through JSON, so it arrives as an index-keyed object; base64 and arrays also work.
fn bytes_arg(value: Option<&Value>) -> Option<Vec<u8>> {
    match value? {
        Value::String(encoded) => STANDARD.decode(encoded).ok(),
        Value::Array(items) => items
            .iter()
            .map(|item| item.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect(),
        Value::Object(map) => (0..map.len())
            .map(|index| {
                map.get(&index.to_string())
                    .and_then(Value::as_u64)
                    .and_then(|n| u8::try_from(n).ok())
            })
            .collect(),
        _ => None,
    }
}

async fn read_document(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let filename = args
        .first()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let Some(bytes) = bytes_arg(args.get(1)) else {
        return Ok(json!({ "success": false, "error": "No document data" }));
    };
    let outcome = blocking(move || extract_text(&filename, &bytes)).await?;
    Ok(match outcome {
        Ok(text) => {
            let trimmed = text.chars().take(DOCUMENT_TEXT_LIMIT).collect::<String>();
            let trimmed = trimmed.trim();
            if trimmed.is_empty() {
                json!({ "success": false, "error": "No readable text found" })
            } else {
                json!({ "success": true, "text": trimmed })
            }
        }
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    })
}

async fn export_chat(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = args.into_iter().next().unwrap_or(Value::Null);
    let ext = if request.get("ext").and_then(Value::as_str) == Some("html") {
        "html"
    } else {
        "md"
    };
    let content = request
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let raw_name = request
        .get("defaultName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(DEFAULT_CHAT_NAME);
    let name = safe_name(raw_name);
    let default_file = if name.is_empty() {
        format!("{DEFAULT_CHAT_NAME}.{ext}")
    } else {
        name
    };

    let suggested = default_file.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&suggested)
        .add_filter(if ext == "html" { "HTML" } else { "Markdown" }, &[ext]);
    if let Ok(documents) = app.path().document_dir() {
        dialog = dialog.set_directory(documents);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = match rx.await {
        Ok(Some(picked)) => picked.into_path().ok(),
        _ => None,
    };
    let Some(picked) = picked else {
        return Ok(json!({ "saved": false }));
    };

    let target = with_extension(picked, ext);
    let bytes = content.len();
    let write_target = target.clone();
    blocking(move || std::fs::write(&write_target, content))
        .await?
        .map_err(|error| IpcError::Failed(error.to_string()))?;
    let file = target.to_string_lossy().into_owned();
    if let Some(state) = app.try_state::<AppState>() {
        state.diag.info(
            "files",
            "chat exported",
            Some(json!({ "format": ext, "bytes": bytes })),
        );
    }
    let _ = app.opener().reveal_item_in_dir(&target);
    Ok(json!({ "saved": true, "file": file, "bytes": bytes }))
}

/// Replaces the characters a file name cannot hold with spaces, as electron/main.cjs does.
fn safe_name(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

fn with_extension(path: std::path::PathBuf, ext: &str) -> std::path::PathBuf {
    let text = path.to_string_lossy().into_owned();
    if text.to_lowercase().ends_with(&format!(".{ext}")) {
        path
    } else {
        std::path::PathBuf::from(format!("{text}.{ext}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64_and_byte_arrays() {
        assert_eq!(bytes_arg(Some(&json!("aGk="))), Some(b"hi".to_vec()));
        assert_eq!(bytes_arg(Some(&json!([104, 105]))), Some(b"hi".to_vec()));
        assert_eq!(
            bytes_arg(Some(&json!({"0": 104, "1": 105}))),
            Some(b"hi".to_vec())
        );
        assert_eq!(bytes_arg(Some(&json!({"0": 104, "2": 105}))), None);
        assert_eq!(bytes_arg(Some(&json!([300]))), None);
        assert_eq!(bytes_arg(None), None);
    }

    #[test]
    fn strips_reserved_characters_from_names() {
        assert_eq!(safe_name("a/b:c*d?"), "a b c d");
        assert_eq!(safe_name("  Chat\u{0007} "), "Chat");
    }

    #[test]
    fn appends_extension_once() {
        let md = with_extension(std::path::PathBuf::from("/tmp/x"), "md");
        assert!(md.to_string_lossy().ends_with("x.md"));
        let kept = with_extension(std::path::PathBuf::from("/tmp/x.MD"), "md");
        assert!(kept.to_string_lossy().ends_with("x.MD"));
    }

    #[test]
    fn extracts_text_from_unsupported_type_as_error() {
        let error = extract_text("notes.txt", b"plain").unwrap_err();
        assert_eq!(error.to_string(), "Unsupported document type");
    }
}
