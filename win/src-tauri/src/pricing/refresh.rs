//! Keeps the price table and the exchange rates current. The only code that reaches the network for pricing: three
//! fixed GET URLs, no user data in them, nothing followed to another host. Port of electron/pricing/refresh.cjs.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use draggy_diagnostics::Diagnostics;
use draggy_web::http::{HttpClient, HttpError, HttpRequest, HttpResponse, Method};
use serde_json::{Map, Value, json};
use tokio::sync::watch;

use super::build::{LITELLM_URL, OPENROUTER_URL, build_table, parse_iso_ms};
use super::table::{PriceTable, is_usable};

pub const RATES_URL: &str = "https://api.frankfurter.dev/v1/latest?base=USD";
pub const RATES_FILE: &str = "rates.live.json";

/// A copy younger than this is not fetched again by the schedule. A manual update ignores it.
pub const FRESH_MS: i64 = 24 * 60 * 60 * 1000;
const FIRST_CHECK: Duration = Duration::from_secs(45);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BYTES: usize = 20 * 1024 * 1024;

/// The only URLs this module will fetch.
pub const ALLOWED_URLS: [&str; 3] = [LITELLM_URL, OPENROUTER_URL, RATES_URL];

/// Exchange rates with USD as the base, as `{ base, date, rates }`, or none when the answer is not usable.
pub fn parse_rates(body: &Value) -> Option<Value> {
    let body = body.as_object()?;
    if body.get("base")?.as_str()? != "USD" {
        return None;
    }
    let listed = body.get("rates")?.as_object()?;
    let mut rates = Map::new();
    rates.insert("USD".to_owned(), json!(1));
    for (code, rate) in listed {
        let well_formed = code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase());
        if let Some(rate) = rate
            .as_f64()
            .filter(|r| well_formed && r.is_finite() && *r > 0.0)
        {
            rates.insert(code.clone(), json!(rate));
        }
    }
    if rates.len() < 5 {
        return None;
    }
    let date = match body.get("date") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    };
    Some(json!({ "base": "USD", "date": date, "rates": rates }))
}

#[derive(Default)]
struct Status {
    prices_at: Option<i64>,
    prices_error: Option<String>,
    rates_at: Option<i64>,
    rates_error: Option<String>,
}

/// Where a refresh run's result goes: the waiters watch the channel until the run sends its answer.
type Outcome = Option<Value>;

pub struct Refresher<C> {
    client: C,
    user_data: PathBuf,
    table: Arc<PriceTable>,
    log: Option<Arc<Diagnostics>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    on_update: Option<Arc<dyn Fn(Value) + Send + Sync>>,
    status: Mutex<Status>,
    running: Mutex<Option<watch::Receiver<Outcome>>>,
    schedule: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl<C: HttpClient + 'static> Refresher<C> {
    pub fn new(
        client: C,
        user_data: PathBuf,
        table: Arc<PriceTable>,
        log: Option<Arc<Diagnostics>>,
        clock: Arc<dyn Fn() -> i64 + Send + Sync>,
        on_update: Option<Arc<dyn Fn(Value) + Send + Sync>>,
    ) -> Self {
        Self {
            client,
            user_data,
            table,
            log,
            clock,
            on_update,
            status: Mutex::new(Status::default()),
            running: Mutex::new(None),
            schedule: Mutex::new(None),
        }
    }

    /// Both lists, one run at a time. Callers that arrive during a run wait for it and get its answer.
    /// `force` skips the freshness check, as the Update now button does.
    pub async fn refresh(&self, force: bool) -> Value {
        enum Role {
            Wait(watch::Receiver<Outcome>),
            Run(watch::Sender<Outcome>),
        }
        let role = {
            let mut running = lock(&self.running);
            match running.as_ref() {
                Some(receiver) => Role::Wait(receiver.clone()),
                None => {
                    let (sender, receiver) = watch::channel(None);
                    *running = Some(receiver);
                    Role::Run(sender)
                }
            }
        };
        match role {
            Role::Wait(mut receiver) => match receiver.wait_for(Option::is_some).await {
                Ok(answer) => answer.clone().unwrap_or(json!({})),
                Err(_) => json!({}),
            },
            Role::Run(sender) => {
                let outcome = self.run(force).await;
                *lock(&self.running) = None;
                sender.send_replace(Some(outcome.clone()));
                outcome
            }
        }
    }

