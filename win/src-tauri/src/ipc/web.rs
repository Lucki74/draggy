//! Handlers for the web search and page channels.
//! Keys stay in the keystore: the renderer gets only whether one is set.

pub(crate) mod keys;
mod sources;

use std::sync::{Mutex, OnceLock, PoisonError};

use draggy_documents::office_pdf::read_pdf;
use draggy_web::http::ReqwestClient;
use draggy_web::page::{BlockKind, PageCache, PageRead, ReadOutcome, ReqwestPageSource, read_page};
use draggy_web::search::{
    Clock, Outcome, Provider, Search, SearchConfig, SearchResult, Status, SystemClock,
};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry};
use crate::AppState;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "search-web" => search_web);
    register!(registry, "search-web-detailed" => search_web_detailed);
    register!(registry, "search-source" => search_source);
    register!(registry, "get-page-content" => get_page_content);
    register!(registry, "set-search-config" => set_search_config);
    register!(registry, "search:brave-key-status" => brave_key_status);
    register!(registry, "search:set-brave-key" => set_brave_key);
    register!(registry, "search:service-key-status" => service_key_status);
    register!(registry, "search:set-service-key" => set_service_key);
}

/// The provider and SearXNG settings. The Brave key is read from the keystore for each search.
static CONFIG: Mutex<SearchConfig> = Mutex::new(SearchConfig {
    search_provider: String::new(),
    searxng_url: String::new(),
    brave_api_key: String::new(),
});

type Engine = tokio::sync::Mutex<Search<ReqwestClient, SystemClock>>;

/// One search history for the app, as the CJS module keeps one. `None` when the TLS backend cannot start.
static ENGINE: OnceLock<Option<Engine>> = OnceLock::new();
static HTTP: OnceLock<Option<ReqwestClient>> = OnceLock::new();
static PAGE_SOURCE: OnceLock<Option<ReqwestPageSource>> = OnceLock::new();
static PAGE_CACHE: OnceLock<tokio::sync::Mutex<PageCache>> = OnceLock::new();

fn engine() -> Option<&'static Engine> {
    ENGINE
        .get_or_init(|| {
            ReqwestClient::new()
                .ok()
                .map(|http| tokio::sync::Mutex::new(Search::new(http, SystemClock)))
        })
        .as_ref()
}

fn http() -> Option<&'static ReqwestClient> {
    HTTP.get_or_init(|| ReqwestClient::new().ok()).as_ref()
}

/// `String(value ?? "")`: a string as it is, nothing for a missing or null value, the JSON text otherwise.
fn text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

fn result_json(row: &SearchResult) -> Value {
    json!({ "title": row.title, "url": row.url, "snippet": row.snippet })
}

fn search_outcome_json(outcome: &Outcome) -> Value {
    let mut out = json!({
        "results": outcome.results.iter().map(result_json).collect::<Vec<_>>(),
        "provider": outcome.provider.map(Provider::id),
        "tried": outcome.tried.iter().map(|provider| provider.id()).collect::<Vec<_>>(),
        "status": outcome.status.as_str(),
    });
    if outcome.cached {
        out["cached"] = json!(true);
    }
    out
}

/// One search with the saved settings and the Brave key. The engine is shared, so searches queue behind each other.
async fn run_search(app: &AppHandle, query: &str) -> Outcome {
    let mut config = CONFIG
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    config.brave_api_key = keys::BRAVE.key(app);
    let Some(engine) = engine() else {
        return Outcome {
            results: Vec::new(),
            provider: None,
            tried: Vec::new(),
            status: Status::Unavailable,
            cached: false,
        };
    };
    engine.lock().await.run(query, &config).await
}

async fn search_web(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let outcome = run_search(&app, &text(args.first())).await;
    Ok(Value::Array(
        outcome.results.iter().map(result_json).collect(),
    ))
}

async fn search_web_detailed(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let outcome = run_search(&app, &text(args.first())).await;
    Ok(search_outcome_json(&outcome))
}

async fn search_source(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = text(args.first());
    let source = text(args.get(1));
    let Some(http) = http() else {
        return Ok(
            json!({ "results": [], "provider": null, "tried": [], "status": "unavailable" }),
        );
    };
    let keys = sources::Keys {
        openalex: keys::OPENALEX.key(&app),
        github: keys::GITHUB.key(&app),
    };
    let version = app.package_info().version.to_string();
    let diag = std::sync::Arc::clone(&app.state::<AppState>().diag);
    let deps = sources::Deps {
        http,
        diag: &diag,
        version: &version,
        keys: &keys,
    };
    let outcome = sources::search(&deps, &query, &source).await;
    Ok(sources::outcome_json(&outcome))
}

async fn set_search_config(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let config = args.first().unwrap_or(&Value::Null);
    let provider = config
        .get("searchProvider")
        .and_then(Value::as_str)
        .filter(|id| Provider::ALL.iter().any(|known| known.id() == *id))
        .unwrap_or("auto");
    let searxng = text(config.get("searxngUrl"));
    let mut current = CONFIG.lock().unwrap_or_else(PoisonError::into_inner);
    current.search_provider = provider.to_owned();
    current.searxng_url = searxng.trim().to_owned();
    Ok(json!({ "success": true }))
}

async fn brave_key_status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(keys::BRAVE.status(&app, true))
}

