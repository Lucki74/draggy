use std::fs;
use std::io;
use std::path::Path;

pub struct PptxCreator;

impl PptxCreator {
    pub fn create_presentation<P: AsRef<Path>>(title: &str, bullets: &[String], out: P) -> io::Result<()> {
        let content = format!(
            "# Slide 1: {}\n{}",
            title,
            bullets.iter().map(|b| format!("- {}\n", b)).collect::<String>()
        );
        fs::write(out, content)
    }
}
