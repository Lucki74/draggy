//! Resumable downloads of GGUF files into the models folder. Port of electron/modelStorage.cjs (downloadGgufModel and
//! cancelDownloadGgufModel). The network, the clock, the pause and the disk come in through traits, so tests run on fakes.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::future::Future;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_web::policy::UrlPolicy;
use tokio::sync::{broadcast, watch};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::js::{round, string_to_number, to_fixed_number};
use crate::shards::basename;

/// A connection that sends nothing for this long counts as stalled; the partial is kept to continue from.
pub const STALL_LIMIT: Duration = Duration::from_secs(60);
/// A partial older than this is left from another upload of the file, so it is not continued.
const PARTIAL_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_REDIRECTS: u32 = 5;
const RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_millis(1500);
const TEMP_SUFFIX: &str = ".download";
const PROGRESS_INTERVAL_MS: u64 = 100;
const SPEED_SAMPLE_MS: u64 = 500;
/// Progress a joined caller may fall this far behind by before the oldest events are dropped.
const PROGRESS_BUFFER: usize = 1024;
/// What a body cut short reads as, whatever the transport said: the reference reports a closed connection this way.
const CLOSED_EARLY: &str = "The connection closed before the download finished";
static CONTENT_RANGE: LazyLock<Option<fancy_regex::Regex>> =
    LazyLock::new(|| fancy_regex::Regex::new(r"(?i)bytes\s+[0-9]+-[0-9]+/([0-9]+)").ok());

/// A failure before any answer, or a body cut short. The fakes in tests produce these too.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct TransportError {
    pub message: String,
    pub timed_out: bool,
}

impl TransportError {
    pub fn timeout() -> Self {
        Self {
            message: "timed out".to_owned(),
            timed_out: true,
        }
    }
}

/// The body of an answer, read one chunk at a time so a large file never sits in memory whole.
pub trait Body: Send {
    fn next_chunk(
        &mut self,
    ) -> impl Future<Output = Result<Option<Vec<u8>>, TransportError>> + Send;
}

/// The status, the headers (lowercase names) and the body of one answer.
#[derive(Debug)]
pub struct Reply<B> {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: B,
}

impl<B> Reply<B> {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// One GET. Redirects are not followed here: the caller checks each hop against the URL policy.
pub trait HttpClient: Send + Sync {
    type Body: Body;

    fn get(
        &self,
        url: &str,
        headers: &[(String, String)],
        stall: Option<Duration>,
    ) -> impl Future<Output = Result<Reply<Self::Body>, TransportError>> + Send;
}

/// Time, pausing and disk space. Tests pass a clock they move by hand and a pause that returns at once.
pub trait Env: Send + Sync {
    fn now_ms(&self) -> u64;
    fn pause(&self, delay: Duration) -> impl Future<Output = ()> + Send;
    fn free_bytes(&self, dir: &Path) -> Option<u64>;
}

/// Reads one whole body into memory, for the small JSON answers of the model hub.
pub async fn read_all<B: Body>(body: &mut B) -> Result<Vec<u8>, TransportError> {
    let mut out = Vec::new();
    while let Some(chunk) = body.next_chunk().await? {
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// An OS count widened to 64 bits; the widths differ between platforms.
fn widen<T: TryInto<u64>>(count: T) -> Option<u64> {
    count.try_into().ok()
}

/// The real clock, pause and disk.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemEnv;

impl Env for SystemEnv {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            })
    }

    async fn pause(&self, delay: Duration) {
        tokio::time::sleep(delay).await;
    }

    fn free_bytes(&self, dir: &Path) -> Option<u64> {
        let stats = nix::sys::statvfs::statvfs(dir).ok()?;
        Some(widen(stats.blocks_available())?.saturating_mul(widen(stats.block_size())?))
    }
}

/// The reqwest client. It follows no redirects, so the caller applies the URL policy to every hop.
#[derive(Debug, Clone)]
pub struct ReqwestClient {
    client: reqwest::Client,
}