async fn set_brave_key(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(keys::BRAVE.set(&app, &text(args.first())))
}

/// Only OpenAlex and GitHub have a service key. The status never carries any part of the key.
fn service_slot(id: Option<&Value>) -> Option<&'static keys::Slot> {
    match id?.as_str()? {
        "openalex" => Some(&keys::OPENALEX),
        "github" => Some(&keys::GITHUB),
        _ => None,
    }
}

async fn service_key_status(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(match service_slot(args.first()) {
        Some(slot) => slot.status(&app, false),
        None => json!({ "hasKey": false, "keystore": false }),
    })
}

async fn set_service_key(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(match service_slot(args.first()) {
        Some(slot) => slot.set(&app, &text(args.get(1))),
        None => json!({ "success": false, "kept": false }),
    })
}

/// The page number, as `Number(page) || 1` with the integer check the reader applies.
fn page_number(value: Option<&Value>) -> u64 {
    let number = match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    match number {
        Some(n) if n >= 1.0 && n.is_finite() && n.fract() == 0.0 => n as u64,
        _ => 1,
    }
}

fn page_json(page: PageRead) -> Value {
    let mut out = Map::new();
    out.insert("title".to_owned(), json!(page.title));
    out.insert("text".to_owned(), json!(page.text));
    out.insert("url".to_owned(), json!(page.url));
    out.insert("canonicalUrl".to_owned(), json!(page.canonical_url));
    let optional = [
        ("site", page.meta.site),
        ("author", page.meta.author),
        ("published", page.meta.published),
        ("modified", page.meta.modified),
        ("language", page.meta.language),
    ];
    for (key, value) in optional {
        if let Some(value) = value {
            out.insert(key.to_owned(), json!(value));
        }
    }
    out.insert("pageCount".to_owned(), json!(page.page_count));
    out.insert("page".to_owned(), json!(page.page));
    out.insert("pageNote".to_owned(), json!(page.page_note));
    Value::Object(out)
}

/// The renderer's blocked shapes: `blocked` names the kind, `reason` is absent for human verification.
fn blocked_json(url: &str, kind: &str, reason: &str) -> Value {
    let mut out = json!({ "title": "", "text": "", "blocked": kind, "url": url });
    if !reason.is_empty() {
        out["reason"] = json!(reason);
    }
    out
}

fn read_json(outcome: ReadOutcome, url: &str) -> Value {
    match outcome {
        ReadOutcome::Page(page) => page_json(page),
        ReadOutcome::Blocked(blocked) => {
            let kind = match blocked.kind {
                BlockKind::Refused => "refused",
                BlockKind::Unreachable => "unreachable",
                BlockKind::HumanVerification => "human-verification",
            };
            blocked_json(url, kind, &blocked.reason)
        }
    }
}

async fn get_page_content(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let url = text(args.first());
    let page = page_number(args.get(1));
    let Some(source) = PAGE_SOURCE.get_or_init(ReqwestPageSource::new).as_ref() else {
        return Ok(blocked_json(
            &url,
            "unreachable",
            "That page could not be fetched.",
        ));
    };
    let pages = PAGE_CACHE.get_or_init(|| tokio::sync::Mutex::new(PageCache::new()));
    let mut cache = pages.lock().await;
    let pdf = |bytes: &[u8]| read_pdf(bytes).map_err(|error| error.to_string());
    let outcome = read_page(
        &mut cache,
        source,
        &url,
        Some(page),
        SystemClock.now_ms(),
        &pdf,
    )
    .await;
    Ok(read_json(outcome, &url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_number_matches_number_or_one() {
        assert_eq!(page_number(None), 1);
        assert_eq!(page_number(Some(&json!(3))), 3);
        assert_eq!(page_number(Some(&json!("2"))), 2);
        assert_eq!(page_number(Some(&json!(0))), 1);
        assert_eq!(page_number(Some(&json!(1.5))), 1);
        assert_eq!(page_number(Some(&json!("junk"))), 1);
    }

    #[test]
    fn blocked_shapes_match_the_renderer() {
        assert_eq!(
            blocked_json("https://a.test", "refused", "No."),
            json!({ "title": "", "text": "", "blocked": "refused", "url": "https://a.test", "reason": "No." })
        );
        assert_eq!(
            blocked_json("https://a.test", "human-verification", ""),
            json!({ "title": "", "text": "", "blocked": "human-verification", "url": "https://a.test" })
        );
    }

    #[test]
    fn search_outcome_leaves_cached_out_unless_true() {
        let mut outcome = Outcome {
            results: Vec::new(),
            provider: Some(Provider::Brave),
            tried: vec![Provider::Brave],
            status: Status::Ok,
            cached: false,
        };
        let value = search_outcome_json(&outcome);
        assert!(value.get("cached").is_none());
        assert_eq!(value["provider"], "brave");
        outcome.cached = true;
        assert_eq!(search_outcome_json(&outcome)["cached"], true);
    }

    #[test]
    fn service_slots_are_the_two_known_ids() {
        assert!(service_slot(Some(&json!("openalex"))).is_some());
        assert!(service_slot(Some(&json!("github"))).is_some());
        assert!(service_slot(Some(&json!("brave"))).is_none());
        assert!(service_slot(None).is_none());
    }
}
