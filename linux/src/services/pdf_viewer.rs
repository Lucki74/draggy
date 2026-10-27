use std::path::Path;

pub struct PdfViewerService;

impl PdfViewerService {
    pub fn is_valid_pdf<P: AsRef<Path>>(path: P) -> bool {
        if let Ok(bytes) = std::fs::read(path) {
            bytes.starts_with(b"%PDF-")
        } else {
            false
        }
    }
}