impl ReqwestClient {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { client })
    }
}

fn transport_error(error: reqwest::Error) -> TransportError {
    TransportError {
        message: error.to_string(),
        timed_out: error.is_timeout(),
    }
}

impl HttpClient for ReqwestClient {
    type Body = ReqwestBody;

    async fn get(
        &self,
        url: &str,
        headers: &[(String, String)],
        stall: Option<Duration>,
    ) -> Result<Reply<ReqwestBody>, TransportError> {
        let mut request = self.client.get(url);
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }
        let response = match stall {
            Some(limit) => match tokio::time::timeout(limit, request.send()).await {
                Ok(sent) => sent.map_err(transport_error)?,
                Err(_) => return Err(TransportError::timeout()),
            },
            None => request.send().await.map_err(transport_error)?,
        };
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned()))
            })
            .collect();
        Ok(Reply {
            status,
            headers,
            body: ReqwestBody { response, stall },
        })
    }
}

/// A reqwest response body, read chunk by chunk under the stall limit.
#[derive(Debug)]
pub struct ReqwestBody {
    response: reqwest::Response,
    stall: Option<Duration>,
}

impl Body for ReqwestBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        let chunk = match self.stall {
            Some(limit) => match tokio::time::timeout(limit, self.response.chunk()).await {
                Ok(chunk) => chunk.map_err(transport_error)?,
                Err(_) => return Err(TransportError::timeout()),
            },
            None => self.response.chunk().await.map_err(transport_error)?,
        };
        Ok(chunk.map(|bytes| bytes.to_vec()))
    }
}

/// Stops a download from its next wait on. Shared between the download and whoever cancels it, and awaitable,
/// so a connection still opening is abandoned rather than waited on.
#[derive(Debug, Clone)]
pub struct Cancel(Arc<watch::Sender<bool>>);

impl Default for Cancel {
    fn default() -> Self {
        Self::new()
    }
}

impl Cancel {
    pub fn new() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }

    pub fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    async fn cancelled(&self) {
        let mut signal = self.0.subscribe();
        let _ = signal.wait_for(|set| *set).await;
    }
}

/// One file to fetch into the models folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadRequest {
    pub url: String,
    pub models_dir: PathBuf,
    pub filename: String,
    /// Image models keep the name they have; GGUF names get a `.gguf` suffix when they lack one.
    pub keep_extension: bool,
    pub max_redirects: u32,
    pub stall: Duration,
    pub retries: u32,
    pub retry_delay: Duration,
    /// The id the screen gave this download, written on the start and finish logs so the two can be matched.
    pub cid: Option<String>,
}

