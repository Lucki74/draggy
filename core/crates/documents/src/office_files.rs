//! Routes a file by its extension: which Office reader or writer handles it, and which names are refused outright.
//! Ports the routing half of electron/documents.cjs (extractText, writeGeneratedFile, isExecutableName).

use std::path::Path;

use crate::html::is_html;
use crate::office_docx::write_docx;
use crate::office_error::OfficeError;
use crate::office_html;
use crate::office_pdf::read_pdf;
use crate::office_pptx::write_pptx;
use crate::office_read::{read_docx, read_pptx, read_xlsx};
use crate::office_xlsx::write_xlsx;

/// The most text one PDF contributes. A longer one is cut off at the page where this is reached.
pub const DOCUMENT_TEXT_LIMIT: usize = 200_000;

/// How many pages of a PDF are read. A thousand-page scan produces almost no text and would otherwise be read in full.
pub const MAX_PDF_PAGES: usize = 500;

/// File extensions that are never opened or written by Draggy, including double extensions that end in one of them.
pub const EXECUTABLE_EXTENSIONS: &[&str] = &[
    ".exe",
    ".msi",
    ".msix",
    ".appx",
    ".com",
    ".scr",
    ".pif",
    ".cpl",
    ".dll",
    ".bat",
    ".cmd",
    ".ps1",
    ".psm1",
    ".psd1",
    ".vbs",
    ".vbe",
    ".js",
    ".jse",
    ".wsf",
    ".wsh",
    ".hta",
    ".lnk",
    ".url",
    ".scf",
    ".reg",
    ".inf",
    ".jar",
    ".app",
    ".dmg",
    ".pkg",
    ".command",
    ".desktop",
    ".run",
    ".appimage",
    ".gadget",
    ".msc",
    ".sh",
    ".bash",
    ".zsh",
];

/// The lowercase extension with its dot, or an empty string when there is none.
fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{}", ext.to_lowercase()))
        .unwrap_or_default()
}

/// Whether a file name ends in an executable extension, ignoring case.
pub fn is_executable_name(filename: &str) -> bool {
    EXECUTABLE_EXTENSIONS.contains(&extension_of(filename).as_str())
}

/// The text of an Office file or PDF, chosen by the name's extension. Other types are refused.
pub fn extract_text(filename: &str, bytes: &[u8]) -> Result<String, OfficeError> {
    let result = match extension_of(filename).as_str() {
        ".docx" => read_docx(bytes),
        ".pptx" => read_pptx(bytes),
        ".xlsx" => read_xlsx(bytes),
        ".pdf" => read_pdf(bytes),
        _ => Err(OfficeError::Unsupported),
    };
    if let Err(error) = &result {
        tracing::warn!(target: "files.documents", error = %error, "extract text failed");
    }
    result
}

/// Writes content to a file, chosen by its extension. HTML content goes to the HTML writers, Markdown to the Markdown
/// ones, and other names get the text as it is.
pub fn write_generated_file(path: &Path, content: &str) -> Result<(), OfficeError> {
    let name = path.to_string_lossy();
    let html = is_html(Some(content));
    match extension_of(&name).as_str() {
        ".docx" if html => {
            let (bytes, blocks) = office_html::docx_from_html(content)?;
            std::fs::write(path, bytes)?;
            tracing::debug!(target: "files.documents", blocks, "html docx written");
            Ok(())
        }
        ".pptx" if html => {
            let (bytes, slides) = office_html::pptx_from_html(content)?;
            std::fs::write(path, bytes)?;
            tracing::debug!(target: "files.documents", slides, "html pptx written");
            Ok(())
        }
        ".xlsx" if html => {
            let (bytes, sheets) = office_html::xlsx_from_html(content)?;
            std::fs::write(path, bytes)?;
            tracing::debug!(target: "files.documents", sheets, "html xlsx written");
            Ok(())
        }
        ".docx" => write_docx(path, content).map(|_| ()),
        ".pptx" => write_pptx(path, content).map(|_| ()),
        ".xlsx" => write_xlsx(path, content).map(|_| ()),
        _ => std::fs::write(path, content).map_err(OfficeError::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_names_are_refused_whatever_their_case() {
        assert!(is_executable_name("payload.exe"));
        assert!(is_executable_name("Run.BaT"));
        assert!(is_executable_name("invoice.pdf.exe"));
        assert!(!is_executable_name("executive-summary.docx"));
        assert!(!is_executable_name("Makefile"));
    }

    #[test]
    fn an_unsupported_type_is_refused() {
        assert!(matches!(
            extract_text("a.odt", b""),
            Err(OfficeError::Unsupported)
        ));
    }

    #[test]
    fn other_extensions_get_the_text_as_it_is() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let dir = std::env::temp_dir().join(format!("draggy-office-files-{nanos}"));
        std::fs::create_dir_all(&dir).expect("makes a folder");
        let path = dir.join("notes.md");
        write_generated_file(&path, "# hello").expect("writes");
        assert_eq!(std::fs::read_to_string(&path).expect("reads"), "# hello");
        std::fs::remove_dir_all(&dir).expect("cleans up");
    }
}
