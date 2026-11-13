//! draggy-documents: document export and extraction. Writes docx, xlsx and pptx from Markdown or HTML, and extracts text from Office files and PDFs.
//! The Chromium PDF step is not in this crate.

pub mod html;
pub mod markdown_html;
pub mod office_style;

pub mod office_docx;
pub mod office_error;
pub mod office_files;
pub mod office_html;
pub mod office_markdown;
pub mod office_pdf;
pub mod office_pptx;
pub mod office_read;
pub mod office_xlsx;
pub mod office_xml;
pub mod office_zip;

mod js;