impl DownloadRequest {
    pub fn new(
        url: impl Into<String>,
        models_dir: impl Into<PathBuf>,
        filename: impl Into<String>,
    ) -> Self {
        Self {
            url: url.into(),
            models_dir: models_dir.into(),
            filename: filename.into(),
            keep_extension: false,
            max_redirects: MAX_REDIRECTS,
            stall: STALL_LIMIT,
            retries: RETRIES,
            retry_delay: RETRY_DELAY,
            cid: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Preparing,
    Downloading,
    Done,
}

/// One progress event. `remaining_seconds` is None until a speed sample exists.
#[derive(Debug, Clone, PartialEq)]
pub struct Progress {
    pub phase: Phase,
    pub completed: u64,
    pub total: u64,
    pub percent: f64,
    pub remaining_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Downloaded {
    pub path: PathBuf,
    pub filename: String,
}

/// Cloneable, so every caller joined to one download gets the same failure the owner got.
#[derive(Debug, Clone, thiserror::Error)]
pub enum DownloadError {
    #[error("URL refused by outbound security policy")]
    Refused,
    #[error("Too many redirects")]
    TooManyRedirects,
    #[error("Redirect URL refused by security policy")]
    RedirectRefused,
    #[error("Server returned HTTP {0}")]
    Status(u16),
    #[error("The download stalled: no data for {0} seconds")]
    Stalled(u64),
    #[error("{0}")]
    Network(String),
    #[error("Received {completed} of {total} bytes")]
    Short { completed: u64, total: u64 },
    #[error("The file is larger than the server said")]
    TooLarge,
    #[error("Download cancelled")]
    Cancelled,
    #[error("{0}")]
    Io(Arc<io::Error>),
}

impl From<io::Error> for DownloadError {
    fn from(err: io::Error) -> Self {
        Self::Io(Arc::new(err))
    }
}

impl DownloadError {
    /// A dropped, stalled or short connection: the bytes on disk are kept and the transfer carries on from them.
    fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::Stalled(_) | Self::Network(_) | Self::Short { .. }
        )
    }
}

/// The GGUF file name a download is saved under: the basename, with `.gguf` added when it has none.
pub fn safe_gguf_name(filename: &str, keep_extension: bool) -> String {
    let base = basename(filename);
    if keep_extension || base.ends_with(".gguf") {
        base.to_owned()
    } else {
        format!("{base}.gguf")
    }
}

/// The partial file beside a download's final name; it takes the final name only once complete.
pub fn temp_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(TEMP_SUFFIX);
    PathBuf::from(name)
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn host_of(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) => match (parsed.host_str(), parsed.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_owned(),
            _ => "invalid".to_owned(),
        },
        Err(_) => "invalid".to_owned(),
    }
}

/// The owner and repo a Hugging Face resolve URL names, the way the reference's log reads them.
fn repo_of(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let parts: Vec<&str> = parsed.path().split('/').collect();
    match parts.as_slice() {
        ["", owner, name, "resolve", _, ..] if !owner.is_empty() && !name.is_empty() => {
            Some(format!("{owner}/{name}"))
        }
        _ => None,
    }
}

fn millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

/// The percent shown for a transfer, rounded to one decimal the way the reference's `toFixed(1)` rounds it.
fn progress_percent(completed: u64, total: u64) -> f64 {
    if total > 0 {
        to_fixed_number(completed as f64 / total as f64 * 100.0, 1)
    } else {
        0.0
    }
}

/// Whole seconds for the stall message: the reference rounds the limit in milliseconds to seconds.
fn stall_seconds(stall: Duration) -> u64 {
    round(stall.as_secs_f64()) as u64
}

fn transport_failure(error: TransportError, stall: Duration) -> DownloadError {
    if error.timed_out {
        DownloadError::Stalled(stall_seconds(stall))
    } else {
        DownloadError::Network(error.message)
    }
}

/// A body error is reported as a closed connection, whatever the transport said, as the reference does.
// TS quirk: the reference words every cut-off body as a closed connection, so the message is kept even for other causes.
fn body_failure(error: TransportError, stall: Duration) -> DownloadError {
    if error.timed_out {
        DownloadError::Stalled(stall_seconds(stall))
    } else {
        DownloadError::Network(CLOSED_EARLY.to_owned())
    }
}

/// The `Content-Range` total: the number after the slash in `bytes a-b/total`, found anywhere in the header as the reference's regex does.
fn content_range_total(value: Option<&str>) -> Option<u64> {
    let captures = CONTENT_RANGE.as_ref()?.captures(value?).ok()??;
    captures
        .get(1)?
        .as_str()
        .parse::<u64>()
        .ok()
        .filter(|total| *total > 0)
}

/// `Number(header) || 0` for a Content-Length value.
fn content_length(value: Option<&str>) -> u64 {
    let number = value.map_or(0.0, string_to_number);
    if number.is_finite() && number > 0.0 {
        number.min(u64::MAX as f64) as u64
    } else {
        0
    }
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |meta| meta.len())
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

/// Removes a partial that a cancel or a failure left behind. A file that cannot be removed is logged, not raised.
fn remove_quietly(path: &Path) {
    if let Err(err) = remove_if_present(path) {
        warn!(target: "engine.models", file = %basename_of(path), reason = %err, "partial file not removed");
    }
}

