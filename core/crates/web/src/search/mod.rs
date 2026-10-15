//! Provider chain, pacing, cache and request building. Port of electron/search.cjs.
//! Scrapers parse the page as received, so a page that needs JavaScript to fill in results parses empty.

mod dom;
mod parse;

use std::collections::HashMap;
use std::future::Future;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::http::{HttpClient, HttpRequest, Method};
use crate::js::{encode_uri_component, js_trim, utf16_prefix};

pub use parse::{ProviderError, normalise_results, parse_response, unwrap_redirect};

pub const RESULT_LIMIT: usize = 10;
/// The smallest gap between two requests to one provider. Firing five at once returns empty pages.
pub const PROVIDER_GAP_MS: u64 = 900;
/// Repeated questions are answered from memory for this long.
pub const CACHE_TTL_MS: u64 = 5 * 60 * 1000;
const CACHE_LIMIT: usize = 80;
pub const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const API_TIMEOUT: Duration = Duration::from_secs(15);
const PAGE_TIMEOUT: Duration = Duration::from_secs(30);

/// The search providers, in the order the CJS lists them (`PROVIDER_IDS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Provider {
    Searxng,
    Brave,
    DuckDuckGo,
    Startpage,
    DuckDuckGoLite,
    BraveHtml,
}

impl Provider {
    pub const ALL: [Provider; 6] = [
        Provider::Searxng,
        Provider::Brave,
        Provider::DuckDuckGo,
        Provider::Startpage,
        Provider::DuckDuckGoLite,
        Provider::BraveHtml,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Searxng => "searxng",
            Self::Brave => "brave",
            Self::DuckDuckGo => "duckduckgo",
            Self::Startpage => "startpage",
            Self::DuckDuckGoLite => "duckduckgo-lite",
            Self::BraveHtml => "brave-html",
        }
    }

    /// Only SearXNG and the Brave API need a setting. The scrapers are always offered.
    fn configured(self, config: &SearchConfig) -> bool {
        match self {
            Self::Searxng => !config.searxng_url.is_empty(),
            Self::Brave => !config.brave_api_key.is_empty(),
            _ => true,
        }
    }
}

/// The settings a search reads. The key is a plain parameter here; the app keeps it in its own store.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchConfig {
    /// An empty value means "auto".
    pub search_provider: String,
    pub searxng_url: String,
    pub brave_api_key: String,
}

/// The provider the user prefers, or "auto" when none is set.
fn preferred(config: &SearchConfig) -> &str {
    if config.search_provider.is_empty() {
        "auto"
    } else {
        config.search_provider.as_str()
    }
}

/// The providers to try, in order. A preferred provider moves to the front, the others keep their order.
pub fn build_chain(config: &SearchConfig) -> Vec<Provider> {
    let preferred = preferred(config);
    let available: Vec<Provider> = Provider::ALL
        .into_iter()
        .filter(|provider| provider.configured(config))
        .collect();
    if preferred == "auto" {
        return available;
    }
    let mut chain: Vec<Provider> = available
        .iter()
        .copied()
        .filter(|provider| provider.id() == preferred)
        .collect();
    chain.extend(
        available
            .iter()
            .copied()
            .filter(|provider| provider.id() != preferred),
    );
    chain
}

