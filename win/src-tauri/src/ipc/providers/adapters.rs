//! The app's side of the providers crate: its kv store, keystore and network. The keystore keeps one key per
//! owner under the field `apiKey`, as the search keys do; a key never reaches a log or a reply.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use draggy_diagnostics::Diagnostics;
use draggy_providers::http::{HttpClient, HttpRequest, HttpResponse, Method, TransportError};
use draggy_providers::registry::{Keystore, KvStore};
use draggy_storage::Storage;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::json;
use tauri::AppHandle;

use crate::ipc::web::keys::with_store;

const FIELD: &str = "apiKey";

/// The registry's records, kept under one kv key. Without an open database nothing is kept.
pub struct AppKv {
    pub storage: Option<Arc<Storage>>,
    pub diag: Option<Arc<Diagnostics>>,
}

impl KvStore for AppKv {
    fn get(&self, key: &str) -> Option<String> {
        self.storage.as_ref()?.get_value(key).ok().flatten()
    }

    fn set(&mut self, key: &str, value: &str) {
        let Some(storage) = &self.storage else {
            return;
        };
        if let (Err(error), Some(diag)) = (storage.set_value(key, value), &self.diag) {
            diag.warn(
                "providers.kv",
                "provider records not saved",
                Some(json!({ "error": error.to_string() })),
            );
        }
    }
}

/// The keys of the providers, one owner each, in the same keystore the search keys use.
pub struct AppKeys {
    pub app: AppHandle,
}

impl Keystore for AppKeys {
    fn available(&self) -> bool {
        with_store(&self.app, |_| ()).is_some()
    }

    fn get(&self, owner: &str) -> Option<String> {
        with_store(&self.app, |store| store.get(owner, FIELD))
            .flatten()
            .filter(|key| !key.is_empty())
    }

    fn set(&mut self, owner: &str, key: Option<&str>) -> bool {
        // An empty value removes the field, which is how the keystore forgets a key.
        with_store(&self.app, |store| {
            store.set(owner, FIELD, key.unwrap_or("")).is_ok()
        })
        .unwrap_or(false)
    }

    fn remove(&mut self, owner: &str) {
        let _ = with_store(&self.app, |store| store.delete(owner));
    }
}

/// Sends provider requests with reqwest. Redirects are not followed, so a key never leaves the host it was sent to.
/// Callers run it off the async runtime, since `send` blocks on the request.
pub struct AppHttp;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default()
    })
}

impl HttpClient for AppHttp {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        tauri::async_runtime::block_on(send_async(request.clone()))
    }
}

async fn send_async(request: HttpRequest) -> Result<HttpResponse, TransportError> {
    let method = match request.method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
    };
    let mut builder = client()
        .request(method, &request.url)
        .headers(header_map(&request.headers)?);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    if let Some(ms) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(ms));
    }
    let response = builder.send().await.map_err(transport_error)?;
    let status = response.status().as_u16();
    let headers = response_headers(response.headers());
    let body = response.text().await.map_err(transport_error)?;
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

/// Turns the request's headers into a map. A bad name or value is refused without echoing it.
fn header_map(headers: &BTreeMap<String, String>) -> Result<HeaderMap, TransportError> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let name =
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| refused("invalid header name"))?;
        let value = HeaderValue::from_str(value).map_err(|_| refused("invalid header value"))?;
        map.insert(name, value);
    }
    Ok(map)
}

fn response_headers(headers: &reqwest::header::HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_ascii_lowercase(),
                value.to_str().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

/// A failure's text names the kind of failure only; the URL is left out since a provider may carry a key in it.
fn transport_error(error: reqwest::Error) -> TransportError {
    let message = if error.is_timeout() {
        "The request timed out."
    } else if error.is_connect() {
        "Could not connect to the provider."
    } else {
        "The request failed."
    };
    TransportError {
        message: message.to_owned(),
        cause_message: None,
        code: None,
    }
}

fn refused(message: &str) -> TransportError {
    TransportError {
        message: message.to_owned(),
        cause_message: None,
        code: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_headers_and_refuses_bad_names() {
        let mut ok = BTreeMap::new();
        ok.insert("Authorization".to_owned(), "Bearer abc".to_owned());
        assert!(header_map(&ok).is_ok());

        let mut bad = BTreeMap::new();
        bad.insert("bad name".to_owned(), "x".to_owned());
        let error = header_map(&bad).expect_err("refused");
        assert_eq!(error.message, "invalid header name");
        assert!(!error.message.contains("bad name"));
    }

    #[test]
    fn refuses_a_value_with_a_line_break() {
        let mut bad = BTreeMap::new();
        bad.insert("x-key".to_owned(), "a\nb".to_owned());
        assert_eq!(
            header_map(&bad).expect_err("refused").message,
            "invalid header value"
        );
    }

    #[test]
    fn kv_round_trips_and_forgets_without_a_database() {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = Storage::open(dir.path()).expect("open");
        let mut kv = AppKv {
            storage: Some(Arc::new(storage)),
            diag: None,
        };
        kv.set("providers", "[]");
        assert_eq!(kv.get("providers").as_deref(), Some("[]"));

        let closed = AppKv {
            storage: None,
            diag: None,
        };
        assert_eq!(closed.get("providers"), None);
    }
}