/// The transfer state that feeds progress events: the speed sample, its smoothing and the last event sent.
struct Meter {
    total: u64,
    sample_at: u64,
    sample_bytes: u64,
    smoothed: f64,
    emitted_at: Option<u64>,
}

impl Meter {
    fn new(now: u64, base: u64, total: u64) -> Self {
        Self {
            total,
            sample_at: now,
            sample_bytes: base,
            smoothed: 0.0,
            emitted_at: None,
        }
    }

    fn observe<P: FnMut(Progress)>(&mut self, now: u64, completed: u64, emit: &mut P) {
        let percent = progress_percent(completed, self.total);
        if now.saturating_sub(self.sample_at) >= SPEED_SAMPLE_MS {
            let elapsed = (now - self.sample_at) as f64;
            let sample = (completed - self.sample_bytes) as f64 * 1000.0 / elapsed;
            // The first sample seeds the average, so the estimate never starts from zero.
            self.smoothed = if self.smoothed > 0.0 {
                0.7 * self.smoothed + 0.3 * sample
            } else {
                sample
            };
            self.sample_at = now;
            self.sample_bytes = completed;
        }
        let due = self
            .emitted_at
            .is_none_or(|at| now.saturating_sub(at) >= PROGRESS_INTERVAL_MS);
        if due || percent == 100.0 {
            self.emitted_at = Some(now);
            emit(Progress {
                phase: Phase::Downloading,
                completed,
                total: self.total,
                percent,
                remaining_seconds: self.remaining(completed),
            });
        }
    }

    fn remaining(&self, completed: u64) -> Option<u64> {
        if self.total > 0 && completed >= self.total {
            Some(0)
        } else if self.total > completed && self.smoothed > 0.0 {
            let seconds = round((self.total - completed) as f64 / self.smoothed);
            Some(seconds.max(0.0) as u64)
        } else {
            None
        }
    }
}

/// What a finished transfer left on disk.
struct Transferred {
    completed: u64,
    total: u64,
}

/// When the download started and how many bytes it found on disk, for the finish log and the average speed.
#[derive(Clone, Copy)]
struct Timing<'a> {
    started: u64,
    resumed_from: u64,
    cid: Option<&'a str>,
}

/// One download in flight: its cancel switch, the progress it reports to joined callers, and its outcome once it ends.
struct Active {
    cancel: Cancel,
    progress: broadcast::Sender<Progress>,
    outcome: watch::Sender<Option<Result<Downloaded, DownloadError>>>,
}

impl Active {
    fn new() -> Self {
        Self {
            cancel: Cancel::new(),
            progress: broadcast::channel(PROGRESS_BUFFER).0,
            outcome: watch::channel(None).0,
        }
    }
}

/// Settles a download's registry entry once, so every joined caller gets the result. Dropped unsettled, it reads as a cancel.
struct Settle<'a, C: HttpClient, E: Env> {
    owner: &'a Downloader<C, E>,
    dest: PathBuf,
    entry: Arc<Active>,
    settled: bool,
}

impl<C: HttpClient, E: Env> Settle<'_, C, E> {
    fn settle(&mut self, result: Result<Downloaded, DownloadError>) {
        self.owner.release(&self.dest, &self.entry);
        self.entry.outcome.send_replace(Some(result));
        self.settled = true;
    }
}

impl<C: HttpClient, E: Env> Drop for Settle<'_, C, E> {
    fn drop(&mut self) {
        if !self.settled {
            self.settle(Err(DownloadError::Cancelled));
        }
    }
}

