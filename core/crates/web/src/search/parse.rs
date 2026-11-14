//! Parses provider responses, API JSON and scraped pages alike, then normalises them.

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
    #[error("blocked: {0}")]
    Blocked(String),
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
        Provider::DuckDuckGo => parse_page(page_url, status, body, dom::duckduckgo_rows),
        Provider::Startpage => parse_page(page_url, status, body, dom::startpage_rows),
        Provider::DuckDuckGoLite => parse_page(page_url, status, body, dom::lite_rows),
        Provider::BraveHtml => parse_page(page_url, status, body, dom::brave_html_rows),
        Provider::Ecosia => parse_page(page_url, status, body, dom::ecosia_rows),
        Provider::Yahoo => parse_page(page_url, status, body, dom::yahoo_rows),
    }
}

fn parse_searxng(status: u16, body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    check_throttled(status, body)?;
    check_status("SearXNG", status)?;
    let parsed = parse_json(body)?;
    let entries = entries_at(&parsed, &["results"])?;
    Ok(normalise_results(&Value::Array(mapped(
        entries,
        ["title", "url", "content"],
    )?)))
}

fn parse_brave(status: u16, body: &str) -> Result<Vec<SearchResult>, ProviderError> {
    check_throttled(status, body)?;
    check_status("Brave", status)?;
    let parsed = parse_json(body)?;
    let entries = entries_at(&parsed, &["web", "results"])?;
    Ok(normalise_results(&Value::Array(mapped(
        entries,
        ["title", "url", "description"],
    )?)))
}

/// A scraped page. Links resolve against its `<base href>`. Page scripts do not run here, so a page that fills in with JavaScript parses empty (see mod.rs).
/// An empty page answered with 202, 403 or 429 is a throttle (DuckDuckGo answers bursts with a bare 202), so it counts as a block and not as an empty web.
fn parse_page(
    page_url: &str,
    status: u16,
    body: &str,
    extract: fn(&Html, &Url) -> Vec<Value>,
) -> Result<Vec<SearchResult>, ProviderError> {
    let page = Url::parse(page_url).map_err(|_| ProviderError::InvalidBody)?;
    let document = Html::parse_document(body);
    let base = dom::document_base(&document, &page);
    let rows = extract(&document, &base);
    if rows.is_empty() {
        if matches!(status, 202 | 403 | 429) {
            return Err(ProviderError::Blocked("rate-limited".to_owned()));
        }
        // Startpage serves an Anubis proof-of-work page with 200 and no block wording.
        if dom::has(&document, "#anubis_challenge, #anubis_version") {
            return Err(ProviderError::Blocked("captcha".to_owned()));
        }
        let (title, text) = dom::page_text(&document);
        if let Some(reason) = block_reason(&title, &text) {
            return Err(ProviderError::Blocked(reason.to_owned()));
        }
    }
    Ok(normalise_results(&Value::Array(rows)))
}

/// Names a block page from its title and text, or None. The phrases are the CJS list, matched case-insensitively.
pub fn block_reason(title: &str, text: &str) -> Option<&'static str> {
    const RULES: [(&str, &[&str]); 3] = [
        (
            "unusual-traffic",
            &[
                "unusual traffic",
                "bots use duckduckgo too",
                "anomaly in the request",
                "automated requests",
                "unusual activity",
            ],
        ),
        (
            "captcha",
            &[
                "captcha",
                "verify you are human",
                "verify you're human",
                "are you a robot",
                "are you human",
                "not a robot",
                "select all squares",
            ],
        ),
        (
            "consent",
            &[
                "before you continue to google",
                "consent.google",
                "before you continue",
                "cookie consent",
                "accept all cookies",
            ],
        ),
    ];
    let joined = format!("{title} {text}").to_lowercase();
    let haystack = joined.split_whitespace().collect::<Vec<_>>().join(" ");
    RULES
        .iter()
        .find(|(_, phrases)| phrases.iter().any(|phrase| haystack.contains(phrase)))
        .map(|(reason, _)| *reason)
}