    async fn run(&self, force: bool) -> Value {
        // Loads the table first so origin() reflects what is in use.
        self.table.get();
        let now = (self.clock)();
        let last_prices = lock(&self.status).prices_at.or_else(|| {
            self.table
                .get()
                .and_then(|t| t.get("generatedAt")?.as_str().and_then(parse_iso_ms))
        });
        let last_rates = lock(&self.status)
            .rates_at
            .or_else(|| self.saved_rates().map(|r| r.fetched_at))
            .unwrap_or(0);
        let stale_prices =
            force || self.table.origin() != "live" || now - last_prices.unwrap_or(0) >= FRESH_MS;
        let stale_rates = force || now - last_rates >= FRESH_MS;
        let prices = if stale_prices {
            self.refresh_prices().await
        } else {
            json!({ "ok": true, "skipped": true })
        };
        let rates = if stale_rates {
            self.refresh_rates().await
        } else {
            json!({ "ok": true, "skipped": true })
        };
        let changed = stale_prices || stale_rates;
        if let Some(on_update) = self.on_update.as_ref().filter(|_| changed) {
            on_update(self.snapshot());
        }
        json!({ "prices": prices, "rates": rates })
    }

    async fn refresh_prices(&self) -> Value {
        let result = self.download_prices().await;
        let mut status = lock(&self.status);
        match result {
            Ok(()) => {
                let at = (self.clock)();
                status.prices_at = Some(at);
                status.prices_error = None;
                json!({ "ok": true, "at": at })
            }
            Err(error) => {
                drop(status);
                self.warn(&format!("price refresh failed: {error}"));
                lock(&self.status).prices_error = Some(error.clone());
                json!({ "ok": false, "error": error })
            }
        }
    }

    async fn download_prices(&self) -> Result<(), String> {
        let (litellm, openrouter) = tokio::join!(
            self.fetch_json(LITELLM_URL),
            self.fetch_json(OPENROUTER_URL)
        );
        let next = build_table(&litellm?, &openrouter?, (self.clock)());
        if !is_usable(&next) {
            return Err("the downloaded list is incomplete".to_owned());
        }
        fs::create_dir_all(&self.user_data).map_err(|e| e.to_string())?;
        let live = self
            .table
            .live_file()
            .unwrap_or_else(|| self.user_data.join(super::table::LIVE_FILE));
        write_atomic(&live, &next.to_string()).map_err(|e| e.to_string())?;
        self.table.reload();
        Ok(())
    }

    async fn refresh_rates(&self) -> Value {
        match self.download_rates().await {
            Ok(at) => {
                let mut status = lock(&self.status);
                status.rates_at = Some(at);
                status.rates_error = None;
                json!({ "ok": true, "at": at })
            }
            Err(error) => {
                self.warn(&format!("rates refresh failed: {error}"));
                lock(&self.status).rates_error = Some(error.clone());
                json!({ "ok": false, "error": error })
            }
        }
    }

    async fn download_rates(&self) -> Result<i64, String> {
        let body = self.fetch_json(RATES_URL).await?;
        let parsed = parse_rates(&body).ok_or("the rates answer is not usable")?;
        let at = (self.clock)();
        let mut saved = parsed.as_object().cloned().unwrap_or_default();
        saved.insert("fetchedAt".to_owned(), json!(at));
        fs::create_dir_all(&self.user_data).map_err(|e| e.to_string())?;
        write_atomic(
            &self.user_data.join(RATES_FILE),
            &Value::Object(saved).to_string(),
        )
        .map_err(|e| e.to_string())?;
        Ok(at)
    }

