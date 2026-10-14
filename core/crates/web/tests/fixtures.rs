//! Runs the golden fixtures in `shared/fixtures/web` through the port. The vitest runner in
//! `src/__tests__/fixtures/web.test.ts` runs the same inputs through electron/urlPolicy.cjs, search.cjs and
//! connectivity.cjs, with canned HTTP and a virtual clock, so both must agree.

use std::collections::HashMap;
use std::fmt::Debug;
use std::future::{Future, ready};
use std::sync::{Arc, Mutex, PoisonError};

use draggy_testkit::{cases, files};
use draggy_web::connectivity::Connectivity;
use draggy_web::http::{HttpClient, HttpError, HttpRequest, HttpResponse, Method, decode_page};
use draggy_web::policy::{
    Refusals, UrlPolicy, is_private_hostname, permission_granted, refusal_for,
};
use draggy_web::search::{
    Clock, Outcome, Provider, ProviderError, Search, SearchConfig, SearchResult, build_chain,
    build_request, failure_log_text, normalise_results, parse_response, unwrap_redirect,
};
use serde_json::{Map, Value, json};
use tracing::field::{Field, Visit};
use tracing::span;
use tracing::{Event, Metadata, Subscriber};

/// The virtual clock's start, as the TypeScript runner's.
const START_MS: u64 = 1_000_000;

/// The settings the TypeScript runner uses for body and query cases.
fn fixture_config() -> SearchConfig {
    SearchConfig {
        search_provider: "auto".to_owned(),
        searxng_url: "http://searx.test:8080".to_owned(),
        brave_api_key: "BSA-test-key".to_owned(),
    }
}

/// One test per fixture file, so a failure names its file. Each new file must be listed here, or the guard below fails.
macro_rules! fixture_tests {
    ($($test:ident => $file:literal),* $(,)?) => {
        const KNOWN_FILES: &[&str] = &[$($file),*];

        $(
            #[test]
            fn $test() {
                check_file($file);
            }
        )*
    };
}

fixture_tests! {
    connectivity => "connectivity.json",
    connectivity_log => "connectivity-log.json",
    hostnames => "hostnames.json",
    page_decode => "page-decode.json",
    permissions => "permissions.json",
    policy_counts => "policy-counts.json",
    search_brave => "search-brave.json",
    search_brave_html => "search-brave-html.json",
    search_chain => "search-chain.json",
    search_duckduckgo => "search-duckduckgo.json",
    search_duckduckgo_lite => "search-duckduckgo-lite.json",
    search_log => "search-log.json",
    search_normalise => "search-normalise.json",
    search_query => "search-query.json",
    search_redact => "search-redact.json",
    search_redirect => "search-redirect.json",
    search_run => "search-run.json",
    search_searxng => "search-searxng.json",
    search_startpage => "search-startpage.json",
    urls => "urls.json",
}

#[test]
fn every_fixture_file_has_a_runner() {
    let unknown: Vec<String> = files("web")
        .into_iter()
        .filter(|file| !KNOWN_FILES.contains(&file.as_str()))
        .collect();
    assert!(unknown.is_empty(), "no Rust runner for {unknown:?}");
}

