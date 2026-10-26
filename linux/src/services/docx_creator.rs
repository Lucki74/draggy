use std::fs;
use std::io;
use std::path::Path;

pub struct DocxCreator;

impl DocxCreator {
    pub fn create_document<P: AsRef<Path>>(
        title: &str,
        paragraphs: &[String],
        out: P,
    ) -> io::Result<()> {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>{}</w:t></w:r></w:p>{}</w:body></w:document>",
            title,
            paragraphs
                .iter()
                .map(|p| format!("<w:p><w:r><w:t>{}</w:t></w:r></w:p>", p))
                .collect::<Vec<_>>()
                .join("")
        );
        fs::write(out, xml)
    }
}
