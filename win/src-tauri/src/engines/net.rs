//! The network half of the engine installer: text and file fetches over reqwest. Core has the trait and the install
//! flow but no concrete downloader, so this is the one the Windows shell supplies.

use std::io::Write;
use std::path::Path;
use std::time::Duration;

use draggy_engine::binary_manager::{BinaryError, Downloader};

const USER_AGENT: &str = concat!("Draggy/", env!("CARGO_PKG_VERSION"));

pub struct NetDownloader {
    client: reqwest::Client,
}

impl NetDownloader {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self { client })
    }
}

fn transfer(error: impl std::fmt::Display) -> BinaryError {
    BinaryError::Transfer(error.to_string())
}

impl Downloader for NetDownloader {
    async fn get_text(&self, url: &str, accept: Option<&str>) -> Result<String, BinaryError> {
        let mut request = self.client.get(url).timeout(Duration::from_secs(60));
        if let Some(accept) = accept {
            request = request.header(reqwest::header::ACCEPT, accept);
        }
        let response = request.send().await.map_err(transfer)?;
        let status = response.status();
        if !status.is_success() {
            return Err(BinaryError::Transfer(format!(
                "the server answered {status}"
            )));
        }
        response.text().await.map_err(transfer)
    }

    async fn download(
        &self,
        url: &str,
        dest: &Path,
        on_bytes: &(dyn Fn(u64) + Sync),
    ) -> Result<(), BinaryError> {
        let mut response = self.client.get(url).send().await.map_err(transfer)?;
        let status = response.status();
        if !status.is_success() {
            return Err(BinaryError::Transfer(format!(
                "the server answered {status}"
            )));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(dest)?;
        while let Some(chunk) = response.chunk().await.map_err(transfer)? {
            file.write_all(&chunk)?;
            on_bytes(chunk.len() as u64);
        }
        file.flush()?;
        Ok(())
    }
}
