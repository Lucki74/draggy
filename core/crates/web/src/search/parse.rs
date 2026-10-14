//! Parses provider responses, API JSON and scraped pages alike, then normalises them. Port of electron/search.cjs.

use std::collections::HashSet;

use scraper::Html;
use serde_json::{Value, json};
use url::Url;

use super::{Provider, RESULT_LIMIT, SearchResult, dom};
use crate::http::HttpError;
use crate::js::{js_trim, text_or_empty, truthy, utf16_prefix};

/// Why a provider gave no results. The messages are the ones the CJS reports.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("{name} returned {status}")]
    Status { name: &'static str, status: u16 },
    #[error("invalid body")]
    InvalidBody,
    #[error(transparent)]
    Http(#[from] HttpError),
}

/// The results in one provider response. `page_url` is the URL that was requested, which scraped links resolve against.
pub fn parse_response(
    provider: Provider,
    page_url: &str,
    status: u16,
    body: &str,
) -> Result<Vec<SearchResult>, ProviderError> {
    match provider {
        Provider::Searxng => parse_searxng(status, body),
        Provider::Brave => parse_brave(status, body),
        Provider::DuckDuckGo => parse_page(page_url, body, dom::duckduckgo_rows),
        Provider::Startpage => parse_page(page_url, body, dom::startpage_rows),
        Provider::DuckDuckGoLite => parse_page(page_url, body, dom::lite_rows),
        Provider::BraveHtml => parse_page(page_url, body, dom::brave_html_rows),
    }
}

fn parse_searxng(status: u16, body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    check_status("SearXNG", status)?;
    let parsed = parse_json(body)?;
    let entries = entries_at(&parsed, &["results"])?;
    Ok(normalise_results(&Value::Array(mapped(
        entries,
        ["title", "url", "content"],
    )?)))
}

fn parse_brave(status: u16, body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    check_status("Brave", status)?;
    let parsed = parse_json(body)?;
    let entries = entries_at(&parsed, &["web", "results"])?;
    Ok(normalise_results(&Value::Array(mapped(
        entries,
        ["title", "url", "description"],
    )?)))
}

/// A scraped page. The hidden window never checked the status, so neither does this. Links resolve against its `<base href>`.
/// Page scripts and the readiness wait do not run here, so a page that fills in with JavaScript parses empty (see mod.rs).
fn parse_page(
    page_url: &str,
    body: &str,
    extract: fn(&Html, &Url) -> Vec<Value>,
) -> Result<Vec<SearchResult>, ProviderError> {
    let page = Url::parse(page_url).map_err(|_| ProviderError::InvalidBody)?;
    let document = Html::parse_document(body);
    let base = dom::document_base(&document, &page);
    Ok(normalise_results(&Value::Array(extract(&document, &base))))
}

fn check_status(name: &'static str, status: u16) -> Result<(), ProviderError> {
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(ProviderError::Status { name, status })
    }
}

/// `response.json()` reads UTF-8 and drops a leading byte order mark, so this does too.
fn parse_json(body: &str) -> Result<Value, ProviderError> {
    let text = body.strip_prefix('\u{FEFF}').unwrap_or(body);
    serde_json::from_str(text).map_err(|_| ProviderError::InvalidBody)
}

static NULL: Value = Value::Null;

/// `value[key]`, which is undefined (null here) for anything that is not an object.
fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value
        .as_object()
        .and_then(|map| map.get(key))
        .unwrap_or(&NULL)
}

/// `(body?.a?.b || []).map(...)`: a falsy list is empty, and anything else that is not an array is an invalid body.
fn entries_at(body: &Value, path: &[&str]) -> Result<Vec<Value>, ProviderError> {
    let value = path.iter().fold(body, |current, key| field(current, key));
    if !truthy(value) {
        return Ok(Vec::new());
    }
    value.as_array().cloned().ok_or(ProviderError::InvalidBody)
}

/// Maps each API entry to `{ title, url, snippet }`. A null entry throws in the CJS, so it is an invalid body here.
fn mapped(entries: Vec<Value>, keys: [&str; 3]) -> Result<Vec<Value>, ProviderError> {
    let [title, url, snippet] = keys;
    entries
        .iter()
        .map(|entry| {
            if entry.is_null() {
                return Err(ProviderError::InvalidBody);
            }
            Ok(json!({ "title": field(entry, title), "url": field(entry, url), "snippet": field(entry, snippet) }))
        })
        .collect()
}

/// Keeps entries with a title and an http(s) url, unwraps redirector links, drops repeated urls and caps the list.
pub fn normalise_results(raw: &Value) -> Vec<SearchResult> {
    let Some(entries) = raw.as_array() else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for entry in entries {
        let raw_url = text_or_empty(field(entry, "url"));
        let url = unwrap_redirect(js_trim(&raw_url));
        let title = js_trim(&text_or_empty(field(entry, "title"))).to_owned();
        if title.is_empty() || !is_http_url(&url) || !seen.insert(url.clone()) {
            continue;
        }
        let snippet =
            utf16_prefix(js_trim(&text_or_empty(field(entry, "snippet"))), 500).into_owned();
        results.push(SearchResult {
            title,
            url,
            snippet,
        });
        if results.len() >= RESULT_LIMIT {
            break;
        }
    }
    results
}

/// DuckDuckGo links go through a redirector. The real destination is in its `uddg` parameter, and that is what the model should see.
pub fn unwrap_redirect(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return url.to_owned();
    };
    let host = parsed.host_str().unwrap_or_default();
    if host != "duckduckgo.com" && !host.ends_with(".duckduckgo.com") {
        return url.to_owned();
    }
    match parsed.query_pairs().find(|(key, _)| key.as_ref() == "uddg") {
        Some((_, target)) if is_http_url(&target) => target.into_owned(),
        _ => url.to_owned(),
    }
}

/// `/^https?:\/\//i`
fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}