/// Follows a download another caller started: its progress reaches this caller and its outcome becomes this caller's.
async fn join(
    entry: Arc<Active>,
    mut on_progress: impl FnMut(Progress),
) -> Result<Downloaded, DownloadError> {
    let mut progress = entry.progress.subscribe();
    let mut outcome = entry.outcome.subscribe();
    let mut progress_open = true;
    loop {
        // Events already sent come first, so a joiner that arrives late still hears each one before the outcome.
        match progress.try_recv() {
            Ok(update) => {
                on_progress(update);
                continue;
            }
            Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
            Err(broadcast::error::TryRecvError::Closed) => progress_open = false,
            Err(broadcast::error::TryRecvError::Empty) => {}
        }
        if let Some(result) = outcome.borrow_and_update().clone() {
            return result;
        }
        tokio::select! {
            biased;
            event = progress.recv(), if progress_open => match event {
                Ok(update) => on_progress(update),
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => progress_open = false,
            },
            changed = outcome.changed() => {
                if changed.is_err() {
                    return Err(DownloadError::Cancelled);
                }
            }
        }
    }
}

/// Downloads GGUF files, one transfer per destination, and cancels them. Holds the registry of running downloads.
pub struct Downloader<C, E> {
    client: C,
    env: E,
    policy: Mutex<UrlPolicy>,
    active: Mutex<HashMap<PathBuf, Arc<Active>>>,
}

