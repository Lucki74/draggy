//! Reads the text of a document the user picked, so the shell can put it in a message. Word, PowerPoint, Excel and PDF
//! files are supported; the reading itself lives in `draggy-documents`.

use std::path::Path;

use crate::error::CoreError;

fn read_blocking(path: &str) -> Result<String, CoreError> {
    let name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    let bytes = std::fs::read(path).map_err(|error| CoreError::Invalid {
        message: format!("{name} could not be read: {error}"),
    })?;
    draggy_documents::office_files::extract_text(name, &bytes).map_err(|error| CoreError::Invalid {
        message: format!("{name}: {error}"),
    })
}

/// The text of a `.docx`, `.pptx`, `.xlsx` or `.pdf` file. Other types, unreadable files and PDFs without text are
/// refused with a message the shell can show. The file is read on a worker thread.
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_document(path: String) -> Result<String, CoreError> {
    tokio::task::spawn_blocking(move || read_blocking(&path))
        .await
        .map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?
}
