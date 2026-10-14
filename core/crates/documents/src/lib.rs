//! draggy-documents: document export and extraction. Ports electron/markdownHtml.cjs, the pure part of
//! electron/htmlDocument.cjs and electron/officeStyle.cjs, and electron/documents.cjs: the docx, xlsx and pptx
//! writers from Markdown, text extraction from Office files and PDFs, and the file routing around them.
//! The Chromium PDF step is not ported here.

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
