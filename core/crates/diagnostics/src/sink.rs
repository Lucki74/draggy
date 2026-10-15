//! One append-only file with size-based rotation. `app.log` moves to `app.log.1`, older archives shift up, three are kept.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const KEEP_ROTATIONS: u32 = 3;

pub(crate) struct Sink {
    path: PathBuf,
    file: Option<File>,
    bytes: u64,
    max_bytes: u64,
}

impl Sink {
    pub(crate) fn new(path: PathBuf, max_bytes: u64) -> Self {
        Self {
            path,
            file: None,
            bytes: 0,
            max_bytes,
        }
    }

    /// Appends one line. Rotates first when the line would pass the cap, so a line never splits across files.
    pub(crate) fn write(&mut self, line: &str) -> io::Result<()> {
        if self.file.is_none() {
            self.open()?;
        }
        let size = line.len() as u64;
        if self.bytes > 0 && self.bytes + size > self.max_bytes {
            // Closed before the rename: moving a file under an open handle keeps writing to the archive.
            self.file = None;
            rotate(&self.path)?;
            self.bytes = 0;
            self.open()?;
        }
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("log file is not open"))?;
        file.write_all(line.as_bytes())?;
        self.bytes += size;
        Ok(())
    }

    /// Opens for append and seeds the byte count from what the file already holds.
    fn open(&mut self) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut size = fs::metadata(&self.path).map_or(0, |meta| meta.len());
        if size >= self.max_bytes {
            rotate(&self.path)?;
            size = 0;
        }
        self.file = Some(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?,
        );
        self.bytes = size;
        Ok(())
    }
}

fn archive(path: &Path, index: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

/// Shifts `path.N` up one, the live file becomes `path.1`, and the oldest archive is dropped.
fn rotate(path: &Path) -> io::Result<()> {
    for index in (1..=KEEP_ROTATIONS).rev() {
        let older = archive(path, index);
        let newer = if index == 1 {
            path.to_path_buf()
        } else {
            archive(path, index - 1)
        };
        if index == KEEP_ROTATIONS && older.exists() {
            fs::remove_file(&older)?;
        }
        if newer.exists() {
            fs::rename(&newer, &older)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Sink;

    #[test]
    fn rotates_before_a_line_would_pass_the_cap_and_keeps_three_archives() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("debug.log");
        let mut sink = Sink::new(path.clone(), 10);
        for index in 0..5 {
            sink.write(&format!("line-{index}\n")).expect("write");
        }
        let text = |name: &str| std::fs::read_to_string(dir.path().join(name)).unwrap_or_default();
        assert_eq!(text("debug.log"), "line-4\n");
        assert_eq!(text("debug.log.1"), "line-3\n");
        assert_eq!(text("debug.log.2"), "line-2\n");
        assert_eq!(text("debug.log.3"), "line-1\n");
        assert!(!dir.path().join("debug.log.4").exists());
    }

    #[test]
    fn seeds_the_byte_count_from_an_existing_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("app.log");
        std::fs::write(&path, "y".repeat(3_900)).expect("seed");
        let mut sink = Sink::new(path, 4_000);
        sink.write(&"z".repeat(200)).expect("write");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("app.log.1"))
                .unwrap_or_default()
                .len(),
            3_900
        );
    }
}
