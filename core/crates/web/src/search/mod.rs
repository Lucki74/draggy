//! Provider chain, pacing, cache and request building.
//! Scrapers parse the page as received, so a page that needs JavaScript to fill in results parses empty.

mod dom;
mod parse;

use std::collections::HashMap;
use std::future::Future;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::http::{HttpClient, HttpRequest, Method};
use crate::js::{encode_uri_component, js_trim, utf16_prefix};

pub use parse::{
    ProviderError, block_reason, canonical_url, domain_of, normalise_results, parse_response,
    unwrap_redirect,
};

pub const RESULT_LIMIT: usize = 10;
/// The smallest gap between two requests to one provider. Firing five at once returns empty pages.
pub const PROVIDER_GAP_MS: u64 = 900;
/// Repeated questions are answered from memory for this long.
pub const CACHE_TTL_MS: u64 = 5 * 60 * 1000;
pub const CACHE_LIMIT: usize = 80;
/// How long a provider that served a block page is left alone, by how many blocks in a row.
pub const COOLDOWNS_MS: [u64; 3] = [30_000, 120_000, 600_000];
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
    Ecosia,
}

impl Provider {
    pub const ALL: [Provider; 7] = [
        Provider::Searxng,
        Provider::Brave,
        Provider::DuckDuckGo,
        Provider::Startpage,
        Provider::DuckDuckGoLite,
        Provider::BraveHtml,
        Provider::Ecosia,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Searxng => "searxng",
            Self::Brave => "brave",
            Self::DuckDuckGo => "duckduckgo",
            Self::Startpage => "startpage",
            Self::DuckDuckGoLite => "duckduckgo-lite",
            Self::BraveHtml => "brave-html",
            Self::Ecosia => "ecosia",
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
        Provider::Ecosia => (
            format!("https://www.ecosia.org/search?q={query}"),
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
                | Provider::Ecosia
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
/// `Blocked` means no provider answered and at least one refused us with a block page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    Empty,
    Unavailable,
    Blocked,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Empty => "empty",
            Self::Unavailable => "unavailable",
            Self::Blocked => "blocked",
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
    /// Blocks in a row and the time a blocked provider may be asked again.
    cooldowns: HashMap<Provider, (usize, u64)>,
    cache: Vec<CacheEntry>,
}

impl<H: HttpClient, C: Clock> Search<H, C> {
    pub fn new(http: H, clock: C) -> Self {
        Self {
            http,
            clock,
            last_call_ms: HashMap::new(),
            cooldowns: HashMap::new(),
            cache: Vec::new(),
        }
    }

    /// Forgets the cache and the pacing history.
    pub fn clear(&mut self) {
        self.cache.clear();
        self.last_call_ms.clear();
        self.cooldowns.clear();
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
        let chain = build_chain(config);
        let mut order: Vec<Provider> = chain
            .iter()
            .copied()
            .filter(|provider| !self.cooling_down(*provider))
            .collect();
        let mut any_blocked = order.len() < chain.len();
        // All cooling down: still ask the one due back first, so a search never fails without a request.
        if order.is_empty() {
            order.extend(chain.iter().copied().min_by_key(|provider| {
                self.cooldowns.get(provider).map_or(0, |&(_, until)| until)
            }));
        }
        for provider in order {
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
                    self.cooldowns.remove(&provider);
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
                Err(ProviderError::Blocked(reason)) => {
                    any_blocked = true;
                    let cooldown_ms = self.record_block(provider);
                    tracing::warn!(target: "net.search", provider = provider.id(), reason, cooldown_ms, "provider blocked");
                }
                Err(error) => {
                    let duration_ms = self.clock.now_ms().saturating_sub(started);
                    let logged = failure_log_text(&error.to_string(), term);
                    tracing::warn!(target: "net.search", provider = provider.id(), duration_ms, error = logged, "provider failed");
                }
            }
        }

        // A block page parses to nothing, so it must never read as an empty web: that would be remembered.
        let status = if any_answered {
            Status::Empty
        } else if any_blocked {
            Status::Blocked
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
        // An outage or a block is worth retrying later, so only a genuine empty result is remembered.
        if status == Status::Empty {
            self.write_cache(key, &outcome);
        }
        outcome
    }

    /// Reserves the provider's next slot, then waits for it, as the CJS does so overlapping calls queue a gap apart.
    async fn pace(&mut self, provider: Provider) {
        let ready_at = self
            .last_call_ms
            .get(&provider)
            .copied()
            .unwrap_or_default()
            + PROVIDER_GAP_MS;
        let now = self.clock.now_ms();
        let slot = ready_at.max(now);
        self.last_call_ms.insert(provider, slot);
        if slot > now {
            self.clock.sleep(slot - now).await;
        }
    }

    fn cooling_down(&self, provider: Provider) -> bool {
        self.cooldowns
            .get(&provider)
            .is_some_and(|&(_, until)| self.clock.now_ms() < until)
    }

    /// Counts another block in a row and returns how long the provider is now left alone.
    fn record_block(&mut self, provider: Provider) -> u64 {
        let strikes = self.cooldowns.get(&provider).map_or(0, |&(count, _)| count) + 1;
        let cooldown_ms = COOLDOWNS_MS[strikes.min(COOLDOWNS_MS.len()) - 1];
        self.cooldowns
            .insert(provider, (strikes, self.clock.now_ms() + cooldown_ms));
        cooldown_ms
    }

    async fn fetch(
        &self,
        provider: Provider,
        term: &str,
        config: &SearchConfig,
    ) -> Result<Vec<SearchResult>, ProviderError> {
        let request = build_request(provider, term, config);
        let response = self.http.send(request).await?;
        // Scraped links resolve against the address that answered, which a redirect may have moved.
        parse_response(
            provider,
            &response.final_url,
            response.status,
            &response.body,
        )
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

#[cfg(test)]
mod tests {
    use std::future::{Future, ready};

    use super::*;
    use crate::http::{HttpError, HttpResponse};

    /// Answers every request with one page, as if the address had redirected to `final_url`.
    struct Canned {
        final_url: &'static str,
        body: &'static str,
    }

    impl HttpClient for Canned {
        fn send(
            &self,
            _request: HttpRequest,
        ) -> impl Future<Output = Result<HttpResponse, HttpError>> + Send {
            ready(Ok(HttpResponse {
                status: 200,
                body: self.body.to_owned(),
                final_url: self.final_url.to_owned(),
            }))
        }
    }

    const ONE_RESULT: &str =
        r#"<div class="result"><a class="result__a" href="/item/1">Item</a></div>"#;

    #[test]
    fn relative_links_resolve_against_the_final_url() {
        let search = Search::new(
            Canned {
                final_url: "https://final.example.net/dir/page",
                body: ONE_RESULT,
            },
            SystemClock,
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let rows = runtime
            .block_on(search.fetch(Provider::DuckDuckGo, "term", &SearchConfig::default()))
            .unwrap();
        assert_eq!(rows[0].url, "https://final.example.net/item/1");
    }

    #[test]
    fn all_cooling_down_still_asks_the_provider_due_back_first() {
        let mut search = Search::new(
            Canned {
                final_url: "https://html.duckduckgo.com/html/",
                body: "<html><head><title>Captcha</title></head><body></body></html>",
            },
            SystemClock,
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let config = SearchConfig::default();
        let first = runtime.block_on(search.run("term", &config));
        assert_eq!(first.status, Status::Blocked);
        assert_eq!(first.tried.len(), build_chain(&config).len());
        let second = runtime.block_on(search.run("term", &config));
        assert_eq!(second.status, Status::Blocked);
        assert_eq!(second.tried, vec![Provider::DuckDuckGo]);
    }

    #[test]
    fn page_providers_request_redirects_so_the_policy_checks_each_hop() {
        let request = build_request(Provider::DuckDuckGo, "term", &SearchConfig::default());
        assert!(request.follow_redirects);
        assert!(request.page);
    }
}
