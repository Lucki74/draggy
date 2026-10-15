//! Registry search against a fake registry: what is asked, what is kept, and what an offline search still answers.

mod support;

use std::sync::{Arc, Mutex, PoisonError};

use draggy_mcp::net::NetError;
use draggy_mcp::registry::{CACHE_TTL_MS, Cache, FileCache, REGISTRY_URL, Registry, parse_servers};
use serde_json::{Value, json};
use support::{FakeHttp, block_on, capture, json_reply, reply};

/// Three servers: an npm package, a remote, and a Python package that Draggy cannot run.
fn payload() -> Value {
    json!({
        "servers": [
            {
                "name": "io.github.someone/weather",
                "description": "Weather for anywhere.",
                "repository": { "url": "https://github.com/someone/weather" },
                "packages": [{ "registry_name": "npm", "name": "@someone/weather-mcp" }]
            },
            {
                "name": "com.example/tickets",
                "description": "Our ticket system.",
                "remotes": [{ "type": "streamable-http", "url": "https://tickets.example/mcp" }]
            },
            {
                "name": "com.example/python-only",
                "description": "Needs uvx.",
                "packages": [{ "registry_name": "pypi", "name": "python-thing" }]
            }
        ]
    })
}

/// A cache held in memory, shared between the registry and the test that inspects it.
#[derive(Clone, Default)]
struct MemoryCache(Arc<Mutex<Option<String>>>);

impl Cache for MemoryCache {
    fn read(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn write(&self, text: &str) -> Result<(), String> {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(text.to_owned());
        Ok(())
    }

    fn remove(&self) -> Result<(), String> {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = None;
        Ok(())
    }
}

fn search_url(term: &str) -> url::Url {
    let mut url = url::Url::parse(REGISTRY_URL).unwrap_or_else(|error| panic!("{error}"));
    url.query_pairs_mut().append_pair("search", term);
    url
}

#[test]
fn reads_what_the_registry_says_into_entries() {
    let entries = parse_servers(&payload());

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].id, "weather");
    assert_eq!(entries[0].package.as_deref(), Some("@someone/weather-mcp"));
    assert_eq!(
        entries[1].url.as_deref(),
        Some("https://tickets.example/mcp")
    );
    assert_eq!(entries[1].remote, Some(true));
}

#[test]
fn asks_for_what_was_typed() {
    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    let result = block_on(registry.search("weather", 0));

    assert!(result.success);
    assert!(!result.cached);
    assert_eq!(result.entries.len(), 2);

    let requests = http.requests();
    let asked = url::Url::parse(&requests[0].url).unwrap_or_else(|error| panic!("{error}"));
    let query: Vec<(String, String)> = asked
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert!(query.contains(&("search".to_owned(), "weather".to_owned())));
    assert!(query.contains(&("limit".to_owned(), "30".to_owned())));
    assert_eq!(requests[0].method.as_str(), "GET");
    assert_eq!(search_url("weather").host_str(), asked.host_str());
}

#[test]
fn asks_for_the_newest_servers_when_nothing_was_typed() {
    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    block_on(registry.search("   ", 0));

    let asked = url::Url::parse(&http.requests()[0].url).unwrap_or_else(|error| panic!("{error}"));
    assert!(asked.query_pairs().all(|(key, _)| key != "search"));
}

#[test]
fn does_not_ask_twice_for_the_same_search() {
    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    block_on(registry.search("weather", 0));
    let again = block_on(registry.search("weather", 1));

    assert_eq!(http.requests().len(), 1);
    assert!(again.cached);
    assert_eq!(again.entries.len(), 2);
}

#[test]
fn treats_the_search_key_without_regard_to_case() {
    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    block_on(registry.search("Weather", 0));
    let again = block_on(registry.search("weather", 1));

    assert!(again.cached);
    assert_eq!(http.requests().len(), 1);
}

#[test]
fn asks_again_once_the_answer_is_a_day_old() {
    let http = FakeHttp::queue(vec![json_reply(&payload()), json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    block_on(registry.search("weather", 0));
    block_on(registry.search("weather", CACHE_TTL_MS + 1));

    assert_eq!(http.requests().len(), 2);
}

#[test]
fn keeps_the_answer_just_inside_its_day() {
    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http.clone(), MemoryCache::default());

    block_on(registry.search("weather", 0));
    let again = block_on(registry.search("weather", CACHE_TTL_MS - 1));

    assert!(again.cached);
    assert_eq!(http.requests().len(), 1);
}

#[test]
fn hands_back_what_it_knew_when_the_network_is_gone() {
    let http = FakeHttp::queue(vec![
        json_reply(&payload()),
        Err(NetError::Failed("offline".to_owned())),
    ]);
    let registry = Registry::new(http, MemoryCache::default());

    block_on(registry.search("weather", 0));
    let result = block_on(registry.search("weather", CACHE_TTL_MS + 1));

    assert!(result.success);
    assert!(result.stale);
    assert!(result.cached);
    assert_eq!(result.entries.len(), 2);
}

#[test]
fn says_plainly_when_it_has_nothing_and_cannot_ask() {
    let http = FakeHttp::queue(vec![Err(NetError::Failed("offline".to_owned()))]);
    let registry = Registry::new(http, MemoryCache::default());

    let result = block_on(registry.search("weather", 0));

    assert!(!result.success);
    assert!(result.entries.is_empty());
    assert_eq!(result.error.as_deref(), Some("offline"));
}

#[test]
fn treats_an_unhappy_registry_as_no_answer_at_all() {
    let http = FakeHttp::queue(vec![reply(503, "")]);
    let registry = Registry::new(http, MemoryCache::default());

    let result = block_on(registry.search("weather", 0));

    assert!(!result.success);
    assert_eq!(result.error.as_deref(), Some("the registry answered 503"));
}

#[test]
fn treats_an_answer_it_cannot_read_as_a_failure() {
    let http = FakeHttp::queue(vec![reply(200, "<html>")]);
    let registry = Registry::new(http, MemoryCache::default());

    assert!(!block_on(registry.search("weather", 0)).success);
}

#[test]
fn logs_each_search_without_the_search_text() {
    // The second search is served from the cache, so the registry is asked twice: once fresh, once after the day has passed.
    let http = FakeHttp::queue(vec![
        json_reply(&payload()),
        Err(NetError::Failed("offline".to_owned())),
    ]);
    let registry = Registry::new(http, MemoryCache::default());

    let ((), lines) = capture(|| {
        block_on(registry.search("weather-secret", 0));
        block_on(registry.search("weather-secret", 1));
        block_on(registry.search("weather-secret", CACHE_TTL_MS + 1));
    });

    let joined = lines.join("\n");
    assert!(joined.contains("search answered"), "{joined}");
    assert!(joined.contains("search answered from cache"), "{joined}");
    assert!(joined.contains("search failed"), "{joined}");
    assert!(!joined.contains("weather-secret"), "{joined}");
}

#[test]
fn keeps_the_cache_in_the_apps_own_folder_and_forgets_it() {
    let folder = std::env::temp_dir().join(format!("draggy-mcp-registry-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap_or_else(|error| panic!("{error}"));

    let http = FakeHttp::queue(vec![json_reply(&payload())]);
    let registry = Registry::new(http, FileCache::new(&folder));
    block_on(registry.search("weather", 0));

    let kept = folder.join("registry-cache.json");
    assert!(kept.exists());

    registry.forget().unwrap_or_else(|error| panic!("{error}"));
    assert!(!kept.exists());

    std::fs::remove_dir_all(&folder).unwrap_or_else(|error| panic!("{error}"));
}
