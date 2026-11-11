//! Paper, wiki and code search over public APIs. Port of searchSource in electron/sources.cjs. The parsers are
//! core's; this file sends the requests and joins the answers.

use std::fmt::Write as _;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use draggy_diagnostics::Diagnostics;
use draggy_web::http::{HttpClient, HttpError, HttpRequest, Method, ReqwestClient};
use draggy_web::policy::UrlPolicy;
use draggy_web::sources::{
    SourceResult, merge_papers, parse_arxiv, parse_crates, parse_crossref, parse_github, parse_npm,
    parse_openalex, parse_pypi, parse_wiki_search, parse_wiki_summary, parse_wikidata,
};
use serde_json::{Value, json};

const TIMEOUT: Duration = Duration::from_secs(12);
const PER_PROVIDER: usize = 6;
const RESULT_CAP: usize = 10;
const JSON_ACCEPT: &str = "application/json";

/// The service keys a search sends. Read from the keystore for each search, never kept here.
pub struct Keys {
    pub openalex: String,
    pub github: String,
}

/// What a source search returned, shaped as the renderer reads it.
pub struct Outcome {
    pub results: Vec<SourceResult>,
    pub provider: Option<&'static str>,
    pub tried: Vec<&'static str>,
    pub status: &'static str,
}

/// Everything one search reads: the client, the log, the app version and the keys.
pub struct Deps<'a> {
    pub http: &'a ReqwestClient,
    pub diag: &'a Diagnostics,
    pub version: &'a str,
    pub keys: &'a Keys,
}

/// One answer per provider, in the order the provider list gives them.
type Answers = Vec<Result<Vec<SourceResult>, String>>;

/// Shared by every request, as the CJS urlPolicy is.
static POLICY: OnceLock<Mutex<UrlPolicy>> = OnceLock::new();

/// One request. A 404 is an answer with nothing in it (`None`), a 403 or 429 is a rate limit, and any other
/// failure is an error. The text of an error never includes the query.
async fn request(
    deps: &Deps<'_>,
    host: &str,
    url: String,
    accept: &str,
) -> Result<Option<String>, String> {
    let allowed = POLICY
        .get_or_init(|| Mutex::new(UrlPolicy::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .is_fetchable_url(&url, false);
    if !allowed {
        return Err("url refused".to_owned());
    }
    let mut headers = vec![
        (
            "User-Agent".to_owned(),
            format!("Draggy/{} (+https://draggy.org)", deps.version),
        ),
        ("Accept".to_owned(), accept.to_owned()),
    ];
    if host == "api.github.com" && !deps.keys.github.is_empty() {
        headers.push((
            "Authorization".to_owned(),
            format!("Bearer {}", deps.keys.github),
        ));
    }
    let request = HttpRequest {
        method: Method::Get,
        url,
        headers,
        timeout: TIMEOUT,
        follow_redirects: true,
        page: false,
    };
    let response = match deps.http.send(request).await {
        Ok(response) => response,
        Err(error) => {
            let name = match error {
                HttpError::Timeout => "timeout",
                HttpError::Failed(_) => "failed",
            };
            deps.diag.warn(
                "net.sources",
                "request failed",
                Some(json!({ "host": host, "error": name })),
            );
            return Err(format!("{host} {name}"));
        }
    };
    deps.diag.info(
        "net.sources",
        "request answered",
        Some(json!({ "host": host, "status": response.status })),
    );
    match response.status {
        403 | 429 => Err(format!("{host} limited {}", response.status)),
        404 => Ok(None),
        200..=299 => Ok(Some(response.body)),
        status => Err(format!("{host} answered {status}")),
    }
}

/// Parses a body. A 404 gives an empty answer, which is what an empty list means to the merge.
fn parsed<T: Default>(
    body: Option<String>,
    parse: impl FnOnce(&str) -> Result<T, serde_json::Error>,
) -> Result<T, String> {
    match body {
        None => Ok(T::default()),
        Some(text) => parse(&text).map_err(|_| "unreadable body".to_owned()),
    }
}

/// `encodeURIComponent`: unreserved characters stay, every other byte is percent-encoded.
fn encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

async fn openalex(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let key = if deps.keys.openalex.is_empty() {
        String::new()
    } else {
        format!("&api_key={}", encode(&deps.keys.openalex))
    };
    let fields = "display_name,doi,id,publication_year,authorships,abstract_inverted_index,primary_location,open_access";
    let url = format!(
        "https://api.openalex.org/works?search={}&per-page={PER_PROVIDER}&select={fields}{key}",
        encode(query)
    );
    parsed(
        request(deps, "api.openalex.org", url, JSON_ACCEPT).await?,
        parse_openalex,
    )
}

async fn arxiv(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://export.arxiv.org/api/query?search_query=all:{}&max_results={PER_PROVIDER}",
        encode(query)
    );
    let body = request(deps, "export.arxiv.org", url, "application/atom+xml").await?;
    Ok(body.map_or_else(Vec::new, |xml| parse_arxiv(&xml)))
}

async fn crossref(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://api.crossref.org/works?query={}&rows={PER_PROVIDER}&select=DOI,title,author,issued,URL,abstract",
        encode(query)
    );
    parsed(
        request(deps, "api.crossref.org", url, JSON_ACCEPT).await?,
        parse_crossref,
    )
}