/// The request a provider sends for a query: URL, headers and how long it may take.
pub fn build_request(provider: Provider, term: &str, config: &SearchConfig) -> HttpRequest {
    let query = encode_uri_component(term);
    let (url, headers, timeout) = match provider {
        Provider::Searxng => (
            format!(
                "{}/search?q={query}&format=json&safesearch=0",
                config.searxng_url.trim_end_matches('/')
            ),
            pairs(&[("Accept", "application/json"), ("User-Agent", "Draggy")]),
            API_TIMEOUT,
        ),
        Provider::Brave => (
            format!(
                "https://api.search.brave.com/res/v1/web/search?q={query}&count={RESULT_LIMIT}"
            ),
            pairs(&[
                ("Accept", "application/json"),
                ("X-Subscription-Token", config.brave_api_key.as_str()),
            ]),
            API_TIMEOUT,
        ),
        Provider::DuckDuckGo => (
            format!("https://html.duckduckgo.com/html/?q={query}"),
            pairs(&[("User-Agent", DESKTOP_USER_AGENT)]),
            PAGE_TIMEOUT,
        ),
        Provider::Startpage => (
            format!("https://www.startpage.com/sp/search?query={query}"),
            pairs(&[("User-Agent", DESKTOP_USER_AGENT)]),
            PAGE_TIMEOUT,
        ),
        Provider::DuckDuckGoLite => (
            format!("https://lite.duckduckgo.com/lite/?q={query}"),
            pairs(&[("User-Agent", DESKTOP_USER_AGENT)]),
            PAGE_TIMEOUT,
        ),
        Provider::BraveHtml => (
            format!("https://search.brave.com/search?q={query}"),
            pairs(&[("User-Agent", DESKTOP_USER_AGENT)]),
            PAGE_TIMEOUT,
        ),
    };
    HttpRequest {
        method: Method::Get,
        url,
        headers,
        timeout,
        follow_redirects: true,
        page: matches!(
            provider,
            Provider::DuckDuckGo
                | Provider::Startpage
                | Provider::DuckDuckGoLite
                | Provider::BraveHtml
        ),
    }
}

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

/// One result: a title, an http(s) url and a snippet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// `Ok` means some provider answered with results. `Empty` means the web had nothing. `Unavailable` means nobody answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    Empty,
    Unavailable,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Empty => "empty",
            Self::Unavailable => "unavailable",
        }
    }
}

/// What a search returned: the results, the provider that answered, the providers tried in order and the status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub results: Vec<SearchResult>,
    pub provider: Option<Provider>,
    pub tried: Vec<Provider>,
    pub status: Status,
    pub cached: bool,
}

/// Milliseconds and sleeping, injected so tests can run pacing and the cache on a virtual clock.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
    fn sleep(&self, ms: u64) -> impl Future<Output = ()> + Send;
}

/// Wall time and tokio sleeps.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or_default()
    }

    fn sleep(&self, ms: u64) -> impl Future<Output = ()> + Send {
        tokio::time::sleep(Duration::from_millis(ms))
    }
}

struct CacheEntry {
    key: String,
    at_ms: u64,
    outcome: Outcome,
}

/// Runs the provider chain with pacing and a cache. One instance keeps one history, as the CJS module does.
pub struct Search<H, C> {
    http: H,
    clock: C,
    last_call_ms: HashMap<Provider, u64>,
    cache: Vec<CacheEntry>,
}

impl<H: HttpClient, C: Clock> Search<H, C> {
    pub fn new(http: H, clock: C) -> Self {
        Self {
            http,
            clock,
            last_call_ms: HashMap::new(),
            cache: Vec::new(),
        }
    }

    /// Forgets the cache and the pacing history.
    pub fn clear(&mut self) {
        self.cache.clear();
        self.last_call_ms.clear();
    }

