//! The network seam. The search and connectivity logic talk to this trait, so tests can answer with canned responses.

use std::future::Future;
use std::time::Duration;

use encoding_rs::{Encoding, UTF_8};

use crate::policy::UrlPolicy;

/// Redirect hops a request may follow. Node's fetch and the hidden browser both follow 20.
const REDIRECT_LIMIT: usize = 20;

/// The verbs the port uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
}

/// One outgoing request. `follow_redirects` is false for the connectivity probe, which reads a 3xx as online.
/// `page` marks a scraped page: the hidden browser window kept cookies and decoded by charset, so this request does too.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub timeout: Duration,
    pub follow_redirects: bool,
    pub page: bool,
}

/// A status and the body text. A HEAD response has an empty body. `final_url` is the address that answered after any
/// redirects, which is where relative links on the page resolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    pub final_url: String,
}

/// Why no response arrived. The text never includes the request URL, so a query cannot leak through it.
/// `Failed` shows the transport's own message, as the CJS logs the message of the error fetch threw.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HttpError {
    #[error("request timed out")]
    Timeout,
    #[error("{0}")]
    Failed(String),
}

/// Sends one request and returns its response. Implementations must not panic.
pub trait HttpClient: Send + Sync {
    fn send(
        &self,
        request: HttpRequest,
    ) -> impl Future<Output = Result<HttpResponse, HttpError>> + Send;
}

/// The production client. API calls follow redirects and keep no cookies, as Node's fetch does. Scraped pages keep a
/// cookie jar for the life of the client, which approximates the browser session. The probe never follows a redirect.
#[derive(Debug, Clone)]
pub struct ReqwestClient {
    api: reqwest::Client,
    page: reqwest::Client,
    no_redirects: reqwest::Client,
}

impl ReqwestClient {
    /// Builds the clients. Fails only when the TLS backend cannot start.
    pub fn new() -> Result<Self, HttpError> {
        // Node's fetch and the hidden browser both follow 20 redirects; reqwest's default stops at 10.
        Ok(Self {
            api: build(
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::limited(REDIRECT_LIMIT)),
            )?,
            page: build(
                reqwest::Client::builder()
                    .cookie_store(true)
                    .redirect(page_redirects()),
            )?,
            no_redirects: build(
                reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()),
            )?,
        })
    }
}

/// Scraped pages hold every redirect hop to the URL policy, as `page` reads do. A refused hop fails the request.
fn page_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if redirect_allowed(attempt.url().as_str(), attempt.previous().len()) {
            attempt.follow()
        } else {
            attempt.error("redirect refused by the URL policy")
        }
    })
}

/// True when a hop may be followed: the hop count is under the limit and the URL policy allows the address.
pub fn redirect_allowed(url: &str, hops_so_far: usize) -> bool {
    hops_so_far < REDIRECT_LIMIT && UrlPolicy::new().is_fetchable_url(url, false)
}

fn build(builder: reqwest::ClientBuilder) -> Result<reqwest::Client, HttpError> {
    builder
        .build()
        .map_err(|error| HttpError::Failed(error.without_url().to_string()))
}

impl HttpClient for ReqwestClient {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        let client = if !request.follow_redirects {
            &self.no_redirects
        } else if request.page {
            &self.page
        } else {
            &self.api
        };
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Head => reqwest::Method::HEAD,
        };
        let mut builder = client
            .request(method, &request.url)
            .timeout(request.timeout);
        for (name, value) in &request.headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let response = builder.send().await.map_err(map_error)?;
        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = response.bytes().await.map_err(map_error)?;
        let body = if request.page {
            decode_page(&bytes, content_type.as_deref())
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        };
        Ok(HttpResponse {
            status,
            body,
            final_url,
        })
    }
}

/// The body as the browser shows it: the charset the Content-Type names, or UTF-8 when it names none or one it does not
/// know. A byte order mark overrides both, as it does in the browser. `<meta charset>` is not read; see the report.
pub fn decode_page(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = content_type
        .and_then(charset_of)
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

/// The `charset` parameter of a Content-Type value, without its quotes.
fn charset_of(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|param| {
        let (name, value) = param.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches('"'))
    })
}

fn map_error(error: reqwest::Error) -> HttpError {
    if error.is_timeout() {
        HttpError::Timeout
    } else {
        HttpError::Failed(error.without_url().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_hops_are_followed_and_private_hops_refused() {
        assert!(redirect_allowed("https://example.com/next", 1));
        assert!(!redirect_allowed("http://127.0.0.1/admin", 1));
        assert!(!redirect_allowed("http://192.168.1.10/", 1));
        assert!(!redirect_allowed("http://localhost/", 1));
    }

    #[test]
    fn hop_limit_stops_a_long_chain() {
        assert!(redirect_allowed("https://example.com/", REDIRECT_LIMIT - 1));
        assert!(!redirect_allowed("https://example.com/", REDIRECT_LIMIT));
    }

    #[test]
    fn page_decodes_by_charset_and_defaults_to_utf8() {
        assert_eq!(decode_page("café".as_bytes(), None), "café");
        assert_eq!(
            decode_page(
                &[0x63, 0x61, 0x66, 0xE9],
                Some("text/html; charset=ISO-8859-1")
            ),
            "café"
        );
    }
}