/// Runs every case of one file and reports all the differences at once, not just the first.
fn check_file(file: &str) {
    let mut failures = Vec::new();
    for case in cases("web", file) {
        let name = case["name"].as_str().unwrap_or_default();
        let actual = run(file, &case["input"]);
        if actual != case["expected"] {
            failures.push(format!(
                "{name}\n  expected {}\n  actual   {actual}",
                case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{file}: {} case(s) differ\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "urls.json" => run_url(input),
        "hostnames.json" => json!(is_private_hostname(&js_text(&input["hostname"]))),
        "search-chain.json" => {
            let chain = build_chain(&config_of(&input["config"]));
            json!(
                chain
                    .iter()
                    .map(|provider| provider.id())
                    .collect::<Vec<_>>()
            )
        }
        "search-query.json" => run_query(input),
        "search-normalise.json" => json!(
            normalise_results(&input["raw"])
                .iter()
                .map(result_json)
                .collect::<Vec<_>>()
        ),
        "search-redirect.json" => json!(unwrap_redirect(&js_text(&input["url"]))),
        "search-redact.json" => run_redact(input),
        "search-run.json" => run_ops(input),
        "search-log.json" => run_search_log(input),
        "connectivity.json" => run_connectivity(input),
        "connectivity-log.json" => run_connectivity_log(input),
        "page-decode.json" => run_decode(input),
        "permissions.json" => run_permission(input),
        "policy-counts.json" => run_policy_ops(input),
        "search-brave.json"
        | "search-brave-html.json"
        | "search-duckduckgo.json"
        | "search-duckduckgo-lite.json"
        | "search-searxng.json"
        | "search-startpage.json" => run_body(input),
        other => panic!("no Rust runner for {other}"),
    }
}

/// `String(value ?? "")` for the scalar inputs the fixtures use.
fn js_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn str_field(input: &Value, key: &str) -> String {
    input[key].as_str().unwrap_or_default().to_owned()
}

fn provider_named(id: &str) -> Provider {
    Provider::ALL
        .into_iter()
        .find(|provider| provider.id() == id)
        .unwrap_or_else(|| panic!("no provider {id}"))
}

fn config_of(config: &Value) -> SearchConfig {
    SearchConfig {
        search_provider: str_field(config, "searchProvider"),
        searxng_url: str_field(config, "searxngUrl"),
        brave_api_key: str_field(config, "braveApiKey"),
    }
}

fn result_json(result: &SearchResult) -> Value {
    json!({ "title": result.title, "url": result.url, "snippet": result.snippet })
}

fn run_url(input: &Value) -> Value {
    let url = js_text(&input["url"]);
    let allow_private = input["allowPrivate"].as_bool().unwrap_or(false);
    let fetchable = UrlPolicy::new().is_fetchable_url(&url, allow_private);
    let refusal = if fetchable {
        Value::Null
    } else {
        json!(refusal_for(&url))
    };
    json!({ "fetchable": fetchable, "refusal": refusal })
}

/// The refusal counts of a policy, keyed as the CJS `sessionCounts()` keys them.
fn counts_json(counts: Refusals) -> Value {
    json!({
        "empty": counts.empty,
        "control_char": counts.control_char,
        "invalid": counts.invalid,
        "protocol": counts.protocol,
        "no_host": counts.no_host,
        "private_host": counts.private_host,
    })
}

/// An ordered op list through one policy: URL checks, and snapshots of the session's refusal counts.
fn run_policy_ops(input: &Value) -> Value {
    let mut policy = UrlPolicy::new();
    let steps: Vec<Value> = input["ops"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|op| {
            if op["counts"].as_bool() == Some(true) {
                json!({ "counts": counts_json(policy.session_counts()) })
            } else {
                let allow_private = op["allowPrivate"].as_bool().unwrap_or(false);
                let fetchable = policy.is_fetchable_url(&js_text(&op["url"]), allow_private);
                json!({ "fetchable": fetchable })
            }
        })
        .collect();
    json!({ "steps": steps })
}

fn run_query(input: &Value) -> Value {
    let provider = provider_named(input["provider"].as_str().unwrap_or_default());
    let config = SearchConfig {
        search_provider: "auto".to_owned(),
        searxng_url: str_field(input, "searxngUrl"),
        brave_api_key: str_field(input, "braveApiKey"),
    };
    let request = build_request(
        provider,
        input["query"].as_str().unwrap_or_default(),
        &config,
    );
    let headers: Map<String, Value> = request
        .headers
        .iter()
        .map(|(name, value)| (name.clone(), json!(value)))
        .collect();
    let mut out = json!({ "url": request.url, "headers": headers });
    // search.cjs sets a timeout only on the API calls. A page's timeout is the shell's loadURL, so it is not compared here.
    if matches!(provider, Provider::Searxng | Provider::Brave) {
        out["timeoutMs"] = json!(millis(request.timeout));
    }
    out
}

fn millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// The text a failed provider logs, for an error message and a query. The reference logs it from the scraper or fetch.
fn run_redact(input: &Value) -> Value {
    json!(failure_log_text(
        &js_text(&input["message"]),
        input["query"].as_str().unwrap_or_default()
    ))
}

/// The bytes of a page, decoded the way the port decodes a scraped body. A value that is not a byte fails the case, as the
/// TypeScript runner throws on it.
fn run_decode(input: &Value) -> Value {
    let bytes: Option<Vec<u8>> = input["bytes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|byte| u8::try_from(byte.as_u64()?).ok())
        .collect();
    match bytes {
        Some(bytes) => json!(decode_page(&bytes, input["contentType"].as_str())),
        None => json!("fixture has a byte outside 0 to 255"),
    }
}

/// A policy permission check: the permission name and the two origin flags the CJS reads.
fn run_permission(input: &Value) -> Value {
    json!(permission_granted(
        input["permission"].as_str().unwrap_or_default(),
        input["fromAppWindow"].as_bool().unwrap_or(false),
        input["fromAppPage"].as_bool().unwrap_or(false),
    ))
}

/// A provider's response body, parsed as the provider would parse it. Errors are reported as the TypeScript runner reports them.
fn run_body(input: &Value) -> Value {
    let provider = provider_named(input["provider"].as_str().unwrap_or_default());
    let query = input["query"].as_str().unwrap_or_default();
    let status = input["status"]
        .as_u64()
        .and_then(|status| u16::try_from(status).ok())
        .unwrap_or(200);
    let request = build_request(provider, query, &fixture_config());
    let body = input["body"].as_str().unwrap_or_default();
    match parse_response(provider, &request.url, status, body) {
        Ok(results) => json!({ "results": results.iter().map(result_json).collect::<Vec<_>>() }),
        Err(error) => json!({ "error": failure_text(&error) }),
    }
}

/// Status errors keep their message. Anything else is reported as an invalid body, as the TypeScript runner does.
fn failure_text(error: &ProviderError) -> String {
    match error {
        ProviderError::Status { .. } => error.to_string(),
        _ => "invalid body".to_owned(),
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("a tokio runtime for the fixtures")
}

/// An ordered op list through one `Search`: one cache, one pacing history and one virtual clock per case.
fn run_ops(input: &Value) -> Value {
    let web = Web::default();
    let clock = Script::new(START_MS);
    let mut search = Search::new(web.clone(), clock.clone());
    let runtime = runtime();
    let mut steps = Vec::new();
    for op in input["ops"].as_array().into_iter().flatten() {
        if let Some(at) = op["at"].as_u64() {
            clock.set(at);
        }
        web.replace_responses(&op["responses"]);
        let slept_before = clock.slept();
        let config = config_of(&op["config"]);
        let outcome: Outcome =
            runtime.block_on(search.run(op["query"].as_str().unwrap_or_default(), &config));
        steps.push(json!({
            "results": outcome.results.iter().map(result_json).collect::<Vec<_>>(),
            "provider": outcome.provider.map_or(Value::Null, |provider| json!(provider.id())),
            "tried": outcome.tried.iter().map(|provider| provider.id()).collect::<Vec<_>>(),
            "status": outcome.status.as_str(),
            "cached": outcome.cached,
            "called": web.take_calls(),
            "waitedMs": clock.slept() - slept_before,
        }));
    }
    json!({ "steps": steps })
}

/// The reply a probe gives for one outcome: a status, a timeout, or a request error.
fn probe_reply(outcome: &Value) -> Result<u16, HttpError> {
    match outcome {
        Value::Number(status) => {
            Ok(u16::try_from(status.as_u64().unwrap_or_default()).unwrap_or_default())
        }
        Value::String(word) if word == "timeout" => Err(HttpError::Timeout),
        _ => Err(HttpError::Failed("ENOTFOUND".to_owned())),
    }
}

fn run_connectivity(input: &Value) -> Value {
    let probe = Probe::new(probe_reply(&input["outcome"]));
    let mut connectivity = Connectivity::new(probe.clone());
    let online = runtime().block_on(connectivity.check());
    json!({ "online": online, "calls": probe.calls() })
}

/// Checks in order through one `Connectivity`, so each check sees the answer before it. The events of each check are kept.
fn run_connectivity_log(input: &Value) -> Value {
    let probe = Probe::new(Ok(200));
    let mut connectivity = Connectivity::new(probe.clone());
    let runtime = runtime();
    let steps: Vec<Value> = input["ops"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|op| {
            probe.set_reply(probe_reply(&op["outcome"]));
            let (online, logs) = capture(|| runtime.block_on(connectivity.check()));
            json!({ "online": online, "logs": logs })
        })
        .collect();
    json!({ "steps": steps })
}

/// An ordered op list through one `Search`, as `run_ops`, with the net events each step logs.
fn run_search_log(input: &Value) -> Value {
    let web = Web::default();
    let clock = Script::new(START_MS);
    let mut search = Search::new(web.clone(), clock.clone());
    let runtime = runtime();
    let mut steps = Vec::new();
    for op in input["ops"].as_array().into_iter().flatten() {
        if let Some(at) = op["at"].as_u64() {
            clock.set(at);
        }
        web.replace_responses(&op["responses"]);
        let config = config_of(&op["config"]);
        let (outcome, logs) = capture(|| {
            runtime.block_on(search.run(op["query"].as_str().unwrap_or_default(), &config))
        });
        steps.push(json!({
            "status": outcome.status.as_str(),
            "provider": outcome.provider.map_or(Value::Null, |provider| json!(provider.id())),
            "cached": outcome.cached,
            "called": web.take_calls(),
            "logs": logs,
        }));
    }
    json!({ "steps": steps })
}

/// Runs a body and returns what it logged. The TypeScript runner records the same lines by hooking the logger.
fn capture<T>(body: impl FnOnce() -> T) -> (T, Vec<Value>) {
    let logged = Logged::default();
    let value = tracing::subscriber::with_default(logged.clone(), body);
    (value, logged.take())
}

/// Keeps the `net` events as `{ level, scope, message, data }`, with field names in camelCase as the CJS logs them.
#[derive(Clone, Default)]
struct Logged(Arc<Mutex<Vec<Value>>>);

impl Logged {
    fn take(&self) -> Vec<Value> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

impl Subscriber for Logged {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target().starts_with("net")
    }

    fn new_span(&self, _: &span::Attributes<'_>) -> span::Id {
        span::Id::from_u64(1)
    }

    fn record(&self, _: &span::Id, _: &span::Record<'_>) {}

    fn record_follows_from(&self, _: &span::Id, _: &span::Id) {}

    fn event(&self, event: &Event<'_>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let message = fields.0.remove("message").unwrap_or(Value::Null);
        let data: Map<String, Value> = fields
            .0
            .into_iter()
            .map(|(name, value)| (camel_case(&name), value))
            .collect();
        let line = json!({
            "level": event.metadata().level().as_str().to_ascii_lowercase(),
            "scope": event.metadata().target(),
            "message": message,
            "data": data,
        });
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(line);
    }

    fn enter(&self, _: &span::Id) {}

    fn exit(&self, _: &span::Id) {}
}

/// The fields of one event by name. A message arrives through `Debug`; the other values keep their JSON type.
#[derive(Default)]
struct Fields(Map<String, Value>);

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0
            .insert(field.name().to_owned(), json!(format!("{value:?}")));
    }
}

/// `duration_ms` becomes `durationMs`, the name the CJS logs.
fn camel_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for ch in name.chars() {
        if ch == '_' {
            upper = true;
        } else if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// The provider that issued a request, found from its URL, as the TypeScript runner routes its canned replies.
fn provider_of(url: &str) -> &'static str {
    if url.contains("&format=json") {
        return "searxng";
    }
    const PREFIXES: [(&str, &str); 5] = [
        ("https://html.duckduckgo.com/", "duckduckgo"),
        ("https://lite.duckduckgo.com/", "duckduckgo-lite"),
        ("https://www.startpage.com/", "startpage"),
        ("https://api.search.brave.com/", "brave"),
        ("https://search.brave.com/", "brave-html"),
    ];
    PREFIXES
        .iter()
        .find(|(prefix, _)| url.starts_with(prefix))
        .map_or("unknown", |(_, id)| id)
}

#[derive(Clone)]
struct Reply {
    body: String,
    status: u16,
    error: Option<String>,
}

#[derive(Default)]
struct WebState {
    replies: HashMap<String, Reply>,
    calls: Vec<String>,
}

/// Canned HTTP. Every request is recorded by the provider it went to, and a provider with no reply fails.
#[derive(Clone, Default)]
struct Web(Arc<Mutex<WebState>>);

impl Web {
    fn state(&self) -> std::sync::MutexGuard<'_, WebState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn replace_responses(&self, responses: &Value) {
        let replies = responses
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, reply)| {
                let status = reply["status"]
                    .as_u64()
                    .and_then(|status| u16::try_from(status).ok())
                    .unwrap_or(200);
                let body = reply["body"].as_str().unwrap_or_default().to_owned();
                let error = reply["error"].as_str().map(str::to_owned);
                (
                    id.clone(),
                    Reply {
                        body,
                        status,
                        error,
                    },
                )
            })
            .collect();
        self.state().replies = replies;
    }

    fn take_calls(&self) -> Vec<String> {
        std::mem::take(&mut self.state().calls)
    }

    fn respond(&self, url: &str) -> Result<HttpResponse, HttpError> {
        let id = provider_of(url);
        let mut state = self.state();
        state.calls.push(id.to_owned());
        let Some(reply) = state.replies.get(id).cloned() else {
            return Err(HttpError::Failed(format!("no canned response for {id}")));
        };
        if let Some(message) = reply.error {
            return Err(HttpError::Failed(message));
        }
        Ok(HttpResponse {
            status: reply.status,
            body: reply.body,
        })
    }
}

impl HttpClient for Web {
    fn send(
        &self,
        request: HttpRequest,
    ) -> impl Future<Output = Result<HttpResponse, HttpError>> + Send {
        ready(self.respond(&request.url))
    }
}

/// A virtual clock. Sleeping moves time on at once and is counted, so tests see the waits without waiting.
#[derive(Clone)]
struct Script(Arc<Mutex<ScriptState>>);

#[derive(Default)]
struct ScriptState {
    now: u64,
    slept: u64,
}

impl Script {
    fn new(now: u64) -> Self {
        Self(Arc::new(Mutex::new(ScriptState { now, slept: 0 })))
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ScriptState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set(&self, now: u64) {
        self.state().now = now;
    }

    fn slept(&self) -> u64 {
        self.state().slept
    }
}

impl Clock for Script {
    fn now_ms(&self) -> u64 {
        self.state().now
    }

    fn sleep(&self, ms: u64) -> impl Future<Output = ()> + Send {
        {
            let mut state = self.state();
            state.now += ms;
            state.slept += ms;
        }
        ready(())
    }
}

/// A probe that answers with one status or failure, which a test may change between checks, and records each request with
/// whether it followed redirects.
#[derive(Clone)]
struct Probe {
    reply: Arc<Mutex<Result<u16, HttpError>>>,
    calls: Arc<Mutex<Vec<Value>>>,
}

impl Probe {
    fn new(reply: Result<u16, HttpError>) -> Self {
        Self {
            reply: Arc::new(Mutex::new(reply)),
            calls: Arc::default(),
        }
    }

    fn set_reply(&self, reply: Result<u16, HttpError>) {
        *self.reply.lock().unwrap_or_else(PoisonError::into_inner) = reply;
    }

    fn calls(&self) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl HttpClient for Probe {
    fn send(
        &self,
        request: HttpRequest,
    ) -> impl Future<Output = Result<HttpResponse, HttpError>> + Send {
        let method = match request.method {
            Method::Get => "GET",
            Method::Head => "HEAD",
        };
        self.calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(json!({
                "url": request.url,
                "method": method,
                "followRedirects": request.follow_redirects,
                "timeoutMs": millis(request.timeout),
            }));
        let reply = self
            .reply
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        ready(match reply {
            Ok(status) => Ok(HttpResponse {
                status,
                body: String::new(),
            }),
            Err(error) => Err(error),
        })
    }
}