/// The summary replaces the search snippet and link for one row. A failed summary keeps the row as it was.
async fn with_summary(deps: &Deps<'_>, row: SourceResult) -> SourceResult {
    let url = format!(
        "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
        encode(&row.title.replace(' ', "_"))
    );
    let body = request(deps, "en.wikipedia.org", url, JSON_ACCEPT).await;
    match body.and_then(|body| parsed(body, parse_wiki_summary)) {
        Ok(Some(summary)) => SourceResult {
            snippet: summary.snippet,
            url: summary.url,
            ..row
        },
        Ok(None) => row,
        Err(error) => {
            deps.diag.debug(
                "net.sources",
                "summary skipped",
                Some(json!({ "error": error })),
            );
            row
        }
    }
}

async fn wikipedia(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={}&srlimit={PER_PROVIDER}&format=json&origin=*",
        encode(query)
    );
    let mut found: Vec<SourceResult> = parsed(
        request(deps, "en.wikipedia.org", url, JSON_ACCEPT).await?,
        parse_wiki_search,
    )?;
    // A summary is a cleaner snippet than the search fragment, so only the top two are upgraded.
    let rest = found.split_off(found.len().min(2));
    let mut top = Vec::with_capacity(found.len() + rest.len());
    for row in found {
        top.push(with_summary(deps, row).await);
    }
    top.extend(rest);
    Ok(top)
}

async fn wikidata(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://www.wikidata.org/w/api.php?action=wbsearchentities&search={}&language=en&limit=4&format=json&origin=*",
        encode(query)
    );
    parsed(
        request(deps, "www.wikidata.org", url, JSON_ACCEPT).await?,
        parse_wikidata,
    )
}

async fn github(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://api.github.com/search/repositories?q={}&per_page={PER_PROVIDER}",
        encode(query)
    );
    parsed(
        request(deps, "api.github.com", url, JSON_ACCEPT).await?,
        parse_github,
    )
}

async fn npm(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://registry.npmjs.org/-/v1/search?text={}&size=4",
        encode(query)
    );
    parsed(
        request(deps, "registry.npmjs.org", url, JSON_ACCEPT).await?,
        parse_npm,
    )
}

/// PyPI has no search API, so only an exact package name can be looked up. Anything else is no answer.
fn pypi_name(query: &str) -> Option<String> {
    let name = query.trim().to_lowercase();
    let mut chars = name.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest_ok =
        chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    (first_ok && rest_ok).then_some(name)
}

async fn pypi(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let Some(name) = pypi_name(query) else {
        return Ok(Vec::new());
    };
    let url = format!("https://pypi.org/pypi/{}/json", encode(&name));
    parsed(
        request(deps, "pypi.org", url, JSON_ACCEPT).await?,
        parse_pypi,
    )
}

