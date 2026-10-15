//! Writes CSV as a one-sheet .xlsx with rust_xlsxwriter. Ports markdownXlsx in electron/documents.cjs: the first row
//! is bold, numeric-looking cells become numbers, and every cell is set in the sheet font.

use std::path::Path;
use std::sync::LazyLock;

use rust_xlsxwriter::{Format, Workbook, Worksheet, XlsxError};

use crate::html::is_html;
use crate::js::{Pattern, compile, is_match, trim};
use crate::office_error::OfficeError;
use crate::office_markdown::parse_csv;
use crate::office_style::SHEET_FONT;

static NUMBER: Pattern = LazyLock::new(|| compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$"));

/// What the writer reports back, as the reference does: sheets and rows written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XlsxCounts {
    pub sheets: usize,
    pub rows: usize,
}

/// The package bytes for CSV content, and the counts. HTML content is refused: it needs the HTML writer.
pub fn xlsx_bytes(content: &str) -> Result<(Vec<u8>, XlsxCounts), OfficeError> {
    if is_html(Some(content)) {
        return Err(OfficeError::HtmlBody);
    }
    let records = parse_csv(content);
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();

    for (row_index, cells) in records.iter().enumerate() {
        let row = u32::try_from(row_index).map_err(|error| build_error(error.to_string()))?;
        let format = cell_format(row_index == 0);
        for (col_index, cell) in cells.iter().enumerate() {
            let col = u16::try_from(col_index).map_err(|error| build_error(error.to_string()))?;
            write_cell(sheet, row, col, cell, &format)
                .map_err(|error| build_error(error.to_string()))?;
        }
    }

    let bytes = workbook
        .save_to_buffer()
        .map_err(|error| build_error(error.to_string()))?;
    Ok((
        bytes,
        XlsxCounts {
            sheets: 1,
            rows: records.len(),
        },
    ))
}

/// Writes CSV content to a .xlsx file at `path`.
pub fn write_xlsx(path: &Path, content: &str) -> Result<XlsxCounts, OfficeError> {
    let (bytes, counts) = xlsx_bytes(content)?;
    std::fs::write(path, bytes)?;
    tracing::debug!(target: "files.documents", rows = counts.rows, "xlsx written");
    Ok(counts)
}

fn build_error(message: String) -> OfficeError {
    OfficeError::Build {
        format: "xlsx",
        message,
    }
}

fn cell_format(header: bool) -> Format {
    let format = Format::new().set_font_name(SHEET_FONT).set_font_size(11.0);
    if header { format.set_bold() } else { format }
}

/// A numeric-looking cell becomes a number. Anything else is text, untrimmed, and an empty cell stays blank.
fn write_cell(
    sheet: &mut Worksheet,
    row: u32,
    col: u16,
    cell: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    let value = trim(cell);
    if is_match(&NUMBER, value)
        && let Ok(number) = value.parse::<f64>()
        && number.is_finite()
    {
        // TS quirk: the reference writes a number that overflows to Infinity into the sheet. Kept as text here.
        sheet.write_number_with_format(row, col, number, format)?;
        return Ok(());
    }
    if cell.is_empty() {
        sheet.write_blank(row, col, format)?;
    } else {
        sheet.write_string_with_format(row, col, cell, format)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_sheet_and_one_count_per_record() {
        let (_, counts) = xlsx_bytes("a,b\n1,2\n3,4").expect("writes");
        assert_eq!(counts, XlsxCounts { sheets: 1, rows: 3 });
    }

    #[test]
    fn empty_content_is_an_empty_sheet() {
        let (_, counts) = xlsx_bytes("").expect("writes");
        assert_eq!(counts, XlsxCounts { sheets: 1, rows: 0 });
    }

    #[test]
    fn html_content_is_refused() {
        assert!(matches!(
            xlsx_bytes("<table><tr><td>1</td></tr></table>"),
            Err(OfficeError::HtmlBody)
        ));
    }

    #[test]
    fn a_written_sheet_reads_back_with_numbers_as_numbers() {
        let (bytes, _) = xlsx_bytes("name,score\nAda,99\nGrace,-3.5").expect("writes");
        let text = crate::office_read::read_xlsx(&bytes).expect("reads");
        assert!(text.contains("Ada,99") && text.contains("Grace,-3.5"));
    }
}
