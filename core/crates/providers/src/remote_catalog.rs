//! providers.json from draggy.org: new models, capabilities and API-key providers between releases. Only a file signed
//! with the key below is used, and it may never redirect a provider or add an account.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde_json::{Map, Value, json};
use tracing::{info, warn};

use crate::catalog::{Catalog, CatalogEntry, problem_with};
use crate::http::{HttpClient, HttpRequest, Method};
use crate::js::{json_text, truthy};
use crate::registry::KvStore;

pub const URL_JSON: &str = "https://draggy.org/providers.json";
pub const STORE: &str = "providers.remote";
pub const PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA0t8tmRLchjHxbg6zg+3q+VMdvhw1nZVbOi8O8AOaciU=\n-----END PUBLIC KEY-----\n";
const DAY_MS: u64 = 86_400_000;
const TIMEOUT_MS: u64 = 15_000;
/// What the file may change on a provider Draggy already ships.
const TUNABLE: [&str; 4] = [
    "capabilityPatterns",
    "noisePatterns",
    "defaultModels",
    "quirks",
];
/// What must match, so a signed file still cannot send a key or a conversation somewhere new.
const FIXED: [&str; 4] = ["kind", "protocol", "baseUrl", "auth"];
const KEY_PROTOCOLS: [&str; 3] = ["openai", "anthropic", "gemini"];
const KEY_AUTHS: [&str; 3] = ["bearer", "x-api-key", "x-goog-api-key"];
/// The DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 key bytes follow it.
const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/// Why a file was refused. Its text is what the log says.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("providers.json rejected: {0}")]
pub struct RemoteError(pub String);

/// A provider the user has, as far as the catalog cares: its type, its kind, and whether it is switched on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceUse {
    pub provider_type: String,
    pub kind: String,
    pub enabled: bool,
}

/// What a refresh did. `Updated` carries the catalog now in use.
#[derive(Debug, Clone, PartialEq)]
pub enum Refresh {
    Skipped,
    Fresh,
    Unchanged,
    Updated(Catalog),
    Failed(String),
}

/// Whether a signature over `body` verifies under a PEM Ed25519 public key. Anything malformed does not verify.
pub fn verified(body: &str, signature: &str, public_key_pem: &str) -> bool {
    let Some(key) = ed25519_key_of(public_key_pem) else {
        return false;
    };
    let Some(sig) = base64_lenient(signature) else {
        return false;
    };
    UnparsedPublicKey::new(&ED25519, key)
        .verify(body.as_bytes(), &sig)
        .is_ok()
}

/// The raw 32 bytes of an Ed25519 key in a PEM block.
fn ed25519_key_of(pem: &str) -> Option<Vec<u8>> {
    let body: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();
    let der = base64_lenient(&body)?;
    let key = der.strip_prefix(&ED25519_SPKI_PREFIX)?;
    (key.len() == 32).then(|| key.to_vec())
}

/// Base64 the way Node reads it: characters outside the alphabet are skipped and padding is not required.
fn base64_lenient(text: &str) -> Option<Vec<u8>> {
    let cleaned: String = text
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/')
        .collect();
    STANDARD_NO_PAD.decode(cleaned).ok()
}

fn reject<T>(reason: impl Into<String>) -> Result<T, RemoteError> {
    Err(RemoteError(reason.into()))
}