async fn crates(deps: &Deps<'_>, query: &str) -> Result<Vec<SourceResult>, String> {
    let url = format!(
        "https://crates.io/api/v1/crates?q={}&per_page=4",
        encode(query)
    );
    parsed(
        request(deps, "crates.io", url, JSON_ACCEPT).await?,
        parse_crates,
    )
}

/// Runs every provider of a source at once and merges what answered. A provider that is rate limited or
/// down counts as unavailable, which is reported only when nothing else answered.
pub async fn search(deps: &Deps<'_>, query: &str, source: &str) -> Outcome {
    let text = query.trim();
    let nothing = |status| Outcome {
        results: Vec::new(),
        provider: None,
        tried: Vec::new(),
        status,
    };
    if text.is_empty() {
        return nothing("empty");
    }
    let (name, tried, answers): (&'static str, Vec<&'static str>, Answers) = match source {
        "papers" => {
            let (a, b, c) = tokio::join!(
                openalex(deps, text),
                arxiv(deps, text),
                crossref(deps, text)
            );
            (
                "papers",
                vec!["openalex", "arxiv", "crossref"],
                vec![a, b, c],
            )
        }
        "wiki" => {
            let (a, b) = tokio::join!(wikipedia(deps, text), wikidata(deps, text));
            ("wiki", vec!["wikipedia", "wikidata"], vec![a, b])
        }
        "code" => {
            let (a, b, c, d) = tokio::join!(
                github(deps, text),
                npm(deps, text),
                pypi(deps, text),
                crates(deps, text)
            );
            (
                "code",
                vec!["github", "npm", "pypi", "crates"],
                vec![a, b, c, d],
            )
        }
        _ => return nothing("empty"),
    };

    let mut answered: Vec<Vec<SourceResult>> = Vec::new();
    let mut failed = 0;
    for (id, answer) in tried.iter().zip(answers) {
        match answer {
            Ok(rows) => answered.push(rows),
            Err(error) => {
                failed += 1;
                deps.diag.info(
                    "net.sources",
                    "provider failed",
                    Some(json!({ "provider": id, "error": error })),
                );
            }
        }
    }
    let merged = if name == "papers" {
        merge_papers(&answered)
    } else {
        answered.concat()
    };
    let results: Vec<SourceResult> = merged.into_iter().take(RESULT_CAP).collect();
    if results.is_empty() {
        let status = if failed > 0 { "unavailable" } else { "empty" };
        return Outcome {
            results,
            provider: None,
            tried,
            status,
        };
    }
    Outcome {
        results,
        provider: Some(name),
        tried,
        status: "ok",
    }
}

/// The renderer's shape for one source row. Fields the parser left out are left out here too.
pub fn result_json(row: &SourceResult) -> Value {
    let mut out = json!({
        "title": row.title,
        "url": row.url,
        "snippet": row.snippet,
        "source": row.source,
    });
    if let Some(year) = row.year {
        out["year"] = json!(year);
    }
    if let Some(authors) = &row.authors {
        out["authors"] = json!(authors);
    }
    if let Some(doi) = &row.doi {
        out["doi"] = json!(doi);
    }
    if let Some(pdf) = &row.pdf {
        out["pdf"] = json!(pdf);
    }
    out
}

pub fn outcome_json(outcome: &Outcome) -> Value {
    json!({
        "results": outcome.results.iter().map(result_json).collect::<Vec<_>>(),
        "provider": outcome.provider,
        "tried": outcome.tried,
        "status": outcome.status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(encode("a b&c/d"), "a%20b%26c%2Fd");
        assert_eq!(encode("-_.!~*'()"), "-_.!~*'()");
        assert_eq!(encode("é"), "%C3%A9");
    }

    #[test]
    fn pypi_takes_only_exact_package_names() {
        assert_eq!(pypi_name("  Requests "), Some("requests".to_owned()));
        assert_eq!(
            pypi_name("zope.interface"),
            Some("zope.interface".to_owned())
        );
        assert_eq!(pypi_name("python tools"), None);
        assert_eq!(pypi_name("-leading"), None);
        assert_eq!(pypi_name(""), None);
    }
}
