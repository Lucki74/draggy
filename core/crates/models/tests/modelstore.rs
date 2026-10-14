//! Golden fixtures in `shared/fixtures/modelstore`, run through the port as `src/__tests__/fixtures/modelstore.test.ts` runs them
//! through the reference. Plus fake-backed tests for the download, the models folder and the cache. No test touches the network.

use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::future::Future;
use std::path::Path;
use std::pin::{Pin, pin};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_models::download::{
    Body, DownloadError, DownloadRequest, Downloaded, Downloader, Env, HttpClient, Phase, Progress,
    Reply, TransportError, temp_path,
};
use draggy_models::huggingface::{HuggingFace, extract_available_sizes, type_of_task};
use draggy_models::mmproj::Projectors;
use draggy_models::model_cache::{
    CacheError, Served, cached_path, model_file_headers, serve_model_file,
};
use draggy_models::model_storage::{CapabilityCache, delete_gguf_model, list_gguf_models};
use draggy_testkit::{cases, files, posix_path};
use serde_json::{Value, json};

// ---- helpers --------------------------------------------------------------------------------------------------------

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Polls two futures in turns until both finish, so one can join or cancel the other while it waits on the wire.
fn block_on_both<A: Future, B: Future>(first: A, second: B) -> (A::Output, B::Output) {
    let mut first = pin!(first);
    let mut second = pin!(second);
    let mut context = Context::from_waker(Waker::noop());
    let (mut first_out, mut second_out) = (None, None);
    for _ in 0..1_000_000 {
        if first_out.is_none()
            && let Poll::Ready(value) = first.as_mut().poll(&mut context)
        {
            first_out = Some(value);
        }
        if second_out.is_none()
            && let Poll::Ready(value) = second.as_mut().poll(&mut context)
        {
            second_out = Some(value);
        }
        match (first_out, second_out) {
            (Some(a), Some(b)) => return (a, b),
            (a, b) => {
                first_out = a;
                second_out = b;
            }
        }
    }
    panic!("the futures never finished");
}

/// Polls a future that never waits on a real resource, so it finishes on the first poll or the next.
fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    for _ in 0..1_000_000 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
    panic!("the future never finished");
}

/// Whole numbers become decimal strings, the same rule the TypeScript runner applies to the reference's output.
fn canon(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(n) if n.fract() == 0.0 => {
                if n == 0.0 {
                    Value::String("0".to_owned())
                } else {
                    Value::String(format!("{n:.0}"))
                }
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(canon).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, canon(item)))
                .collect(),
        ),
        other => other,
    }
}

fn transport(message: &str) -> TransportError {
    TransportError {
        message: message.to_owned(),
        timed_out: false,
    }
}

// ---- the fixture runner ----------------------------------------------------------------------------------------------

/// A hub that answers from rules, the first whose `match` is in the URL; a rule with `times` answers that many times.
struct RuleHub {
    rules: Mutex<Vec<(Value, u64)>>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl RuleHub {
    fn new(rules: &Value) -> (Self, Arc<Mutex<Vec<String>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let rules = rules
            .as_array()
            .map(|list| list.iter().cloned().map(|rule| (rule, 0)).collect())
            .unwrap_or_default();
        (
            Self {
                rules: Mutex::new(rules),
                calls: Arc::clone(&calls),
            },
            calls,
        )
    }

    fn answer(&self, url: &str) -> Result<Reply<JsonBody>, TransportError> {
        locked(&self.calls).push(url.to_owned());
        let mut rules = locked(&self.rules);
        let found = rules.iter_mut().find(|(rule, used)| {
            let matches = rule["match"]
                .as_str()
                .is_some_and(|needle| url.contains(needle));
            let limit = rule["times"].as_u64();
            matches && limit.is_none_or(|limit| *used < limit)
        });
        let Some((rule, used)) = found else {
            return Err(transport("offline"));
        };
        *used += 1;
        if let Some(message) = rule["error"].as_str() {
            return Err(transport(message));
        }
        let mut headers = BTreeMap::new();
        if let Some(link) = rule["link"].as_str() {
            headers.insert("link".to_owned(), link.to_owned());
        }
        let status = u16::try_from(rule["status"].as_u64().unwrap_or(200)).unwrap_or(500);
        let body = serde_json::to_vec(&rule["json"]).unwrap_or_default();
        Ok(Reply {
            status,
            headers,
            body: JsonBody { body: Some(body) },
        })
    }
}

/// One JSON answer, delivered as a single chunk.
struct JsonBody {
    body: Option<Vec<u8>>,
}

impl Body for JsonBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        Ok(self.body.take())
    }
}

impl HttpClient for RuleHub {
    type Body = JsonBody;

    async fn get(
        &self,
        url: &str,
        _headers: &[(String, String)],
        _stall: Option<Duration>,
    ) -> Result<Reply<JsonBody>, TransportError> {
        self.answer(url)
    }
}

