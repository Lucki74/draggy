use std::fs;
use std::io;
use std::path::Path;

pub struct ExcelCreator;

impl ExcelCreator {
    pub fn create_sheet<P: AsRef<Path>>(headers: &[&str], rows: &[Vec<String>], out: P) -> io::Result<()> {
        let mut csv = headers.join(",") + "\n";
        for r in rows {
            csv.push_str(&r.join(","));
            csv.push('\n');
        }
        fs::write(out, csv)
    }
}