    /// One allowed GET, answered as its JSON. Errors carry the same words the Electron build gives.
    async fn fetch_json(&self, url: &str) -> Result<Value, String> {
        if !ALLOWED_URLS.contains(&url) {
            return Err("address is not on the pricing allowlist".to_owned());
        }
        let request = HttpRequest {
            method: Method::Get,
            url: url.to_owned(),
            headers: vec![
                ("user-agent".to_owned(), "Draggy-pricing".to_owned()),
                ("accept".to_owned(), "application/json".to_owned()),
            ],
            timeout: TIMEOUT,
            follow_redirects: false,
            page: false,
        };
        let response = self
            .client
            .send(request)
            .await
            .map_err(|error| match error {
                HttpError::Timeout => "The operation was aborted due to timeout".to_owned(),
                HttpError::Failed(_) => "fetch failed".to_owned(),
            })?;
        check_response(&response)?;
        if response.body.len() > MAX_BYTES {
            return Err("answer is too large".to_owned());
        }
        serde_json::from_str(&response.body).map_err(|_| "answer is not JSON".to_owned())
    }

    /// The rates saved on disk with their fetch time, or none when the file is missing or unusable.
    pub fn rates(&self) -> Option<Value> {
        self.saved_rates().map(|saved| saved.value)
    }

    fn saved_rates(&self) -> Option<SavedRates> {
        let saved = read_json(&self.user_data.join(RATES_FILE))?;
        let mut value = parse_rates(&saved)?.as_object().cloned()?;
        let fetched_at = saved
            .get("fetchedAt")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())
            .unwrap_or(0.0);
        value.insert("fetchedAt".to_owned(), json!(fetched_at));
        Some(SavedRates {
            fetched_at: fetched_at as i64,
            value: Value::Object(value),
        })
    }

    /// What the status panel shows: where the table came from and what the last attempts said.
    pub fn snapshot(&self) -> Value {
        let current = self.table.get();
        let price_count = current
            .as_ref()
            .and_then(|t| t.get("providers")?.as_object())
            .map_or(0, |providers| {
                providers
                    .values()
                    .filter_map(Value::as_object)
                    .map(Map::len)
                    .sum()
            });
        let status = lock(&self.status);
        let rates_date = self
            .saved_rates()
            .and_then(|r| r.value.get("date").cloned())
            .filter(|d| d.as_str().is_some_and(|s| !s.is_empty()))
            .unwrap_or(Value::Null);
        json!({
            "origin": self.table.origin(),
            "pricesGeneratedAt": current.as_ref().and_then(|t| t.get("generatedAt").cloned()).unwrap_or(Value::Null),
            "priceCount": price_count,
            "ratesDate": rates_date,
            "pricesAt": status.prices_at,
            "pricesError": status.prices_error,
            "ratesAt": status.rates_at,
            "ratesError": status.rates_error,
        })
    }

    /// Starts or stops the schedule. Off means no request leaves the app on its own.
    pub fn set_automatic(this: &Arc<Self>, on: bool) {
        if let Some(handle) = lock(&this.schedule).take() {
            handle.abort();
        }
        if !on {
            return;
        }
        let me = Arc::clone(this);
        let handle = tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FIRST_CHECK).await;
            loop {
                me.refresh(false).await;
                tokio::time::sleep(CHECK_INTERVAL).await;
            }
        });
        *lock(&this.schedule) = Some(handle);
    }

    fn warn(&self, message: &str) {
        if let Some(log) = &self.log {
            log.warn("pricing", message, None);
        }
    }
}

struct SavedRates {
    fetched_at: i64,
    value: Value,
}