/// Runs the ops in order on one fresh model hub, recording each op's result and the URLs it fetched.
fn run_flow(input: &Value) -> Vec<Value> {
    let (hub, calls) = RuleHub::new(&input["responses"]);
    let huggingface = HuggingFace::new(hub);
    let now_ms = 1_800_000_000_000;
    let mut results = Vec::new();
    for op in input["ops"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let before = locked(&calls).len();
        let args = op["args"].as_array().map(Vec::as_slice).unwrap_or_default();
        let arg = |index: usize| args.get(index).and_then(Value::as_str);
        let value = match op["op"].as_str().unwrap_or("") {
            "search" => {
                let models = block_on(huggingface.search(arg(0).unwrap_or(""), now_ms));
                serde_json::to_value(models).unwrap_or(Value::Null)
            }
            "resolve" => {
                let include_draft = args
                    .get(1)
                    .and_then(|options| options["includeDraft"].as_bool())
                    .unwrap_or(false);
                let download =
                    block_on(huggingface.resolve_download(arg(0).unwrap_or(""), include_draft));
                serde_json::to_value(download).unwrap_or(Value::Null)
            }
            "size" => match block_on(
                huggingface.model_size(arg(0).unwrap_or(""), arg(1).unwrap_or("latest")),
            ) {
                Some(bytes) => json!({ "success": true, "bytes": bytes }),
                None => json!({ "success": false, "error": "Size lookup unavailable" }),
            },
            other => panic!("unknown op {other}"),
        };
        let fetches: Vec<String> = locked(&calls)[before..].to_vec();
        results.push(json!({ "value": canon(value), "fetches": fetches }));
    }
    results
}

#[test]
fn fixtures_match_the_typescript_reference() {
    for file in files("modelstore") {
        for case in cases("modelstore", &file) {
            let name = case["name"].as_str().unwrap_or_default().to_owned();
            let input = &case["input"];
            let expected = &case["expected"];
            let actual = match file.as_str() {
                "huggingface-sizes.json" => json!(extract_available_sizes(input)),
                "huggingface-task-types.json" => {
                    json!(type_of_task(input.as_str().unwrap_or_default()))
                }
                "huggingface-flow.json" => Value::Array(run_flow(input)),
                "download-flow.json" => run_downloads(input),
                "model-cache-paths.json" => {
                    let root = input["root"].as_str().unwrap_or_default();
                    let relative = input["relative"].as_str().unwrap_or_default();
                    json!(
                        cached_path(Path::new(root), relative)
                            .map(|path| posix_path(&path.to_string_lossy()))
                    )
                }
                "model-cache-headers.json" => {
                    let relative = input["relative"].as_str().unwrap_or_default();
                    // A missing or NaN length arrives as null or "NaN", and reads as no length.
                    let size = input["size"].as_u64();
                    json!(model_file_headers(relative, size))
                }
                other => panic!("no runner for {other}; add one here"),
            };
            assert_eq!(canon(actual), *expected, "{file}: {name}");
        }
    }
}

// ---- downloads ------------------------------------------------------------------------------------------------------

#[derive(Clone)]
enum Chunk {
    Data(Vec<u8>),
    /// Time that passes with no data, so a test can make the speed estimate move.
    Wait(u64),
    Fail(TransportError),
}

#[derive(Clone)]
struct Scripted {
    status: u16,
    headers: Vec<(String, String)>,
    chunks: Vec<Chunk>,
    /// A connection that never answers, so only a cancel ends the request.
    hang: bool,
    /// A request that fails before any answer, with this message.
    refuse: Option<String>,
}

impl Scripted {
    fn ok(status: u16, headers: Vec<(&'static str, String)>, chunks: Vec<Chunk>) -> Self {
        let headers = headers
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect();
        Self::owned(status, headers, chunks)
    }

    fn owned(status: u16, headers: Vec<(String, String)>, chunks: Vec<Chunk>) -> Self {
        Self {
            status,
            headers,
            chunks,
            hang: false,
            refuse: None,
        }
    }

    fn hang() -> Self {
        Self {
            hang: true,
            ..Self::owned(0, Vec::new(), Vec::new())
        }
    }

    fn refused(message: &str) -> Self {
        Self {
            refuse: Some(message.to_owned()),
            ..Self::owned(0, Vec::new(), Vec::new())
        }
    }
}

/// Pends once, as a real connection does before its answer arrives, so two callers can interleave.
async fn yield_once() {
    let mut yielded = false;
    std::future::poll_fn(|cx| {
        if yielded {
            Poll::Ready(())
        } else {
            yielded = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    })
    .await;
}

/// One request as the client saw it: its URL and headers.
type Request = (String, Vec<(String, String)>);

#[derive(Default)]
struct WireState {
    replies: Mutex<VecDeque<Scripted>>,
    requests: Mutex<Vec<Request>>,
    clock: Arc<AtomicU64>,
}

/// A client that answers each GET with the next scripted reply and records what was asked.
#[derive(Clone, Default)]
struct WireHub {
    state: Arc<WireState>,
}

impl WireHub {
    fn with(replies: Vec<Scripted>, clock: Arc<AtomicU64>) -> Self {
        let state = WireState {
            replies: Mutex::new(replies.into()),
            requests: Mutex::new(Vec::new()),
            clock,
        };
        Self {
            state: Arc::new(state),
        }
    }

    fn requests(&self) -> Vec<Request> {
        locked(&self.state.requests).clone()
    }
}

struct WireBody {
    chunks: VecDeque<Chunk>,
    clock: Arc<AtomicU64>,
}

impl Body for WireBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        loop {
            match self.chunks.pop_front() {
                None => return Ok(None),
                Some(Chunk::Wait(ms)) => {
                    self.clock.fetch_add(ms, Ordering::SeqCst);
                }
                Some(Chunk::Data(bytes)) => return Ok(Some(bytes)),
                Some(Chunk::Fail(error)) => return Err(error),
            }
        }
    }
}

impl HttpClient for WireHub {
    type Body = WireBody;