impl<C: HttpClient, E: Env> Downloader<C, E> {
    pub fn new(client: C, env: E) -> Self {
        Self {
            client,
            env,
            policy: Mutex::new(UrlPolicy::new()),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn allowed(&self, url: &str) -> bool {
        locked(&self.policy).is_fetchable_url(url, false)
    }

    /// The running download of `dest` when there is one (joined = true), otherwise a new entry the caller now owns.
    fn claim(&self, dest: &Path) -> (Arc<Active>, bool) {
        let mut active = locked(&self.active);
        if let Some(held) = active.get(dest) {
            return (Arc::clone(held), true);
        }
        let entry = Arc::new(Active::new());
        active.insert(dest.to_path_buf(), Arc::clone(&entry));
        (entry, false)
    }

    /// Frees the slot only when it still belongs to this download, so a later one for the same file keeps its own.
    fn release(&self, dest: &Path, entry: &Arc<Active>) {
        let mut active = locked(&self.active);
        if active
            .get(dest)
            .is_some_and(|held| Arc::ptr_eq(held, entry))
        {
            active.remove(dest);
        }
    }

    /// Downloads one file, continuing a partial from an earlier try. A second call for a file already downloading
    /// joins it: it hears the same progress and gets the same outcome.
    pub async fn download(
        &self,
        req: DownloadRequest,
        mut on_progress: impl FnMut(Progress) + Send,
    ) -> Result<Downloaded, DownloadError> {
        if !self.allowed(&req.url) {
            warn!(target: "engine.models", host = %host_of(&req.url), "download refused by url policy");
            return Err(DownloadError::Refused);
        }
        let safe = safe_gguf_name(&req.filename, req.keep_extension);
        let dest = req.models_dir.join(&safe);
        let temp = temp_path(&dest);
        let (entry, joined) = self.claim(&dest);
        if joined {
            return join(entry, on_progress).await;
        }
        let mut settle = Settle {
            owner: self,
            dest: dest.clone(),
            entry: Arc::clone(&entry),
            settled: false,
        };
        let mut sink = |progress: Progress| {
            // Nobody joined is not an error: the send only reaches callers that are listening.
            let _ = entry.progress.send(progress.clone());
            on_progress(progress);
        };
        let result = self.run(&req, &safe, &dest, &temp, &entry, &mut sink).await;
        settle.settle(result.clone());
        result
    }

    async fn run<P: FnMut(Progress)>(
        &self,
        req: &DownloadRequest,
        safe: &str,
        dest: &Path,
        temp: &Path,
        entry: &Arc<Active>,
        on_progress: &mut P,
    ) -> Result<Downloaded, DownloadError> {
        fs::create_dir_all(&req.models_dir)?;
        info!(
            target: "engine.models",
            cid = ?req.cid,
            file = safe,
            repo = repo_of(&req.url).as_deref(),
            host = %host_of(&req.url),
            free_bytes = ?self.env.free_bytes(&req.models_dir),
            "download started"
        );
        let started = self.env.now_ms();
        let mut resume_from = partial_to_continue(temp, started)?;
        let timing = Timing {
            started,
            resumed_from: resume_from,
            cid: req.cid.as_deref(),
        };
        let mut retries_left = req.retries;
        on_progress(Progress {
            phase: Phase::Preparing,
            completed: 0,
            total: 0,
            percent: 0.0,
            remaining_seconds: None,
        });
        loop {
            match self
                .transfer(
                    req,
                    safe,
                    temp,
                    &entry.cancel,
                    &mut resume_from,
                    on_progress,
                )
                .await
            {
                Ok(done) => {
                    return self.finish(entry, safe, dest, temp, done, timing, on_progress);
                }
                Err(err) => {
                    if entry.cancel.is_cancelled() {
                        return Err(DownloadError::Cancelled);
                    }
                    if !err.is_transient() || retries_left == 0 {
                        error!(target: "engine.models", file = safe, resume_from, reason = %err, "download failed");
                        return Err(err);
                    }
                    retries_left -= 1;
                    resume_from = file_len(temp);
                    warn!(
                        target: "engine.models",
                        file = safe,
                        resume_from,
                        retries_left,
                        reason = %err,
                        "download interrupted, resuming"
                    );
                    tokio::select! {
                        biased;
                        () = entry.cancel.cancelled() => return Err(DownloadError::Cancelled),
                        () = self.env.pause(req.retry_delay) => {}
                    }
                }
            }
        }
    }

    /// Asks for the file from `req.url`, following redirects. A server that refuses the partial's range starts over.
    async fn open(
        &self,
        req: &DownloadRequest,
        temp: &Path,
        cancel: &Cancel,
        resume_from: &mut u64,
    ) -> Result<Reply<C::Body>, DownloadError> {
        let mut url = req.url.clone();
        let mut redirects_left = i64::from(req.max_redirects);
        loop {
            if redirects_left < 0 {
                error!(target: "engine.models", host = %host_of(&req.url), "download failed: too many redirects");
                return Err(DownloadError::TooManyRedirects);
            }
            let headers = if *resume_from > 0 {
                vec![("Range".to_owned(), format!("bytes={resume_from}-"))]
            } else {
                Vec::new()
            };
            let reply = tokio::select! {
                biased;
                () = cancel.cancelled() => return Err(DownloadError::Cancelled),
                answer = self.client.get(&url, &headers, Some(req.stall)) => {
                    answer.map_err(|err| transport_failure(err, req.stall))?
                }
            };

            // An empty Location is no redirect, as the reference reads a falsy header.
            let location = reply
                .header("location")
                .filter(|value| !value.is_empty())
                .filter(|_| (300..400).contains(&reply.status));
            if let Some(location) = location {
                let next = Url::parse(&url)
                    .ok()
                    .and_then(|base| base.join(location).ok())
                    .map(String::from)
                    .ok_or(DownloadError::RedirectRefused)?;
                info!(target: "engine.models", host = %host_of(&next), redirects_left, "download redirected");
                if !self.allowed(&next) {
                    warn!(target: "engine.models", host = %host_of(&next), "redirect refused by url policy");
                    return Err(DownloadError::RedirectRefused);
                }
                url = next;
                redirects_left -= 1;
                continue;
            }

            // The partial is not one this server can continue: start the file over.
            if reply.status == 416 && *resume_from > 0 {
                remove_if_present(temp)?;
                *resume_from = 0;
                url = req.url.clone();
                redirects_left = i64::from(req.max_redirects);
                continue;
            }

            if reply.status != 200 && reply.status != 206 {
                error!(target: "engine.models", status = reply.status, host = %host_of(&url), "download refused by server");
                return Err(DownloadError::Status(reply.status));
            }
            return Ok(reply);
        }
    }

    /// One attempt: the answer's body is streamed into the partial file, with progress as it goes.
    async fn transfer<P: FnMut(Progress)>(
        &self,
        req: &DownloadRequest,
        safe: &str,
        temp: &Path,
        cancel: &Cancel,
        resume_from: &mut u64,
        on_progress: &mut P,
    ) -> Result<Transferred, DownloadError> {
        let reply = self.open(req, temp, cancel, resume_from).await?;
        let resumed = reply.status == 206 && *resume_from > 0;
        let offset = if resumed { *resume_from } else { 0 };
        let length = content_length(reply.header("content-length"));
        // A server that ignores Range answers 200 with the whole file; what was kept no longer counts.
        let total = if resumed {
            content_range_total(reply.header("content-range")).unwrap_or(if length > 0 {
                offset.saturating_add(length)
            } else {
                0
            })
        } else {
            length
        };
        let mut file = if resumed {
            OpenOptions::new().append(true).create(true).open(temp)?
        } else {
            File::create(temp)?
        };
        // A cancel that landed while the file was being created found nothing to remove; the file is ours to remove.
        if cancel.is_cancelled() {
            drop(file);
            remove_quietly(temp);
            return Err(DownloadError::Cancelled);
        }
        info!(
            target: "engine.models",
            file = safe,
            status = reply.status,
            bytes = total,
            resumed,
            from = offset,
            "download connected"
        );

        let mut body = reply.body;
        let mut completed = offset;
        let mut meter = Meter::new(self.env.now_ms(), offset, total);
        let mut logged_percent = -1.0_f64;
        loop {
            let next = tokio::select! {
                biased;
                () = cancel.cancelled() => {
                    // Closed before it is removed: a handle still open cannot be unlinked on every platform.
                    drop(file);
                    remove_quietly(temp);
                    return Err(DownloadError::Cancelled);
                }
                chunk = body.next_chunk() => chunk,
            };
            let Some(chunk) = next.map_err(|err| body_failure(err, req.stall))? else {
                break;
            };
            file.write_all(&chunk)?;
            completed = completed.saturating_add(chunk.len() as u64);
            meter.observe(self.env.now_ms(), completed, on_progress);
            let percent = progress_percent(completed, total);
            if percent >= logged_percent + 10.0 || percent == 100.0 {
                logged_percent = percent.floor();
                debug!(target: "engine.models", file = safe, percent, completed, total, "download progress");
            }
        }
        drop(file);
        // A cancel that lands on the last chunk still wins: the file must not take its final name.
        if cancel.is_cancelled() {
            remove_quietly(temp);
            return Err(DownloadError::Cancelled);
        }

        // Verification: the bytes must match the length the server promised. There is no published checksum to compare.
        if total > 0 && completed != total {
            if completed < total {
                return Err(DownloadError::Short { completed, total });
            }
            remove_if_present(temp)?;
            return Err(DownloadError::TooLarge);
        }
        Ok(Transferred { completed, total })
    }

    #[allow(clippy::too_many_arguments)]
    fn finish<P: FnMut(Progress)>(
        &self,
        entry: &Arc<Active>,
        safe: &str,
        dest: &Path,
        temp: &Path,
        done: Transferred,
        timing: Timing<'_>,
        on_progress: &mut P,
    ) -> Result<Downloaded, DownloadError> {
        // The slot is freed under the lock a cancel takes, so a cancel either stops this file or finds it installed.
        {
            let mut active = locked(&self.active);
            if entry.cancel.is_cancelled() {
                return Err(DownloadError::Cancelled);
            }
            if active
                .get(dest)
                .is_some_and(|held| Arc::ptr_eq(held, entry))
            {
                active.remove(dest);
            }
        }
        if dest.exists() {
            fs::remove_file(dest)?;
        }
        fs::rename(temp, dest)?;
        info!(target: "engine.models", file = safe, "no published checksum");
        let duration = self.env.now_ms().saturating_sub(timing.started);
        let gained = done.completed.saturating_sub(timing.resumed_from);
        let avg_bytes_per_sec = round(gained as f64 * 1000.0 / duration.max(1) as f64) as u64;
        info!(
            target: "engine.models",
            cid = ?timing.cid,
            file = safe,
            bytes = done.completed,
            resumed_from = timing.resumed_from,
            dur_ms = duration,
            avg_bytes_per_sec,
            "download finished"
        );
        let total = if done.total > 0 {
            done.total
        } else {
            done.completed
        };
        on_progress(Progress {
            phase: Phase::Done,
            completed: done.completed,
            total,
            percent: 100.0,
            remaining_seconds: Some(0),
        });
        Ok(Downloaded {
            path: dest.to_path_buf(),
            filename: safe.to_owned(),
        })
    }

    /// Stops the download of this file if one runs, and removes what it left behind. An installed model is only
    /// removed when a download was replacing it, never on a stray cancel.
    pub fn cancel(&self, models_dir: &Path, filename: &str, keep_extension: bool) {
        let safe = safe_gguf_name(filename, keep_extension);
        let dest = models_dir.join(&safe);
        let temp = temp_path(&dest);
        let active = {
            let mut registry = locked(&self.active);
            let found = registry.remove(&dest);
            if let Some(entry) = &found {
                entry.cancel.cancel();
            }
            found
        };
        info!(target: "engine.models", file = %safe, active = active.is_some(), "download cancel requested");
        let files = if active.is_some() {
            vec![temp, dest]
        } else {
            vec![temp]
        };
        for file in files {
            remove_quietly(&file);
        }
    }
}

fn basename_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The bytes of an earlier partial, when it is young enough to continue; an old or empty one is cleared.
fn partial_to_continue(temp: &Path, now: u64) -> io::Result<u64> {
    let Ok(meta) = fs::metadata(temp) else {
        return Ok(0);
    };
    let size = meta.len();
    if size == 0 {
        return Ok(0);
    }
    let modified = meta.modified().map_or(0, millis);
    let age = i128::from(now) - i128::try_from(modified).unwrap_or(i128::MAX);
    if age < i128::from(PARTIAL_MAX_AGE_MS) {
        Ok(size)
    } else {
        remove_if_present(temp)?;
        Ok(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_without_the_suffix_gets_it() {
        assert_eq!(safe_gguf_name("model", false), "model.gguf");
        assert_eq!(safe_gguf_name("dir/model.gguf", false), "model.gguf");
        assert_eq!(
            safe_gguf_name("model.safetensors", true),
            "model.safetensors"
        );
        assert_eq!(safe_gguf_name("MODEL.GGUF", false), "MODEL.GGUF.gguf");
    }

    #[test]
    fn the_partial_sits_beside_the_final_name() {
        assert_eq!(
            temp_path(Path::new("/m/a.gguf")),
            PathBuf::from("/m/a.gguf.download")
        );
    }

    #[test]
    fn content_range_totals_are_read_after_the_slash() {
        assert_eq!(
            content_range_total(Some("bytes 4000-9999/10000")),
            Some(10000)
        );
        assert_eq!(content_range_total(Some("bytes */10000")), None);
        assert_eq!(content_range_total(None), None);
    }

    #[test]
    fn content_range_needs_no_anchor_and_no_space_after_bytes_is_refused() {
        assert_eq!(content_range_total(Some("foo bytes 1-2/30")), Some(30));
        assert_eq!(content_range_total(Some("bytes1-2/30")), None);
    }

    #[test]
    fn progress_rounds_to_one_decimal_like_to_fixed() {
        assert_eq!(progress_percent(1, 3), 33.3);
        assert_eq!(progress_percent(0, 0), 0.0);
    }

    #[test]
    fn a_repo_is_read_from_a_resolve_url_only() {
        assert_eq!(
            repo_of("https://huggingface.co/acme/Model-GGUF/resolve/main/model.gguf"),
            Some("acme/Model-GGUF".to_owned())
        );
        assert_eq!(repo_of("https://huggingface.co/acme/Model-GGUF"), None);
    }
}
