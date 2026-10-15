//! Errors from reading and writing Office files. The read messages are the ones the Electron app shows the user.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum OfficeError {
    #[error("Unsupported document type")]
    Unsupported,
    #[error("Not a valid Office file")]
    NotAPackage,
    #[error("No document body found")]
    NoBody,
    #[error("No slides found")]
    NoSlides,
    #[error("This PDF is password protected, so its text cannot be read.")]
    PdfPassword,
    #[error("This PDF could not be opened: {0}")]
    PdfOpen(String),
    #[error(
        "This PDF has no text to extract. It is most likely a scan or a set of images, and Draggy does not run OCR."
    )]
    PdfNoText,
    /// A cell past the last worksheet column. The reference's cell address decoder throws this.
    #[error("Out of bounds. Invalid column letter: {0}")]
    ColumnOutOfBounds(String),
    /// A shared string index with no entry. The reference fails on the missing entry with a TypeError.
    #[error("Cannot read properties of undefined (reading 'richText')")]
    SharedStringMissing,
    /// A date cell whose serial number has no date. The reference's ISO conversion throws this.
    #[error("Invalid time value")]
    InvalidDate,
    #[error("a corrupt part in the package: {0}")]
    Corrupt(String),
    #[error("could not build the {format} file: {message}")]
    Build {
        format: &'static str,
        message: String,
    },
    /// The Markdown writers refuse HTML. write_generated_file sends HTML to the HTML writers in office_html.
    #[error("HTML content needs the HTML writers")]
    HtmlBody,
    #[error("could not write the file: {0}")]
    Write(#[from] std::io::Error),
}