    async fn get(
        &self,
        url: &str,
        headers: &[(String, String)],
        _stall: Option<Duration>,
    ) -> Result<Reply<WireBody>, TransportError> {
        locked(&self.state.requests).push((url.to_owned(), headers.to_vec()));
        let Some(reply) = locked(&self.state.replies).pop_front() else {
            return Err(transport("no reply scripted"));
        };
        yield_once().await;
        if let Some(message) = reply.refuse {
            return Err(transport(&message));
        }
        if reply.hang {
            std::future::pending::<()>().await;
        }
        Ok(Reply {
            status: reply.status,
            headers: reply
                .headers
                .into_iter()
                .map(|(name, value)| (name.to_ascii_lowercase(), value))
                .collect(),
            body: WireBody {
                chunks: reply.chunks.into(),
                clock: Arc::clone(&self.state.clock),
            },
        })
    }
}

#[derive(Clone)]
struct FakeEnv {
    clock: Arc<AtomicU64>,
    pauses: Arc<Mutex<Vec<Duration>>>,
    free: Option<u64>,
}

impl FakeEnv {
    fn new(clock: Arc<AtomicU64>) -> Self {
        Self {
            clock,
            pauses: Arc::new(Mutex::new(Vec::new())),
            free: Some(50 << 30),
        }
    }
}

impl Env for FakeEnv {
    fn now_ms(&self) -> u64 {
        self.clock.load(Ordering::SeqCst)
    }

    async fn pause(&self, delay: Duration) {
        locked(&self.pauses).push(delay);
    }

    fn free_bytes(&self, _dir: &Path) -> Option<u64> {
        self.free
    }
}

const DATA: &str = "https://huggingface.co/acme/Model-GGUF/resolve/main/model.gguf?download=true";

fn payload(len: usize) -> Vec<u8> {
    (0..len)
        .map(|i| u8::try_from(i % 251).unwrap_or(0))
        .collect()
}

fn range_reply(start: usize, total: usize, body: &[u8]) -> Scripted {
    Scripted::ok(
        206,
        vec![
            ("content-length", body.len().to_string()),
            (
                "content-range",
                format!("bytes {start}-{}/{total}", total - 1),
            ),
        ],
        vec![Chunk::Data(body.to_vec())],
    )
}

fn full_reply(body: &[u8]) -> Scripted {
    Scripted::ok(
        200,
        vec![("content-length", body.len().to_string())],
        vec![Chunk::Data(body.to_vec())],
    )
}

struct Setup {
    dir: tempfile::TempDir,
    hub: WireHub,
    env: FakeEnv,
}

fn setup(replies: Vec<Scripted>) -> Setup {
    let clock = Arc::new(AtomicU64::new(0));
    let hub = WireHub::with(replies, Arc::clone(&clock));
    let env = FakeEnv::new(Arc::clone(&clock));
    Setup {
        dir: tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}")),
        hub,
        env,
    }
}

fn request(dir: &Path, url: &str) -> DownloadRequest {
    let mut req = DownloadRequest::new(url, dir, "model.gguf");
    req.retry_delay = Duration::from_millis(10);
    req
}

fn no_events(_: Progress) {}

#[test]
fn a_private_address_is_refused_before_any_request() {
    let setup = setup(vec![]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let result = block_on(downloader.download(
        request(setup.dir.path(), "http://192.168.1.1/model.gguf"),
        no_events,
    ));
    assert!(matches!(result, Err(DownloadError::Refused)));
    assert!(setup.hub.requests().is_empty());
}

#[test]
fn a_download_lands_under_its_name_and_reports_each_phase() {
    let body = payload(2048);
    let setup = setup(vec![full_reply(&body)]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut events = Vec::new();
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), |p| events.push(p)));

    let done = done.unwrap_or_else(|err| panic!("download failed: {err}"));
    assert_eq!(done.filename, "model.gguf");
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        body
    );
    assert!(!temp_path(&setup.dir.path().join("model.gguf")).exists());
    assert_eq!(events.first().map(|p| p.phase), Some(Phase::Preparing));
    let last = events
        .last()
        .cloned()
        .unwrap_or_else(|| panic!("no events"));
    assert_eq!(
        (last.phase, last.completed, last.total, last.percent),
        (Phase::Done, 2048, 2048, 100.0)
    );
    assert_eq!(last.remaining_seconds, Some(0));
}

#[test]
fn no_estimate_until_a_speed_sample_exists_then_a_whole_number_of_seconds() {
    let setup = setup(vec![Scripted::ok(
        200,
        vec![("content-length", "100000".to_owned())],
        vec![
            Chunk::Data(payload(1024)),
            Chunk::Wait(700),
            Chunk::Data(payload(1024)),
            Chunk::Fail(transport("connection reset")),
        ],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut req = request(setup.dir.path(), DATA);
    req.retries = 0;
    let mut events = Vec::new();
    let outcome = block_on(downloader.download(req, |p| events.push(p)));
    assert!(outcome.is_err());

    let downloading: Vec<&Progress> = events
        .iter()
        .filter(|p| p.phase == Phase::Downloading)
        .collect();
    assert_eq!(downloading.first().and_then(|p| p.remaining_seconds), None);
    let last = downloading.last().and_then(|p| p.remaining_seconds);
    assert!(matches!(last, Some(seconds) if seconds > 0));
}

#[test]
fn a_dropped_connection_is_resumed_from_the_bytes_kept() {
    let data = payload(10_000);
    let setup = setup(vec![
        Scripted::ok(
            200,
            vec![("content-length", "10000".to_owned())],
            vec![
                Chunk::Data(data[..4000].to_vec()),
                Chunk::Fail(transport("connection reset")),
            ],
        ),
        range_reply(4000, 10_000, &data[4000..]),
    ]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut events = Vec::new();
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), |p| events.push(p)));

    assert!(done.is_ok(), "resume failed: {done:?}");
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        data
    );
    let requests = setup.hub.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].1.is_empty());
    assert_eq!(
        requests[1].1,
        vec![("Range".to_owned(), "bytes=4000-".to_owned())]
    );
    assert_eq!(
        events
            .iter()
            .rev()
            .find(|p| p.phase == Phase::Downloading)
            .map(|p| p.completed),
        Some(10_000)
    );
    assert_eq!(setup.env.pauses.lock().map(|p| p.len()).unwrap_or(0), 1);
}