/// The bundled catalog with a file laid over it, or the first forbidden change named. `previous` is the last accepted
/// file; a provider the user added from it keeps its address while in use.
pub fn merge(
    file: &Value,
    in_use: &[String],
    previous: Option<&Value>,
) -> Result<Vec<CatalogEntry>, RemoteError> {
    let bundled = Catalog::bundled();
    let providers = match (
        file.get("version").and_then(Value::as_f64),
        file.get("providers").and_then(Value::as_array),
    ) {
        (Some(1.0), Some(list)) => list,
        _ => return reject("not version 1"),
    };
    let before: BTreeMap<String, Value> = previous
        .and_then(|prev| prev.get("providers"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            entry
                .get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_owned(), entry.clone()))
        })
        .collect();
    let mut overrides: BTreeMap<String, Value> = BTreeMap::new();
    let mut added: Vec<Value> = Vec::new();
    for raw in providers {
        let Some(id) = raw
            .get("id")
            .and_then(Value::as_str)
            .filter(|_| raw.is_object())
        else {
            return reject("an entry has no id");
        };
        if overrides.contains_key(id)
            || added
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
        {
            return reject(format!("{id} appears twice"));
        }
        if let Some(own) = bundled.find(id) {
            if own.kind == "account" {
                return reject(format!("{id} is an account"));
            }
            let own_value = serde_json::to_value(own).unwrap_or(Value::Null);
            for key in FIXED {
                if raw.get(key).is_some() && raw.get(key) != own_value.get(key) {
                    return reject(format!("{id} changes {key}"));
                }
            }
            let mut entry = own_value.clone();
            for key in TUNABLE {
                if let Some(value) = raw.get(key) {
                    entry[key] = value.clone();
                }
            }
            if let Some(problem) = problem_with(&entry) {
                return reject(format!("{id}: {problem}"));
            }
            overrides.insert(id.to_owned(), entry);
            continue;
        }
        let key_provider = raw.get("kind").and_then(Value::as_str) == Some("cloud")
            && raw
                .get("protocol")
                .and_then(Value::as_str)
                .is_some_and(|p| KEY_PROTOCOLS.contains(&p))
            && raw
                .get("auth")
                .and_then(Value::as_str)
                .is_some_and(|a| KEY_AUTHS.contains(&a));
        if !key_provider {
            return reject(format!("{id} is not an API-key provider"));
        }
        let prior = before.get(id);
        if in_use.iter().any(|used| used == id)
            && (prior.is_none()
                || FIXED
                    .iter()
                    .any(|key| raw.get(*key) != prior.and_then(|p| p.get(*key))))
        {
            return reject(format!("{id} is in use and changes its address"));
        }
        let mut entry = Map::new();
        for key in [
            "id", "name", "kind", "protocol", "baseUrl", "keyUrl", "auth",
        ]
        .into_iter()
        .chain(TUNABLE)
        {
            if let Some(value) = raw.get(key) {
                entry.insert(key.to_owned(), value.clone());
            }
        }
        entry.insert(
            "capabilityPatterns".to_owned(),
            or_default(raw.get("capabilityPatterns"), json!([])),
        );
        entry.insert(
            "defaultModels".to_owned(),
            or_default(raw.get("defaultModels"), json!([])),
        );
        entry.insert(
            "quirks".to_owned(),
            or_default(raw.get("quirks"), json!({})),
        );
        entry.insert("remote".to_owned(), json!(true));
        let entry = Value::Object(entry);
        if let Some(problem) = problem_with(&entry) {
            return reject(format!("{id}: {problem}"));
        }
        added.push(entry);
    }
    // A provider the user added from an earlier file keeps working if a later one drops it.
    for id in in_use {
        let Some(prior) = before.get(id) else {
            continue;
        };
        if bundled.find(id).is_none()
            && !added
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
        {
            let mut kept = prior.clone();
            kept["remote"] = json!(true);
            added.push(kept);
        }
    }
    let mut merged = Vec::new();
    for entry in bundled.entries() {
        let value = overrides
            .remove(&entry.id)
            .unwrap_or_else(|| serde_json::to_value(entry).unwrap_or(Value::Null));
        merged.push(value);
    }
    merged.extend(added);
    merged
        .into_iter()
        .map(|value| {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            serde_json::from_value::<CatalogEntry>(value)
                .map_err(|_| RemoteError(format!("{id}: invalid entry")))
        })
        .collect()
}

fn or_default(value: Option<&Value>, fallback: Value) -> Value {
    match value {
        Some(value) if truthy(Some(value)) => value.clone(),
        _ => fallback,
    }
}

/// The signed catalog: the stored copy, and the refresh that fetches a new one.
pub struct RemoteCatalog<K: KvStore, H: HttpClient> {
    storage: K,
    http: H,
    public_key: String,
}

impl<K: KvStore, H: HttpClient> RemoteCatalog<K, H> {
    pub fn new(storage: K, http: H, public_key: impl Into<String>) -> Self {
        Self {
            storage,
            http,
            public_key: public_key.into(),
        }
    }

