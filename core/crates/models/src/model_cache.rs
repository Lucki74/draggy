//! The draggy://models/ cache: Hugging Face files kept on disk after their first download. Port of electron/modelCache.cjs.
//! A file is written beside its final name and takes that name only when complete, so a cancelled download never reads as cached.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use tracing::{debug, error, info, warn};
use url::Url;

use crate::download::{Body, HttpClient, Reply, TransportError};
use crate::js::round;
use crate::shards::basename;

/// The redirects `fetch` follows before it gives up, so the cache follows the same number.
const MAX_REDIRECTS: u32 = 20;

/// The headers every model file carries, so a page in isolation may still read it.
const RESOURCE_HEADERS: [(&str, &str); 2] = [
    ("Cross-Origin-Resource-Policy", "cross-origin"),
    ("Cross-Origin-Embedder-Policy", "credentialless"),
];

/// Headers for one cached model file: the isolation pair, the length when it is known, and a type from the extension.
pub fn model_file_headers(relative: &str, size: Option<u64>) -> BTreeMap<String, String> {
    let mut headers: BTreeMap<String, String> = RESOURCE_HEADERS
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect();
    if let Some(size) = size {
        headers.insert("Content-Length".to_owned(), size.to_string());
    }
    let extension = Path::new(relative)
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase());
    let content_type = match extension.as_deref() {
        Some("json") => "application/json",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    };
    headers.insert("Content-Type".to_owned(), content_type.to_owned());
    headers
}

/// The cached path for `relative` under `root`, or None when it would leave the cache folder.
pub fn cached_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut parts: Vec<&str> = Vec::new();
    for segment in relative.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            name => parts.push(name),
        }
    }
    let inside = parts.join("/");
    // TS quirk: the reference refuses any path whose relative form starts with "..", so a file named "..x" is refused too.
    if inside.is_empty() || inside.starts_with("..") {
        return None;
    }
    // path.resolve makes the root absolute, so a relative root gives the same path the reference does.
    Some(std::path::absolute(root).ok()?.join(inside))
}

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("Too many redirects")]
    TooManyRedirects,
    #[error("Redirect target is not a URL")]
    BadRedirect,
}

/// Writes one model file under its partial name. Dropped unfinished, it removes the partial, so a cancel leaves nothing.
#[derive(Debug)]
pub struct CacheWriter {
    partial: PathBuf,
    target: PathBuf,
    file: Option<File>,
    bytes: u64,
    finished: bool,
}

impl CacheWriter {
    /// Creates the folders and the partial file. `token` makes the partial name unique to this attempt.
    pub fn begin(target: &Path, token: &str) -> io::Result<Self> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut name = target.as_os_str().to_owned();
        name.push(format!(".{token}.part"));
        let partial = PathBuf::from(name);
        let file = File::create(&partial)?;
        Ok(Self {
            partial,
            target: target.to_path_buf(),
            file: Some(file),
            bytes: 0,
            finished: false,
        })
    }

    pub fn write(&mut self, chunk: &[u8]) -> io::Result<()> {
        match self.file.as_mut() {
            Some(file) => file.write_all(chunk)?,
            None => return Err(io::Error::other("cache file already closed")),
        }
        self.bytes += chunk.len() as u64;
        Ok(())
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    /// Takes the final name. Only a complete file is ever renamed into place.
    pub fn finish(mut self) -> io::Result<PathBuf> {
        self.file.take();
        fs::rename(&self.partial, &self.target)?;
        self.finished = true;
        Ok(self.target.clone())
    }
}

impl Drop for CacheWriter {
    fn drop(&mut self) {
        if !self.finished {
            self.file.take();
            if let Err(err) = fs::remove_file(&self.partial)
                && err.kind() != io::ErrorKind::NotFound
            {
                warn!(target: "engine.models", reason = %err, "model partial not removed");
            }
        }
    }
}

/// The body of a model fetched from upstream, written to the cache as the caller reads it.
#[derive(Debug)]
pub struct CachedStream<B> {
    body: B,
    writer: Option<CacheWriter>,
    size: Option<u64>,
    name: String,
    started: Instant,
    last_decile: i64,
}

impl<B: Body> CachedStream<B> {
    /// The length the upstream promised, when it said.
    pub fn size(&self) -> Option<u64> {
        self.size
    }