#[test]
fn a_partial_from_an_earlier_run_is_continued() {
    let data = payload(10_000);
    let setup = setup(vec![range_reply(6000, 10_000, &data[6000..])]);
    fs::write(
        temp_path(&setup.dir.path().join("model.gguf")),
        &data[..6000],
    )
    .unwrap_or_default();
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(done.is_ok());
    assert_eq!(
        setup.hub.requests()[0].1,
        vec![("Range".to_owned(), "bytes=6000-".to_owned())]
    );
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        data
    );
}

#[test]
fn a_server_that_ignores_range_sends_the_whole_file_and_the_partial_is_dropped() {
    let data = payload(10_000);
    let setup = setup(vec![full_reply(&data)]);
    fs::write(
        temp_path(&setup.dir.path().join("model.gguf")),
        vec![7u8; 3000],
    )
    .unwrap_or_default();
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(done.is_ok());
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        data
    );
}

#[test]
fn a_range_the_server_refuses_starts_the_file_over() {
    let data = payload(10_000);
    let setup = setup(vec![Scripted::ok(416, vec![], vec![]), full_reply(&data)]);
    fs::write(
        temp_path(&setup.dir.path().join("model.gguf")),
        vec![1u8; 10_050],
    )
    .unwrap_or_default();
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(done.is_ok());
    let requests = setup.hub.requests();
    assert!(
        requests[1].1.is_empty(),
        "the retry after 416 asks for the whole file"
    );
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        data
    );
}

