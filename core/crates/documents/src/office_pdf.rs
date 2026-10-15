//! Reads the text of a PDF with lopdf, one section per page, as readPdf in electron/documents.cjs does.
//! Lines break where the text moves vertically, which lopdf's own extraction does not do.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use lopdf::content::Content;
use lopdf::{Document, Encoding, Object, ObjectId};

use crate::js::{Pattern, compile, replace_all, trim};
use crate::office_error::OfficeError;
use crate::office_files::{DOCUMENT_TEXT_LIMIT, MAX_PDF_PAGES};

static SPACES: Pattern = LazyLock::new(|| compile(r"[ \t]+"));
static BLANK_LINES: Pattern = LazyLock::new(|| compile(r"\n{3,}"));

/// One text item of a page as pdf.js reports it. `text` is None when the item's text is not a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextItem<'a> {
    pub text: Option<&'a str>,
    pub has_eol: bool,
}

/// The text of a page from its items. An item that ends a line adds a line break after it.
pub fn page_text(items: &[TextItem<'_>]) -> String {
    let mut out = String::new();
    for item in items {
        if let Some(text) = item.text {
            out.push_str(text);
            if item.has_eol {
                out.push('\n');
            }
        }
    }
    normalize_page_text(&out)
}

/// Collapses runs of spaces and tabs, keeps at most one blank line between paragraphs, and trims the ends.
pub fn normalize_page_text(raw: &str) -> String {
    let spaces = replace_all(&SPACES, raw, |_| " ".to_owned());
    let blanks = replace_all(&BLANK_LINES, &spaces, |_| "\n\n".to_owned());
    trim(&blanks).to_owned()
}

/// The text of a PDF, one section per page, up to the text limit and the page limit.
pub fn read_pdf(bytes: &[u8]) -> Result<String, OfficeError> {
    // lopdf reports a file it cannot parse in its own words. The reference's generic message covers all of them.
    let document = Document::load_mem(bytes)
        .map_err(|_| OfficeError::PdfOpen("Invalid PDF structure.".to_owned()))?;
    // A document still carrying its encryption dictionary after loading has not been opened with an empty password.
    if document.is_encrypted() {
        return Err(OfficeError::PdfPassword);
    }

    let pages_by_number = document.get_pages();
    let total = pages_by_number.len();
    let pages = total.min(MAX_PDF_PAGES);
    let mut sections = Vec::new();
    let mut length = 0;

    for (number, page_id) in pages_by_number.into_iter().take(pages) {
        let text = normalize_page_text(&page_content_text(&document, page_id));
        if text.is_empty() {
            continue;
        }
        sections.push(format!("--- Page {number} ---\n{text}"));
        length += text.encode_utf16().count();
        // TS quirk: a read stopped by the text limit adds no marker, so the pages it skipped go unreported.
        if length >= DOCUMENT_TEXT_LIMIT {
            break;
        }
    }

    if sections.is_empty() {
        return Err(OfficeError::PdfNoText);
    }
    if total > pages {
        sections.push(format!(
            "--- {} further pages were not read ---",
            total - pages
        ));
    }
    tracing::debug!(target: "files.documents", pages, total, chars = length, "pdf pages read");
    Ok(sections.join("\n\n"))
}

/// The text shown on one page, in content order. A text line that moves to a new height starts a new line. A page
/// whose content cannot be decoded has no text here, as pdf.js reads on past such damage.
fn page_content_text(document: &Document, page_id: ObjectId) -> String {
    let fonts = document.get_page_fonts(page_id).unwrap_or_default();
    let encodings: BTreeMap<Vec<u8>, Encoding<'_>> = fonts
        .into_iter()
        .filter_map(|(name, font)| {
            font.get_font_encoding(document)
                .ok()
                .map(|encoding| (name, encoding))
        })
        .collect();
    let decoded = Content::decode(&document.get_page_content(page_id)).ok();
    let Some(content) = decoded else {
        tracing::debug!(target: "files.documents", "pdf page content skipped");
        return String::new();
    };

    let mut text = String::new();
    let mut encoding: Option<&Encoding<'_>> = None;
    let mut line_y = 0.0_f32;
    let mut leading = 0.0_f32;
    let mut shown_at: Option<f32> = None;

    for operation in &content.operations {
        let operands = &operation.operands;
        match operation.operator.as_str() {
            "BT" => line_y = 0.0,
            "ET" => end_line(&mut text),
            "Tf" => {
                encoding = operands
                    .first()
                    .and_then(|font| font.as_name().ok())
                    .and_then(|name| encodings.get(name));
            }
            "TL" => leading = number(operands, 0).unwrap_or(leading),
            "Td" | "TD" => {
                line_y += number(operands, 1).unwrap_or(0.0);
                if operation.operator == "TD" {
                    leading = -number(operands, 1).unwrap_or(0.0);
                }
            }
            "Tm" => line_y = number(operands, 5).unwrap_or(line_y),
            "T*" => {
                line_y -= leading;
                end_line(&mut text);
            }
            "Tj" | "TJ" | "'" | "\"" => {
                // A quote operator always starts a new line; other text starts one only when it moves.
                let quote = operation.operator == "'" || operation.operator == "\"";
                if quote || shown_at.is_some_and(|y| y != line_y) {
                    end_line(&mut text);
                }
                shown_at = Some(line_y);
                if let Some(encoding) = encoding {
                    show(&mut text, encoding, operands);
                }
            }
            _ => {}
        }
    }
    text
}

fn number(operands: &[Object], index: usize) -> Option<f32> {
    match operands.get(index)? {
        Object::Integer(value) => Some(*value as f32),
        Object::Real(value) => Some(*value),
        _ => None,
    }
}

/// Starts a new line unless one is already started or nothing has been written yet.
fn end_line(text: &mut String) {
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
}

/// The decoded strings of a text-showing operation. A large negative kern inside an array reads as a space.
fn show(text: &mut String, encoding: &Encoding<'_>, operands: &[Object]) {
    for operand in operands {
        match operand {
            Object::String(bytes, _) => push_decoded(text, encoding, bytes),
            Object::Array(items) => {
                for item in items {
                    match item {
                        Object::String(bytes, _) => push_decoded(text, encoding, bytes),
                        Object::Integer(kern) if *kern < -100 => text.push(' '),
                        Object::Real(kern) if *kern < -100.0 => text.push(' '),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
}

fn push_decoded(text: &mut String, encoding: &Encoding<'_>, bytes: &[u8]) {
    match Document::decode_text(encoding, bytes) {
        Ok(decoded) => text.push_str(&decoded),
        Err(error) => {
            tracing::debug!(target: "files.documents", error = %error, "pdf text not decoded")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_join_and_end_lines() {
        let items = [
            TextItem {
                text: Some("a"),
                has_eol: false,
            },
            TextItem {
                text: Some("b"),
                has_eol: true,
            },
        ];
        assert_eq!(page_text(&items), "ab");
    }

    #[test]
    fn a_non_string_item_is_skipped() {
        let items = [
            TextItem {
                text: None,
                has_eol: true,
            },
            TextItem {
                text: Some("kept"),
                has_eol: false,
            },
        ];
        assert_eq!(page_text(&items), "kept");
    }

    #[test]
    fn bytes_that_are_not_a_pdf_are_refused() {
        assert!(matches!(
            read_pdf(b"not a pdf"),
            Err(OfficeError::PdfOpen(_))
        ));
    }
}