    /// The next chunk, already written to the cache. Once the upstream ends, the file takes its final name.
    pub async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, CacheError> {
        if self.writer.is_none() {
            return Ok(None);
        }
        let next = match self.body.next_chunk().await {
            Ok(next) => next,
            Err(err) => {
                // A failed download drops its partial now; the stream reports the error and stays closed.
                error!(target: "engine.models", file = %self.name, reason = %err, "model download failed");
                self.writer = None;
                return Err(CacheError::Transport(err));
            }
        };
        match next {
            Some(chunk) => {
                let Some(writer) = self.writer.as_mut() else {
                    return Ok(None);
                };
                writer.write(&chunk)?;
                let bytes = writer.bytes();
                let decile = self.size.map_or(-1, |total| {
                    i64::try_from(bytes * 10 / total.max(1)).unwrap_or(-1)
                });
                if decile > self.last_decile {
                    self.last_decile = decile;
                    debug!(target: "engine.models", file = %self.name, percent = decile * 10, bytes, total = self.size.unwrap_or(0), "model download progress");
                }
                Ok(Some(chunk))
            }
            None => {
                if let Some(writer) = self.writer.take() {
                    let bytes = writer.bytes();
                    writer.finish()?;
                    let duration_ms = self.started.elapsed().as_millis();
                    let avg_bytes_per_sec =
                        round(bytes as f64 * 1000.0 / duration_ms.max(1) as f64) as u64;
                    info!(target: "engine.models", file = %self.name, bytes, dur_ms = duration_ms, avg_bytes_per_sec, "model cached");
                }
                Ok(None)
            }
        }
    }
}

impl<B> Drop for CachedStream<B> {
    fn drop(&mut self) {
        // Still holding a partial when dropped means the reader went away before the end: a cancel, not a failure.
        if let Some(writer) = self.writer.take() {
            info!(target: "engine.models", file = %self.name, bytes = writer.bytes(), "model download cancelled");
        }
    }
}

/// What the cache answers for one request.
#[derive(Debug)]
pub enum Served<B> {
    BadRequest,
    Cached { path: PathBuf, size: u64 },
    UpstreamFailed { status: u16 },
    Fetched(CachedStream<B>),
}

/// Answers one request for a model file: from disk when it is cached, otherwise from `origin`, written as it streams.
/// `token` names the partial file; the caller supplies it so tests stay deterministic.
pub async fn serve_model_file<C: HttpClient>(
    root: &Path,
    relative: &str,
    origin: &str,
    client: &C,
    token: &str,
) -> Result<Served<C::Body>, CacheError> {
    if relative.is_empty() {
        return Ok(Served::BadRequest);
    }
    let Some(target) = cached_path(root, relative) else {
        return Ok(Served::BadRequest);
    };
    let name = basename(relative).to_owned();
    if target.exists() {
        let size = fs::metadata(&target)?.len();
        debug!(target: "engine.models", file = %name, size, "served from cache");
        return Ok(Served::Cached { path: target, size });
    }

    info!(target: "engine.models", file = %name, "fetch started");
    let url = format!("{origin}/{relative}");
    let reply: Reply<C::Body> = fetch_following(client, &url).await?;
    info!(target: "engine.models", file = %name, status = reply.status, "fetch connected");
    if !(200..300).contains(&reply.status) {
        warn!(target: "engine.models", file = %name, status = reply.status, "fetch refused");
        return Ok(Served::UpstreamFailed {
            status: reply.status,
        });
    }
    let size = reply
        .header("content-length")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|size| *size > 0);
    let writer = CacheWriter::begin(&target, token)?;
    Ok(Served::Fetched(CachedStream {
        body: reply.body,
        writer: Some(writer),
        size,
        name,
        started: Instant::now(),
        last_decile: -1,
    }))
}

/// The answer for `url` after following its redirects, as `fetch` does: a 3xx with a location is followed, up to a limit.
async fn fetch_following<C: HttpClient>(
    client: &C,
    url: &str,
) -> Result<Reply<C::Body>, CacheError> {
    let mut current = url.to_owned();
    let mut hops = 0;
    loop {
        let reply = client.get(&current, &[], None).await?;
        let location = reply
            .header("location")
            .filter(|value| !value.is_empty())
            .filter(|_| matches!(reply.status, 301 | 302 | 303 | 307 | 308));
        let Some(location) = location else {
            return Ok(reply);
        };
        if hops == MAX_REDIRECTS {
            return Err(CacheError::TooManyRedirects);
        }
        current = Url::parse(&current)
            .ok()
            .and_then(|base| base.join(location).ok())
            .map(String::from)
            .ok_or(CacheError::BadRedirect)?;
        hops += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_that_climbs_out_of_the_cache_is_refused() {
        assert_eq!(cached_path(Path::new("/c"), "../escape"), None);
        assert_eq!(cached_path(Path::new("/c"), "a/../../escape"), None);
        let root = std::path::absolute("/c").expect("root resolves");
        assert_eq!(cached_path(Path::new("/c"), "a/../b"), Some(root.join("b")));
        assert_eq!(cached_path(Path::new("/c"), ""), None);
    }

    #[test]
    fn a_relative_root_is_made_absolute_like_the_reference_does() {
        let joined = cached_path(Path::new("cache"), "a/b.gguf");
        assert!(joined.is_some_and(|path| path.is_absolute() && path.ends_with("cache/a/b.gguf")));
    }

    #[test]
    fn json_and_text_get_their_own_types() {
        let headers = model_file_headers("x/config.JSON", None);
        assert_eq!(headers["Content-Type"], "application/json");
        assert!(!headers.contains_key("Content-Length"));
    }
}