fn check_response(response: &HttpResponse) -> Result<(), String> {
    match response.status {
        200..=299 => Ok(()),
        300..=399 => Err("fetch failed".to_owned()),
        status => Err(format!("answered {status}")),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

/// Writes beside the target and renames over it, so a reader never sees half a file.
fn write_atomic(file: &Path, text: &str) -> std::io::Result<()> {
    let temp = PathBuf::from(format!("{}.{}.tmp", file.display(), std::process::id()));
    fs::write(&temp, text)?;
    fs::rename(&temp, file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pricing::build::LITELLM_URL as LITELLM;
    use crate::pricing::table::LIVE_FILE;
    use std::collections::HashMap;
    use std::future::Future;

    const T0: i64 = 1_790_000_000_000;

    /// Answers each URL from a fixed table and records what was asked for.
    #[derive(Clone)]
    struct Canned {
        routes: Arc<HashMap<String, (u16, String)>>,
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl HttpClient for Canned {
        fn send(
            &self,
            request: HttpRequest,
        ) -> impl Future<Output = Result<HttpResponse, HttpError>> + Send {
            lock(&self.calls).push(request.url.clone());
            let (status, body) = self
                .routes
                .get(&request.url)
                .cloned()
                .unwrap_or((404, String::new()));
            async move { Ok(HttpResponse { status, body }) }
        }
    }

    fn litellm_body(count: usize, input: f64) -> String {
        let entries: Map<String, Value> = (0..count)
            .map(|i| {
                (
                    format!("gpt-{i}"),
                    json!({ "litellm_provider": "openai", "mode": "chat", "input_cost_per_token": input, "output_cost_per_token": input * 2.0 }),
                )
            })
            .collect();
        Value::Object(entries).to_string()
    }

    fn rates_body() -> String {
        json!({ "amount": 1, "base": "USD", "date": "2026-10-28", "rates": { "EUR": 0.9, "GBP": 0.75, "JPY": 158, "CAD": 1.4, "AUD": 1.42 } })
            .to_string()
    }

    struct Harness {
        dir: tempfile::TempDir,
        clock: Arc<Mutex<i64>>,
        calls: Arc<Mutex<Vec<String>>>,
        routes: HashMap<String, (u16, String)>,
        table: Arc<PriceTable>,
    }

    impl Harness {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("tempdir");
            let bundled = dir.path().join("prices.json");
            let providers: Map<String, Value> = [(
                "openai".to_owned(),
                Value::Object(
                    (0..250)
                        .map(|i| {
                            (
                                format!("gpt-{i}"),
                                json!({ "inputPerM": 5, "outputPerM": 10 }),
                            )
                        })
                        .collect(),
                ),
            )]
            .into_iter()
            .collect();
            fs::write(&bundled, json!({ "version": 1, "generatedAt": "2026-01-01T00:00:00.000Z", "providers": providers }).to_string()).expect("write");
            let user_data = dir.path().join("user");
            let table = Arc::new(PriceTable::new(Some(user_data), bundled, None));
            let mut routes = HashMap::new();
            routes.insert(LITELLM.to_owned(), (200, litellm_body(250, 1e-6)));
            routes.insert(
                OPENROUTER_URL.to_owned(),
                (200, json!({ "data": [] }).to_string()),
            );
            routes.insert(RATES_URL.to_owned(), (200, rates_body()));
            Self {
                dir,
                clock: Arc::new(Mutex::new(T0)),
                calls: Arc::new(Mutex::new(Vec::new())),
                routes,
                table,
            }
        }

        fn user_data(&self) -> PathBuf {
            self.dir.path().join("user")
        }

        fn refresher(&self) -> Refresher<Canned> {
            let clock = Arc::clone(&self.clock);
            Refresher::new(
                Canned {
                    routes: Arc::new(self.routes.clone()),
                    calls: Arc::clone(&self.calls),
                },
                self.user_data(),
                Arc::clone(&self.table),
                None,
                Arc::new(move || *lock(&clock)),
                None,
            )
        }

        fn calls(&self) -> Vec<String> {
            lock(&self.calls).clone()
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    #[test]
    fn the_app_may_fetch_only_the_three_public_lists() {
        assert_eq!(ALLOWED_URLS, [LITELLM_URL, OPENROUTER_URL, RATES_URL]);
        for url in ALLOWED_URLS {
            assert!(url.starts_with("https://"));
        }
    }

    #[test]
    fn a_good_download_is_written_beside_the_app_data_and_used() {
        let h = Harness::new();
        let result = block_on(h.refresher().refresh(true));
        assert_eq!(result["prices"]["ok"], true);
        assert!(h.user_data().join(LIVE_FILE).exists());
        assert_eq!(h.table.origin(), "live");
        assert_eq!(
            h.table.get().expect("table")["providers"]["openai"]["gpt-0"]["inputPerM"],
            1.0
        );
    }

    #[test]
    fn a_list_that_is_too_small_keeps_the_old_table() {
        let mut h = Harness::new();
        h.routes
            .insert(LITELLM.to_owned(), (200, litellm_body(10, 1e-6)));
        let result = block_on(h.refresher().refresh(true));
        assert_eq!(result["prices"]["ok"], false);
        assert_eq!(
            result["prices"]["error"],
            "the downloaded list is incomplete"
        );
        assert!(!h.user_data().join(LIVE_FILE).exists());
        assert_eq!(
            h.table.get().expect("table")["providers"]["openai"]["gpt-0"]["inputPerM"],
            5.0
        );
    }

    #[test]
    fn a_failed_request_keeps_the_old_table_and_says_why() {
        let mut h = Harness::new();
        h.routes
            .insert(OPENROUTER_URL.to_owned(), (503, String::new()));
        let refresher = h.refresher();
        let result = block_on(refresher.refresh(true));
        assert_eq!(
            result["prices"],
            json!({ "ok": false, "error": "answered 503" })
        );
        assert_eq!(h.table.origin(), "bundled");
        assert_eq!(refresher.snapshot()["pricesError"], "answered 503");
    }

    #[test]
    fn does_not_fetch_again_inside_a_day_but_does_once_the_copy_is_old() {
        let h = Harness::new();
        let refresher = h.refresher();
        block_on(refresher.refresh(true));
        lock(&h.calls).clear();

        *lock(&h.clock) += FRESH_MS - 1;
        block_on(refresher.refresh(false));
        assert!(h.calls().is_empty());

        *lock(&h.clock) += 2;
        block_on(refresher.refresh(false));
        assert!(h.calls().contains(&LITELLM_URL.to_owned()));
        assert!(h.calls().contains(&RATES_URL.to_owned()));
    }

    #[test]
    fn the_caller_is_told_what_changed() {
        let h = Harness::new();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let clock = Arc::clone(&h.clock);
        let refresher = Refresher::new(
            Canned {
                routes: Arc::new(h.routes.clone()),
                calls: Arc::clone(&h.calls),
            },
            h.user_data(),
            Arc::clone(&h.table),
            None,
            Arc::new(move || *lock(&clock)),
            Some(Arc::new(move |status| lock(&sink).push(status))),
        );
        block_on(refresher.refresh(true));
        let seen = lock(&seen);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0]["origin"], "live");
        assert_eq!(seen[0]["ratesDate"], "2026-10-28");
    }

    #[test]
    fn exchange_rates_keep_usd_at_one_and_drop_malformed_codes() {
        let body: Value = json!({ "base": "USD", "date": "d", "rates": { "EUR": 0.9, "GBP": 0.75, "JPY": 158, "CAD": 1.4, "AUD": 1.42, "bad": 1, "XXX": -2, "YYY": "3" } });
        let parsed = parse_rates(&body).expect("usable");
        assert_eq!(parsed["rates"]["USD"], 1.0);
        assert_eq!(parsed["rates"].as_object().expect("rates").len(), 6);
        assert!(parsed["rates"].get("bad").is_none());
    }

    #[test]
    fn rates_with_another_base_or_too_few_codes_are_refused() {
        assert!(parse_rates(&json!({ "base": "EUR", "rates": { "EUR": 0.9, "GBP": 1.0, "JPY": 1.0, "CAD": 1.0, "AUD": 1.0 } })).is_none());
        assert!(parse_rates(&json!({ "base": "USD", "rates": { "EUR": 0.9 } })).is_none());
        assert!(parse_rates(&Value::Null).is_none());
    }

    #[test]
    fn rates_are_stored_and_read_back_with_their_fetch_time() {
        let h = Harness::new();
        let refresher = h.refresher();
        block_on(refresher.refresh(true));
        assert!(h.user_data().join(RATES_FILE).exists());
        let rates = refresher.rates().expect("saved");
        assert_eq!(rates["base"], "USD");
        assert_eq!(rates["date"], "2026-10-28");
        assert_eq!(rates["fetchedAt"], T0 as f64);
        assert_eq!(rates["rates"]["EUR"], 0.9);
    }

    #[test]
    fn bad_rates_leave_no_rates() {
        let mut h = Harness::new();
        h.routes.insert(
            RATES_URL.to_owned(),
            (200, json!({ "base": "USD", "rates": {} }).to_string()),
        );
        let refresher = h.refresher();
        let result = block_on(refresher.refresh(true));
        assert_eq!(result["rates"]["ok"], false);
        assert!(refresher.rates().is_none());
    }
}