#[test]
fn a_connection_closed_early_with_no_tries_left_fails_and_keeps_the_partial() {
    let setup = setup(vec![Scripted::ok(
        200,
        vec![("content-length", "5000".to_owned())],
        vec![
            Chunk::Data(payload(1000)),
            Chunk::Fail(transport(
                "The connection closed before the download finished",
            )),
        ],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut req = request(setup.dir.path(), DATA);
    req.retries = 0;
    let outcome = block_on(downloader.download(req, no_events));

    assert!(matches!(outcome, Err(DownloadError::Network(_))));
    assert!(!setup.dir.path().join("model.gguf").exists());
    assert!(temp_path(&setup.dir.path().join("model.gguf")).exists());
}

#[test]
fn a_stalled_connection_is_reported_as_a_stall() {
    let setup = setup(vec![Scripted::ok(
        200,
        vec![("content-length", "100000".to_owned())],
        vec![
            Chunk::Data(payload(1024)),
            Chunk::Fail(TransportError::timeout()),
        ],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut req = request(setup.dir.path(), DATA);
    req.retries = 0;
    let outcome = block_on(downloader.download(req, no_events));

    match outcome {
        Err(DownloadError::Stalled(seconds)) => assert_eq!(seconds, 60),
        other => panic!("expected a stall, got {other:?}"),
    }
    assert!(temp_path(&setup.dir.path().join("model.gguf")).exists());
}

#[test]
fn a_redirect_is_followed_and_each_hop_is_checked() {
    let body = payload(100);
    let setup = setup(vec![
        Scripted::ok(302, vec![("location", "/file".to_owned())], vec![]),
        full_reply(&body),
    ]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let done = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(done.is_ok());
    let requests = setup.hub.requests();
    assert_eq!(requests[1].0, "https://huggingface.co/file");
}

#[test]
fn a_redirect_into_a_private_network_is_refused() {
    let setup = setup(vec![Scripted::ok(
        302,
        vec![("location", "http://127.0.0.1/secret".to_owned())],
        vec![],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let outcome = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(matches!(outcome, Err(DownloadError::RedirectRefused)));
    assert_eq!(setup.hub.requests().len(), 1);
}

#[test]
fn too_many_redirects_stop_the_download() {
    let setup = setup(vec![
        Scripted::ok(302, vec![("location", "/a".to_owned())], vec![]),
        Scripted::ok(302, vec![("location", "/b".to_owned())], vec![]),
    ]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut req = request(setup.dir.path(), DATA);
    req.max_redirects = 1;
    let outcome = block_on(downloader.download(req, no_events));

    assert!(matches!(outcome, Err(DownloadError::TooManyRedirects)));
}

#[test]
fn a_refused_status_fails_at_once_without_a_retry() {
    let setup = setup(vec![Scripted::ok(404, vec![], vec![])]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let outcome = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(matches!(outcome, Err(DownloadError::Status(404))));
    assert!(locked(&setup.env.pauses).is_empty());
}

#[test]
fn more_bytes_than_promised_are_not_this_file() {
    let setup = setup(vec![Scripted::ok(
        200,
        vec![("content-length", "10".to_owned())],
        vec![Chunk::Data(payload(12))],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let outcome = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(matches!(outcome, Err(DownloadError::TooLarge)));
    assert!(!temp_path(&setup.dir.path().join("model.gguf")).exists());
}

#[test]
fn a_cancel_mid_download_removes_what_was_left_and_a_new_download_works() {
    let data = payload(4096);
    let setup = setup(vec![full_reply(&data), full_reply(&data)]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let dir = setup.dir.path();
    let outcome = block_on(downloader.download(request(dir, DATA), |progress| {
        if progress.phase == Phase::Downloading && progress.completed > 0 {
            downloader.cancel(dir, "model.gguf", false);
        }
    }));

    assert!(matches!(outcome, Err(DownloadError::Cancelled)));
    assert_eq!(fs::read_dir(dir).map(Iterator::count).unwrap_or(1), 0);

    let again = block_on(downloader.download(request(dir, DATA), no_events));
    assert!(again.is_ok());
}

#[test]
fn a_cancel_with_nothing_running_keeps_an_installed_model() {
    let setup = setup(vec![]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    fs::write(setup.dir.path().join("model.gguf"), b"installed").unwrap_or_default();
    fs::write(temp_path(&setup.dir.path().join("model.gguf")), b"partial").unwrap_or_default();
    downloader.cancel(setup.dir.path(), "model.gguf", false);

    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        b"installed"
    );
    assert!(!temp_path(&setup.dir.path().join("model.gguf")).exists());
}

#[test]
fn a_second_download_of_a_file_already_running_joins_it() {
    let body = payload(3000);
    let setup = setup(vec![full_reply(&body)]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut first_events = Vec::new();
    let mut second_events = Vec::new();
    let (first, second) = block_on_both(
        downloader.download(request(setup.dir.path(), DATA), |p| first_events.push(p)),
        downloader.download(request(setup.dir.path(), DATA), |p| second_events.push(p)),
    );

    assert_eq!(
        first.map(|done| done.filename).ok().as_deref(),
        Some("model.gguf")
    );
    assert_eq!(
        second.map(|done| done.filename).ok().as_deref(),
        Some("model.gguf")
    );
    assert_eq!(
        setup.hub.requests().len(),
        1,
        "the joined call must not ask again"
    );
    assert_eq!(second_events.last().map(|p| p.phase), Some(Phase::Done));
    assert_eq!(
        fs::read(setup.dir.path().join("model.gguf")).unwrap_or_default(),
        body
    );
}

#[test]
fn a_cancel_while_the_connection_is_still_opening_leaves_nothing_behind() {
    let setup = setup(vec![Scripted::hang()]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let dir = setup.dir.path();
    fs::write(dir.join("model.gguf"), b"installed").unwrap_or_default();
    let (outcome, ()) = block_on_both(downloader.download(request(dir, DATA), no_events), async {
        yield_once().await;
        downloader.cancel(dir, "model.gguf", false);
    });

    assert!(matches!(outcome, Err(DownloadError::Cancelled)));
    assert!(!temp_path(&dir.join("model.gguf")).exists());
    assert!(
        !dir.join("model.gguf").exists(),
        "a download replacing a model removes it on cancel"
    );
}

#[test]
fn a_redirect_with_an_empty_location_is_not_followed() {
    let setup = setup(vec![Scripted::ok(
        302,
        vec![("location", String::new())],
        vec![],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let outcome = block_on(downloader.download(request(setup.dir.path(), DATA), no_events));

    assert!(matches!(outcome, Err(DownloadError::Status(302))));
    assert_eq!(setup.hub.requests().len(), 1);
}

#[test]
fn a_body_that_fails_reads_as_a_closed_connection_whatever_the_transport_said() {
    let setup = setup(vec![Scripted::ok(
        200,
        vec![("content-length", "100".to_owned())],
        vec![Chunk::Fail(transport("error decoding response body"))],
    )]);
    let downloader = Downloader::new(setup.hub.clone(), setup.env.clone());
    let mut req = request(setup.dir.path(), DATA);
    req.retries = 0;
    let outcome = block_on(downloader.download(req, no_events));

    match outcome {
        Err(DownloadError::Network(message)) => assert_eq!(
            message,
            "The connection closed before the download finished"
        ),
        other => panic!("expected a network failure, got {other:?}"),
    }
}

// ---- the models folder ---------------------------------------------------------------------------------------------

/// A 128-byte file that reads as a GGUF header with no keys, the same shape the reference's tests write.
fn write_gguf(path: &Path) {
    let mut bytes = Vec::with_capacity(128);
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3u32.to_le_bytes());
    bytes.extend_from_slice(&0u64.to_le_bytes());
    bytes.extend_from_slice(&0u64.to_le_bytes());
    bytes.resize(128, 0);
    fs::write(path, bytes).unwrap_or_default();
}

fn names_of(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn list(dir: &Path) -> Vec<draggy_models::model_storage::ModelEntry> {
    list_gguf_models(dir, &Projectors::new(), &mut CapabilityCache::default()).unwrap_or_default()
}

#[test]
fn a_missing_folder_lists_as_empty() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    assert!(list(&dir.path().join("absent")).is_empty());
}

#[test]
fn only_gguf_files_are_listed() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    fs::write(dir.path().join("notes.txt"), "hello").unwrap_or_default();
    fs::write(dir.path().join("download.tmp"), "partial").unwrap_or_default();
    write_gguf(&dir.path().join("tiny-test.gguf"));

    let models = list(dir.path());
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].filename, "tiny-test.gguf");
    assert_eq!(models[0].size, 128);
}

#[test]
fn a_file_that_is_not_a_header_is_still_listed_as_unknown() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    fs::write(dir.path().join("broken.gguf"), "not a model").unwrap_or_default();

    let models = list(dir.path());
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].architecture, "unknown");
    assert_eq!(models[0].context_length, None);
}

#[test]
fn delete_removes_the_file_and_blocks_a_path_outside_the_folder() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    write_gguf(&dir.path().join("to-remove.gguf"));

    assert_eq!(
        delete_gguf_model(dir.path(), "to-remove.gguf").ok(),
        Some(true)
    );
    assert!(names_of(dir.path()).is_empty());
    assert_eq!(
        delete_gguf_model(dir.path(), "non-existent.gguf").ok(),
        Some(false)
    );
    assert_eq!(
        delete_gguf_model(dir.path(), "../../../outside.gguf").ok(),
        Some(false)
    );
}

#[test]
fn split_parts_list_as_one_model_with_their_combined_size() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let parts = [
        "big-Q4_K_M-00001-of-00003.gguf",
        "big-Q4_K_M-00002-of-00003.gguf",
        "big-Q4_K_M-00003-of-00003.gguf",
    ];
    for name in parts {
        write_gguf(&dir.path().join(name));
    }
    write_gguf(&dir.path().join("small.gguf"));

    let models = list(dir.path());
    let mut names: Vec<&str> = models.iter().map(|m| m.filename.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, vec![parts[0], "small.gguf"]);
    assert_eq!(
        models
            .iter()
            .find(|m| m.filename == parts[0])
            .map(|m| m.size),
        Some(128 * 3)
    );
}

#[test]
fn a_later_part_whose_first_part_is_gone_is_still_listed_so_it_can_be_deleted() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    write_gguf(&dir.path().join("big-Q4_K_M-00002-of-00003.gguf"));

    let models = list(dir.path());
    assert_eq!(
        models
            .iter()
            .map(|m| m.filename.as_str())
            .collect::<Vec<_>>(),
        vec!["big-Q4_K_M-00002-of-00003.gguf"]
    );
}

#[test]
fn deleting_a_split_model_removes_every_part() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let parts = [
        "big-Q4_K_M-00001-of-00003.gguf",
        "big-Q4_K_M-00002-of-00003.gguf",
        "big-Q4_K_M-00003-of-00003.gguf",
    ];
    for name in parts {
        write_gguf(&dir.path().join(name));
    }
    write_gguf(&dir.path().join("keep.gguf"));

    assert_eq!(delete_gguf_model(dir.path(), parts[0]).ok(), Some(true));
    assert_eq!(names_of(dir.path()), vec!["keep.gguf"]);
}

#[test]
fn a_projector_beside_a_model_makes_it_a_vision_model_and_is_not_listed() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    write_gguf(&dir.path().join("seer-Q4_K_M.gguf"));
    write_gguf(&dir.path().join("seer-Q4_K_M-mmproj.gguf"));
    write_gguf(&dir.path().join("plain-Q4_K_M.gguf"));

    let models = list_gguf_models(
        dir.path(),
        &Projectors::new(),
        &mut CapabilityCache::default(),
    )
    .unwrap_or_default();
    let by_name: BTreeMap<&str, &Vec<String>> = models
        .iter()
        .map(|m| (m.filename.as_str(), &m.capabilities))
        .collect();
    assert_eq!(by_name.len(), 2);
    assert!(by_name["seer-Q4_K_M.gguf"].iter().any(|c| c == "vision"));
    assert!(!by_name["plain-Q4_K_M.gguf"].iter().any(|c| c == "vision"));
}

#[test]
fn deleting_a_model_removes_its_projector() {
    let dir = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    write_gguf(&dir.path().join("seer-Q4_K_M.gguf"));
    write_gguf(&dir.path().join("seer-Q4_K_M-mmproj.gguf"));

    assert_eq!(
        delete_gguf_model(dir.path(), "seer-Q4_K_M.gguf").ok(),
        Some(true)
    );
    assert!(names_of(dir.path()).is_empty());
}

// ---- the download flows ---------------------------------------------------------------------------------------------

/// A download in flight inside a fixture scenario, polled by hand between the ops that follow it.
type Running<'a> = Pin<Box<dyn Future<Output = Result<Downloaded, DownloadError>> + 'a>>;

/// Runs one scenario of `download-flow.json` through the port, against the same scripted server the TypeScript runner uses.
fn run_downloads(input: &Value) -> Value {
    let scratch = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let models_dir = scratch.path().join("models");
    fs::create_dir_all(&models_dir).unwrap_or_else(|err| panic!("models dir: {err}"));
    let now = SystemTime::now();
    for seed in input["seed"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        write_seed(&models_dir, seed, now);
    }
    let clock = Arc::new(AtomicU64::new(millis_since_epoch(now)));
    let hub = WireHub::with(scripted_replies(&input["replies"]), Arc::clone(&clock));
    let downloader = Downloader::new(hub.clone(), FakeEnv::new(clock));

    let mut results = Vec::new();
    let mut started: BTreeMap<String, Running<'_>> = BTreeMap::new();
    for op in input["ops"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let args = &op["args"];
        match op["op"].as_str().unwrap_or_default() {
            "download" => {
                let req = download_request(&models_dir, args);
                results.push(outcome_json(block_on(downloader.download(req, no_events))));
            }
            "start" => {
                let id = op["id"].as_str().unwrap_or_default().to_owned();
                let req = download_request(&models_dir, args);
                let mut future: Running<'_> = Box::pin(downloader.download(req, no_events));
                // Polled once, as the reference has sent its request by the time it returns.
                let _ = future
                    .as_mut()
                    .poll(&mut Context::from_waker(Waker::noop()));
                started.insert(id.clone(), future);
                results.push(json!({ "started": id }));
            }
            "await" => {
                let id = op["id"].as_str().unwrap_or_default();
                let Some(future) = started.remove(id) else {
                    panic!("no started download named {id}");
                };
                results.push(outcome_json(block_on(future)));
            }
            "cancel" => {
                let filename = args["filename"].as_str().unwrap_or_default();
                let keep = args["keepExtension"].as_bool().unwrap_or(false);
                downloader.cancel(&models_dir, filename, keep);
                results.push(json!({ "success": true }));
            }
            other => panic!("unknown download op {other}"),
        }
    }
    json!({
        "results": results,
        "files": list_files(&models_dir),
        "requests": requests_json(&hub),
    })
}

fn millis_since_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

fn write_seed(models_dir: &Path, seed: &Value, now: SystemTime) {
    let path = models_dir.join(seed["name"].as_str().unwrap_or_default());
    fs::write(&path, seed["content"].as_str().unwrap_or_default())
        .unwrap_or_else(|err| panic!("seed {}: {err}", path.display()));
    if let Some(age_ms) = seed["ageMs"].as_u64() {
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap_or_else(|err| panic!("seed {}: {err}", path.display()));
        let when = now - Duration::from_millis(age_ms);
        file.set_modified(when)
            .unwrap_or_else(|err| panic!("seed age {}: {err}", path.display()));
    }
}

fn download_request(models_dir: &Path, args: &Value) -> DownloadRequest {
    let mut req = DownloadRequest::new(
        args["url"].as_str().unwrap_or_default(),
        models_dir,
        args["filename"].as_str().unwrap_or("model.gguf"),
    );
    req.keep_extension = args["keepExtension"].as_bool().unwrap_or(false);
    if let Some(ms) = args["stallMs"].as_u64() {
        req.stall = Duration::from_millis(ms);
    }
    if let Some(retries) = args["retries"].as_u64() {
        req.retries = u32::try_from(retries).unwrap_or(0);
    }
    if let Some(ms) = args["retryDelayMs"].as_u64() {
        req.retry_delay = Duration::from_millis(ms);
    }
    if let Some(hops) = args["maxRedirects"].as_u64() {
        req.max_redirects = u32::try_from(hops).unwrap_or(0);
    }
    req
}

/// The outcome the IPC layer reports: success, a cancel as its own result, or the error's message.
fn outcome_json(outcome: Result<Downloaded, DownloadError>) -> Value {
    match outcome {
        Ok(done) => json!({ "success": true, "filename": done.filename }),
        Err(DownloadError::Cancelled) => json!({ "cancelled": true }),
        Err(err) => json!({ "error": err.to_string() }),
    }
}

fn scripted_replies(replies: &Value) -> Vec<Scripted> {
    replies
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|reply| {
            if reply["hang"].as_bool().unwrap_or(false) {
                return Scripted::hang();
            }
            if let Some(message) = reply["error"].as_str() {
                return Scripted::refused(message);
            }
            let status = u16::try_from(reply["status"].as_u64().unwrap_or(200)).unwrap_or(500);
            let headers = reply["headers"]
                .as_object()
                .map(|map| {
                    map.iter()
                        .map(|(name, value)| {
                            (
                                name.to_ascii_lowercase(),
                                value.as_str().unwrap_or_default().to_owned(),
                            )
                        })
                        .collect::<Vec<(String, String)>>()
                })
                .unwrap_or_default();
            let chunks = reply["body"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .map(|item| {
                    if let Some(text) = item["data"].as_str() {
                        Chunk::Data(text.as_bytes().to_vec())
                    } else if item["stall"].as_bool().unwrap_or(false) {
                        Chunk::Fail(TransportError::timeout())
                    } else {
                        Chunk::Fail(transport(
                            item["fail"].as_str().unwrap_or("connection reset"),
                        ))
                    }
                })
                .collect();
            Scripted::owned(status, headers, chunks)
        })
        .collect()
}

fn requests_json(hub: &WireHub) -> Value {
    Value::Array(
        hub.requests()
            .into_iter()
            .map(|(url, headers)| {
                let range = headers
                    .iter()
                    .find(|(name, _)| name == "Range")
                    .map(|(_, value)| value.clone());
                json!({ "url": url, "range": range })
            })
            .collect(),
    )
}

fn list_files(dir: &Path) -> Value {
    let mut entries: Vec<(String, String)> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .map(|entry| {
                    let content = fs::read(entry.path())
                        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                        .unwrap_or_default();
                    (entry.file_name().to_string_lossy().into_owned(), content)
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    Value::Array(
        entries
            .into_iter()
            .map(|(name, content)| json!({ "name": name, "content": content }))
            .collect(),
    )
}

// ---- the cache -----------------------------------------------------------------------------------------------------

const ORIGIN: &str = "https://hf";

fn cache_hub(chunks: Vec<Vec<u8>>, status: u16) -> WireHub {
    let body = chunks.iter().map(|c| c.len()).sum::<usize>();
    let reply = Scripted::ok(
        status,
        vec![("content-length", body.to_string())],
        chunks.into_iter().map(Chunk::Data).collect(),
    );
    WireHub::with(vec![reply], Arc::new(AtomicU64::new(0)))
}

fn drain<B: Body>(
    stream: &mut draggy_models::model_cache::CachedStream<B>,
) -> Result<Vec<u8>, CacheError> {
    let mut out = Vec::new();
    while let Some(chunk) = block_on(stream.next_chunk())? {
        out.extend(chunk);
    }
    Ok(out)
}

#[test]
fn a_download_is_streamed_and_kept_for_next_time() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let hub = cache_hub(vec![vec![1, 2, 3], vec![4, 5]], 200);
    let first = block_on(serve_model_file(
        root.path(),
        "org/model/resolve/main/a.onnx",
        ORIGIN,
        &hub,
        "t1",
    ));
    let Ok(Served::Fetched(mut stream)) = first else {
        panic!("expected a fetch");
    };
    assert_eq!(stream.size(), Some(5));
    assert_eq!(drain(&mut stream).unwrap_or_default(), vec![1, 2, 3, 4, 5]);
    drop(stream);

    let second = block_on(serve_model_file(
        root.path(),
        "org/model/resolve/main/a.onnx",
        ORIGIN,
        &hub,
        "t2",
    ));
    assert!(matches!(second, Ok(Served::Cached { size: 5, .. })));
    assert_eq!(hub.requests().len(), 1);
    assert_eq!(
        names_of(&root.path().join("org/model/resolve/main")),
        vec!["a.onnx"]
    );
}

#[test]
fn the_first_bytes_arrive_before_the_last_and_the_file_appears_only_when_complete() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let hub = cache_hub(vec![vec![9], vec![8]], 200);
    let Ok(Served::Fetched(mut stream)) =
        block_on(serve_model_file(root.path(), "x/y.bin", ORIGIN, &hub, "t"))
    else {
        panic!("expected a fetch");
    };
    assert_eq!(block_on(stream.next_chunk()).ok().flatten(), Some(vec![9]));
    assert!(!root.path().join("x/y.bin").exists());
    assert_eq!(block_on(stream.next_chunk()).ok().flatten(), Some(vec![8]));
    assert_eq!(block_on(stream.next_chunk()).ok().flatten(), None);
    assert!(root.path().join("x/y.bin").exists());
}

#[test]
fn a_cancelled_download_leaves_nothing_behind() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let hub = cache_hub(vec![vec![1], vec![2], vec![3]], 200);
    let Ok(Served::Fetched(mut stream)) =
        block_on(serve_model_file(root.path(), "x/z.bin", ORIGIN, &hub, "t"))
    else {
        panic!("expected a fetch");
    };
    assert!(block_on(stream.next_chunk()).is_ok());
    drop(stream);

    assert!(root.path().join("x").is_dir());
    assert!(names_of(&root.path().join("x")).is_empty());
}

#[test]
fn upstream_failures_pass_through_and_paths_outside_the_cache_are_refused() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let hub = cache_hub(vec![], 404);
    let missing = block_on(serve_model_file(
        root.path(),
        "a/missing.bin",
        ORIGIN,
        &hub,
        "t",
    ));
    assert!(matches!(
        missing,
        Ok(Served::UpstreamFailed { status: 404 })
    ));
    assert!(matches!(
        block_on(serve_model_file(
            root.path(),
            "../escape",
            ORIGIN,
            &hub,
            "t"
        )),
        Ok(Served::BadRequest)
    ));
    assert!(matches!(
        block_on(serve_model_file(root.path(), "", ORIGIN, &hub, "t")),
        Ok(Served::BadRequest)
    ));
}

#[test]
fn a_model_redirect_is_followed_the_way_fetch_follows_it() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let hub = WireHub::with(
        vec![
            Scripted::ok(
                302,
                vec![("location", "https://cdn.example.org/a.bin".to_owned())],
                vec![],
            ),
            Scripted::ok(
                200,
                vec![("content-length", "2".to_owned())],
                vec![Chunk::Data(vec![4, 2])],
            ),
        ],
        Arc::new(AtomicU64::new(0)),
    );
    let Ok(Served::Fetched(mut stream)) =
        block_on(serve_model_file(root.path(), "x/a.bin", ORIGIN, &hub, "t"))
    else {
        panic!("expected a fetch after the redirect");
    };
    assert_eq!(drain(&mut stream).unwrap_or_default(), vec![4, 2]);
    let requests = hub.requests();
    assert_eq!(requests[0].0, "https://hf/x/a.bin");
    assert_eq!(requests[1].0, "https://cdn.example.org/a.bin");
}

#[test]
fn a_model_redirect_loop_stops_after_twenty_hops() {
    let root = tempfile::tempdir().unwrap_or_else(|err| panic!("tempdir: {err}"));
    let loop_reply = || Scripted::ok(302, vec![("location", "/again".to_owned())], vec![]);
    let hub = WireHub::with(
        (0..25).map(|_| loop_reply()).collect(),
        Arc::new(AtomicU64::new(0)),
    );
    let outcome = block_on(serve_model_file(
        root.path(),
        "x/loop.bin",
        ORIGIN,
        &hub,
        "t",
    ));

    assert!(matches!(outcome, Err(CacheError::TooManyRedirects)));
    assert_eq!(hub.requests().len(), 21);
}

#[test]
fn a_cache_path_is_the_root_joined_with_the_relative_path() {
    assert_eq!(
        cached_path(Path::new("/cache"), "org/a.bin").map(|p| posix_path(&p.to_string_lossy())),
        Some("/cache/org/a.bin".to_owned())
    );
}