    /// Runs the chain until something answers. An empty query calls no provider.
    pub async fn run(&mut self, query: &str, config: &SearchConfig) -> Outcome {
        let term = js_trim(query);
        if term.is_empty() {
            return Outcome {
                results: Vec::new(),
                provider: None,
                tried: Vec::new(),
                status: Status::Empty,
                cached: false,
            };
        }
        let key = format!("{}::{}", preferred(config), term.to_lowercase());
        if let Some(hit) = self.read_cache(&key) {
            return Outcome {
                cached: true,
                ..hit
            };
        }

        let mut tried = Vec::new();
        let mut any_answered = false;
        for provider in build_chain(config) {
            tried.push(provider);
            let started = self.clock.now_ms();
            self.pace(provider).await;
            match self.fetch(provider, term, config).await {
                Ok(results) => {
                    any_answered = true;
                    let duration_ms = self.clock.now_ms().saturating_sub(started);
                    if results.is_empty() {
                        tracing::info!(target: "net.search", provider = provider.id(), results = 0, duration_ms, "search empty");
                        continue;
                    }
                    tracing::info!(target: "net.search", provider = provider.id(), results = results.len(), duration_ms, "search answered");
                    let outcome = Outcome {
                        results,
                        provider: Some(provider),
                        tried: tried.clone(),
                        status: Status::Ok,
                        cached: false,
                    };
                    self.write_cache(key, &outcome);
                    return outcome;
                }
                Err(error) => {
                    let duration_ms = self.clock.now_ms().saturating_sub(started);
                    let logged = failure_log_text(&error.to_string(), term);
                    tracing::warn!(target: "net.search", provider = provider.id(), duration_ms, error = logged, "provider failed");
                }
            }
        }

        let status = if any_answered {
            Status::Empty
        } else {
            Status::Unavailable
        };
        let outcome = Outcome {
            results: Vec::new(),
            provider: None,
            tried,
            status,
            cached: false,
        };
        // A provider outage is worth retrying on the next question, so only a genuine empty result is remembered.
        if status == Status::Empty {
            self.write_cache(key, &outcome);
        }
        outcome
    }

    /// Waits until the provider's gap has passed since its last call, then records this call.
    async fn pace(&mut self, provider: Provider) {
        let ready_at = self
            .last_call_ms
            .get(&provider)
            .copied()
            .unwrap_or_default()
            + PROVIDER_GAP_MS;
        let now = self.clock.now_ms();
        if ready_at > now {
            self.clock.sleep(ready_at - now).await;
        }
        let after = self.clock.now_ms();
        self.last_call_ms.insert(provider, after);
    }

    async fn fetch(
        &self,
        provider: Provider,
        term: &str,
        config: &SearchConfig,
    ) -> Result<Vec<SearchResult>, ProviderError> {
        let request = build_request(provider, term, config);
        let page_url = request.url.clone();
        let response = self.http.send(request).await?;
        parse_response(provider, &page_url, response.status, &response.body)
    }

    /// A hit refreshes nothing. An entry older than the TTL is dropped and counts as a miss.
    fn read_cache(&mut self, key: &str) -> Option<Outcome> {
        let index = self.cache.iter().position(|entry| entry.key == key)?;
        if self.clock.now_ms().saturating_sub(self.cache[index].at_ms) > CACHE_TTL_MS {
            self.cache.remove(index);
            return None;
        }
        Some(self.cache[index].outcome.clone())
    }

    /// Replaces an existing key in place, as a JavaScript Map does, and evicts the oldest entries past the limit.
    /// The in-place branch is reached only when two searches for one key overlap, which `&mut self` rules out here.
    fn write_cache(&mut self, key: String, outcome: &Outcome) {
        let at_ms = self.clock.now_ms();
        match self.cache.iter().position(|entry| entry.key == key) {
            Some(index) => {
                self.cache[index].at_ms = at_ms;
                self.cache[index].outcome = outcome.clone();
            }
            None => self.cache.push(CacheEntry {
                key,
                at_ms,
                outcome: outcome.clone(),
            }),
        }
        while self.cache.len() > CACHE_LIMIT {
            self.cache.remove(0);
        }
    }
}

/// The error text a failed provider logs: the query cut out, then at most 120 UTF-16 units.
pub fn failure_log_text(message: &str, term: &str) -> String {
    utf16_prefix(&redact_query(message, term), 120).into_owned()
}

/// Provider error text can echo the request URL, so the query is cut out before it is logged.
fn redact_query(message: &str, term: &str) -> String {
    let encoded = encode_uri_component(term);
    let plus = encoded.replace("%20", "+");
    let mut text = message.to_owned();
    // A form equal to an earlier one is cut once, as the CJS Set dedupes them; a second pass would wrap the marker again.
    let mut seen: Vec<&str> = Vec::new();
    for form in [term, encoded.as_str(), plus.as_str()] {
        if form.is_empty() || seen.contains(&form) {
            continue;
        }
        seen.push(form);
        text = text.replace(form, "[query]");
    }
    text
}
