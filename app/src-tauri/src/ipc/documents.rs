//! Handlers for read-document and chat:export. Text extraction comes from draggy_documents; the save dialog is the
//! only way a chat leaves the app, so nothing is written before the user picks a path.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_documents::office_files::{DOCUMENT_TEXT_LIMIT, extract_text};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::pdf_writer;
use super::storage::blocking;
use super::{IpcError, Registry};
use crate::AppState;

const DEFAULT_CHAT_NAME: &str = "Conversation";

pub fn register_all(registry: &mut Registry) {
    register!(registry, "read-document" => read_document);
    register!(registry, "chat:export" => export_chat);
}

/// The bridge sends a Uint8Array through JSON, so it arrives as an index-keyed object; base64 and arrays also work.
pub(crate) fn bytes_arg(value: Option<&Value>) -> Option<Vec<u8>> {
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
    let ext = export_format(request.get("ext").and_then(Value::as_str));
    let content = request
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let limit = if matches!(ext, "svg" | "png") {
        MAX_IMAGE_EXPORT_BYTES
    } else {
        MAX_EXPORT_BYTES
    };
    if content.len() > limit {
        return Err(IpcError::Failed("export is too large".into()));
    }
    if ext == "svg" {
        check_svg(content).map_err(IpcError::Failed)?;
    }
    let content = content.to_owned();
    let raw_name = request
        .get("defaultName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(DEFAULT_CHAT_NAME);
    let name = safe_name(raw_name);
    if name != raw_name
        && let Some(state) = app.try_state::<AppState>()
    {
        state.diag.debug(
            "browser.dialogs",
            "download name sanitised",
            Some(json!({ "changed": true, "len": name.chars().count() })),
        );
    }
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
        .add_filter(filter_label(ext), &[ext]);
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
    // PNG arrives as base64 so the bytes survive the JSON bridge.
    let content = if ext == "png" {
        decode_png(&content).map_err(IpcError::Failed)?
    } else {
        content.into_bytes()
    };
    let bytes = content.len();
    if ext == "pdf" {
        // The PDF is laid out from the HTML transcript.
        pdf_writer::write_pdf(&app, &target, &String::from_utf8_lossy(&content))
            .await
            .map_err(IpcError::Failed)?;
    } else {
        let write_target = target.clone();
        blocking(move || std::fs::write(&write_target, content))
            .await?
            .map_err(|error| IpcError::Failed(error.to_string()))?;
    }
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

/// Largest export accepted over IPC (64 MiB of text or base64).
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
/// Largest SVG or PNG export (8 MiB of markup or base64).
const MAX_IMAGE_EXPORT_BYTES: usize = 8 * 1024 * 1024;
const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Maps the requested extension to a known export format, defaulting to markdown.
fn export_format(ext: Option<&str>) -> &'static str {
    match ext {
        Some("html") => "html",
        Some("pdf") => "pdf",
        Some("svg") => "svg",
        Some("png") => "png",
        _ => "md",
    }
}

fn filter_label(ext: &str) -> &'static str {
    match ext {
        "html" => "HTML",
        "pdf" => "PDF",
        "svg" => "SVG",
        "png" => "PNG",
        _ => "Markdown",
    }
}

/// Accepts only an SVG document root with no script or foreignObject markup.
fn check_svg(content: &str) -> Result<(), String> {
    let text = content.trim_start();
    let lower = text.to_ascii_lowercase();
    if !(lower.starts_with("<svg") || lower.starts_with("<?xml")) {
        return Err("export is not an SVG document".into());
    }
    if lower.contains("<script") || lower.contains("<foreignobject") {
        return Err("SVG export contains active markup".into());
    }
    Ok(())
}

/// Decodes a base64 PNG, with or without its data URL prefix, and checks the signature.
fn decode_png(content: &str) -> Result<Vec<u8>, String> {
    let encoded = content.trim_start_matches("data:image/png;base64,");
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    if !bytes.starts_with(PNG_MAGIC) {
        return Err("not a PNG".into());
    }
    Ok(bytes)
}

/// Replaces the characters a file name cannot hold with spaces.
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
    fn validates_svg_export_content() {
        assert!(check_svg("  <svg viewBox=\"0 0 1 1\"></svg>").is_ok());
        assert!(check_svg("<?xml version=\"1.0\"?><svg></svg>").is_ok());
        assert!(check_svg("<html><body></body></html>").is_err());
        assert!(check_svg("<svg><script>alert(1)</script></svg>").is_err());
        assert!(check_svg("<svg><foreignObject><div/></foreignObject></svg>").is_err());
    }

    #[test]
    fn picks_known_export_formats() {
        assert_eq!(export_format(Some("svg")), "svg");
        assert_eq!(export_format(Some("png")), "png");
        assert_eq!(export_format(Some("pdf")), "pdf");
        assert_eq!(export_format(Some("exe")), "md");
        assert_eq!(export_format(None), "md");
        assert_eq!(filter_label("png"), "PNG");
    }

    #[test]
    fn decodes_only_real_png_data() {
        let png = [PNG_MAGIC, b"rest".as_slice()].concat();
        let encoded = STANDARD.encode(&png);
        assert_eq!(
            decode_png(&format!("data:image/png;base64,{encoded}")),
            Ok(png)
        );
        assert!(decode_png(&STANDARD.encode(b"<svg></svg>")).is_err());
        assert!(decode_png("%%%").is_err());
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
