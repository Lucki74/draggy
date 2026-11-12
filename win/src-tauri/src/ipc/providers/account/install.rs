//! The disk and the network behind the Claude Code install. The core installer decides what to write; this carries it out.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;

use draggy_providers::http::{ByteStream, TransportError};
use draggy_providers::install_fs::{Download, FileView, InstallFs};
use sha2::{Digest, Sha256};

pub struct Disk;

impl FileView for Disk {
    fn exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn list(&self, dir: &str) -> Option<Vec<String>> {
        let entries = fs::read_dir(dir).ok()?;
        Some(
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect(),
        )
    }
}

impl InstallFs for Disk {
    fn write_file(&mut self, path: &str, bytes: &[u8]) {
        let _ = fs::write(path, bytes);
    }

    fn append_file(&mut self, path: &str, bytes: &[u8]) {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(bytes);
        }
    }

    fn make_dir(&mut self, path: &str) {
        let _ = fs::create_dir_all(path);
    }

    fn remove_tree(&mut self, path: &str) {
        let _ = fs::remove_dir_all(path);
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        fs::rename(from, to).map_err(|error| error.to_string())
    }

    fn sha256(&self, path: &str) -> Option<String> {
        let bytes = fs::read(path).ok()?;
        Some(
            Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        )
    }

    /// Windows runs any file with an executable extension, so there is nothing to set.
    fn set_executable(&mut self, _path: &str) {}
}

/// Streams a body with the app's HTTP client. The installer runs on a blocking thread, so waiting here is fine.
pub struct Net;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().build().unwrap_or_default())
}

fn failed() -> TransportError {
    TransportError {
        message: "The download failed.".to_owned(),
        cause_message: None,
        code: None,
    }
}

impl Download for Net {
    fn open(&mut self, url: &str) -> Result<Box<dyn ByteStream>, TransportError> {
        let response =
            tauri::async_runtime::block_on(client().get(url).send()).map_err(|_| failed())?;
        if !response.status().is_success() {
            return Err(failed());
        }
        Ok(Box::new(Body {
            response: Some(response),
        }))
    }
}

struct Body {
    response: Option<reqwest::Response>,
}

impl ByteStream for Body {
    fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        let Some(response) = self.response.as_mut() else {
            return Ok(None);
        };
        match tauri::async_runtime::block_on(response.chunk()) {
            Ok(Some(bytes)) => Ok(Some(bytes.to_vec())),
            Ok(None) => {
                self.response = None;
                Ok(None)
            }
            Err(_) => Err(failed()),
        }
    }

    fn cancel(&mut self) {
        self.response = None;
    }
}