/// An API that answers 202 with nothing is throttling, not reporting an empty web.
fn check_throttled(status: u16, body: &str) -> Result<(), ProviderError> {
    if status == 202 && js_trim(body).is_empty() {
        return Err(ProviderError::Blocked("rate-limited".to_owned()));
    }
    Ok(())
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
        if title.is_empty() || !is_http_url(&url) || !seen.insert(canonical_url(&url)) {
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
    // Yahoo keeps the destination percent-encoded in a `/RU=.../` path segment.
    if host == "r.search.yahoo.com" {
        let target = parsed.path().split('/').find_map(|segment| segment.strip_prefix("RU="));
        let decoded = target.and_then(|t| {
            let pair = format!("u={t}");
            url::form_urlencoded::parse(pair.as_bytes()).next().map(|(_, v)| v.into_owned())
        });
        return match decoded {
            Some(target) if is_http_url(&target) => target,
            _ => url.to_owned(),
        };
    }
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

/// One key for a page however it was linked: tracking parameters, AMP markers, the fragment and a trailing slash go.
/// The host is only lowercased, because a www host and its bare twin can serve different pages.
pub fn canonical_url(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return url.to_owned();
    };
    let mut path = parsed
        .path()
        .split('/')
        .filter(|segment| !segment.eq_ignore_ascii_case("amp"))
        .collect::<Vec<_>>()
        .join("/");
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    if path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    let kept: Vec<&str> = parsed
        .query()
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty() && !is_dropped_param(pair))
        .collect();
    let host = parsed.host_str().unwrap_or_default();
    let port = parsed
        .port()
        .map_or(String::new(), |port| format!(":{port}"));
    let query = if kept.is_empty() {
        String::new()
    } else {
        format!("?{}", kept.join("&"))
    };
    format!("{}://{host}{port}{path}{query}", parsed.scheme())
}

/// A tracking parameter or an AMP switch, given as a raw `name=value` pair.
fn is_dropped_param(pair: &str) -> bool {
    let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
    let name = name.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    const TRACKING: [&str; 9] = [
        "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src", "igshid", "yclid", "msclkid",
    ];
    name.starts_with("utm_")
        || TRACKING.contains(&name.as_str())
        || (name == "amp" && value == "1")
        || (name == "outputtype" && value == "amp")
}

/// The host without a leading `www.`, or an empty string when the url does not parse.
pub fn domain_of(url: &str) -> String {
    let host = Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_lowercase))
        .unwrap_or_default();
    host.strip_prefix("www.")
        .map_or(host.clone(), str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_throttled_page_is_a_block() {
        let url = "https://html.duckduckgo.com/html/?q=x";
        let blocked = parse_response(Provider::DuckDuckGo, url, 202, "<html><body></body></html>");
        assert!(matches!(blocked, Err(ProviderError::Blocked(reason)) if reason == "rate-limited"));
        let empty = parse_response(Provider::DuckDuckGo, url, 200, "<html><body></body></html>");
        assert!(matches!(empty, Ok(rows) if rows.is_empty()));
    }

    #[test]
    fn anubis_challenge_is_a_block() {
        let body = r#"<html><head><script id="anubis_challenge" type="application/json">{}</script></head>
            <body>Verifying your request... Loading...</body></html>"#;
        let blocked = parse_response(Provider::Startpage, "https://www.startpage.com/sp/search?query=q", 200, body);
        assert!(matches!(blocked, Err(ProviderError::Blocked(reason)) if reason == "captcha"));
    }

    #[test]
    fn ecosia_reads_organic_results_and_skips_ads() {
        let body = r#"<html><head><title>q - Ecosia</title></head><body>
            <div data-test-id="mainline-result-ad"><a data-test-id="result-link" href="https://ads.example/x">Ad</a></div>
            <article data-test-id="organic-result"><div class="result__title"><a data-test-id="result-link" href="https://en.wikipedia.org/wiki/Large_language_model">Large language model - Wikipedia</a></div>
            <p data-test-id="result-description">A large language model is a language model trained on text.</p></article>
            </body></html>"#;
        let rows = parse_response(Provider::Ecosia, "https://www.ecosia.org/search?q=q", 200, body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].url, "https://en.wikipedia.org/wiki/Large_language_model");
        assert_eq!(rows[0].title, "Large language model - Wikipedia");
        assert!(rows[0].snippet.starts_with("A large language model"));
    }

    #[test]
    fn yahoo_reads_organic_results_and_unwraps_its_redirect() {
        let body = r#"<html><head><title>q - Yahoo Search Results</title></head><body><ol>
            <li><div class="dd SysNews"><div class="compTitle"><a href="https://news.example/x"><h3>News</h3></a></div></div></li>
            <li><div class="dd fst algo algo-sr relsrch Sr"><div class="compTitle options-toggle"><a href="https://r.search.yahoo.com/_ylt=A2/RV=2/RE=1/RO=10/RU=https%3a%2f%2fwww.freecodecamp.org%2fnews%2ftrain-your-own-llm%2f/RK=2/RS=x-"><div>freecodecamp.org</div><h3 class="title"><span>Train Your Own LLM</span></h3></a></div>
            <div class="compText"><p>A hands-on tutorial.</p></div></div></li>
            </ol></body></html>"#;
        let rows = parse_response(Provider::Yahoo, "https://search.yahoo.com/search?p=q", 200, body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].url, "https://www.freecodecamp.org/news/train-your-own-llm/");
        assert_eq!(rows[0].title, "Train Your Own LLM");
        assert_eq!(rows[0].snippet, "A hands-on tutorial.");
    }
}