    /// The stored copy, checked again as if just fetched. None when it is missing or no longer passes.
    pub fn load(&self, instances: &[InstanceUse]) -> Option<Catalog> {
        let saved = self.read();
        let body = saved
            .get("body")
            .and_then(Value::as_str)
            .filter(|body| !body.is_empty())?;
        let signature = saved
            .get("signature")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let outcome = (|| {
            if !verified(body, signature, &self.public_key) {
                return reject("stored copy fails its signature");
            }
            let file = serde_json::from_str::<Value>(body)
                .map_err(|_| RemoteError("not JSON".to_owned()))?;
            merge(&file, &in_use_of(instances), Some(&file)).map(Catalog::from_entries)
        })();
        match outcome {
            Ok(catalog) => Some(catalog),
            Err(error) => {
                warn!(target: "providers.remote", reason = %error.0, "stored catalog rejected");
                None
            }
        }
    }

    /// Fetches at most once a day, and only while a cloud provider is switched on. A failure keeps what is in use.
    pub fn refresh(&mut self, now: u64, instances: &[InstanceUse]) -> Refresh {
        if !instances
            .iter()
            .any(|instance| instance.enabled && instance.kind == "cloud")
        {
            return Refresh::Skipped;
        }
        let saved = self.read();
        // TS quirk: a checkedAt of zero reads as never checked, as the reference's falsy test does.
        if let Some(checked) = saved
            .get("checkedAt")
            .and_then(Value::as_u64)
            .filter(|checked| *checked > 0)
            && now.saturating_sub(checked) < DAY_MS
        {
            return Refresh::Fresh;
        }
        // The attempt is recorded before the fetch, so a failure waits a day too.
        let mut attempt = saved.clone();
        attempt["checkedAt"] = json!(now);
        self.write(&attempt);
        match self.fetch(&saved, now, &in_use_of(instances)) {
            Ok(Some(catalog)) => {
                info!(target: "providers.remote", "catalog updated");
                Refresh::Updated(catalog)
            }
            Ok(None) => {
                info!(target: "providers.remote", "catalog unchanged");
                Refresh::Unchanged
            }
            Err(error) => {
                warn!(target: "providers.remote", reason = %error.0, "catalog refresh failed");
                Refresh::Failed(error.0)
            }
        }
    }

    fn fetch(
        &mut self,
        saved: &Value,
        now: u64,
        in_use: &[String],
    ) -> Result<Option<Catalog>, RemoteError> {
        let mut headers = BTreeMap::new();
        let etag = saved
            .get("etag")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if truthy(saved.get("body")) && !etag.is_empty() {
            headers.insert("If-None-Match".to_owned(), etag.to_owned());
        }
        let response = self.get(URL_JSON, headers)?;
        if response.status == 304 {
            return Ok(None);
        }
        if !response.ok() {
            return reject(format!("HTTP {}", response.status));
        }
        let body = response.body.clone();
        let sig = self.get(&format!("{URL_JSON}.sig"), BTreeMap::new())?;
        if !sig.ok() {
            return reject(format!("signature HTTP {}", sig.status));
        }
        let signature = sig.body.trim().to_owned();
        if !verified(&body, &signature, &self.public_key) {
            return reject("bad signature");
        }
        let file =
            serde_json::from_str::<Value>(&body).map_err(|_| RemoteError("not JSON".to_owned()))?;
        let previous = match saved
            .get("body")
            .and_then(Value::as_str)
            .filter(|b| !b.is_empty())
        {
            Some(text) => Some(
                serde_json::from_str::<Value>(text)
                    .map_err(|_| RemoteError("not JSON".to_owned()))?,
            ),
            None => None,
        };
        let entries = merge(&file, in_use, previous.as_ref())?;
        let etag = response.header("etag").unwrap_or_default().to_owned();
        self.write(
            &json!({ "body": body, "signature": signature, "etag": etag, "checkedAt": now }),
        );
        Ok(Some(Catalog::from_entries(entries)))
    }

    fn get(
        &self,
        url: &str,
        headers: BTreeMap<String, String>,
    ) -> Result<crate::http::HttpResponse, RemoteError> {
        let request = HttpRequest {
            method: Method::Get,
            url: url.to_owned(),
            headers,
            body: None,
            timeout_ms: Some(TIMEOUT_MS),
        };
        self.http
            .send(&request)
            .map_err(|error| RemoteError(error.message))
    }

    fn read(&self) -> Value {
        self.storage
            .get(STORE)
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}))
    }

    fn write(&mut self, value: &Value) {
        self.storage.set(STORE, &json_text(value));
    }
}

fn in_use_of(instances: &[InstanceUse]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for instance in instances {
        if !seen.contains(&instance.provider_type) {
            seen.push(instance.provider_type.clone());
        }
    }
    seen
}
