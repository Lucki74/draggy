//! Finds local model servers on this computer: loopback only, a short timeout, and never Draggy's own ports, where its
//! engine would pass for llama.cpp and its API server for an OpenAI-compatible one.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tracing::info;
use url::Url;

use crate::catalog::{Catalog, CatalogEntry};
use crate::http::{HttpClient, HttpRequest, HttpResponse, Method};
use crate::js::truthy;

const HOST: &str = "127.0.0.1";
const TIMEOUT_MS: u64 = 400;
/// The dev server's port, which is never probed while Draggy runs in development.
const DEV_PORT: u16 = 5173;

/// A server found on this computer. `guessed` means it only answered a model listing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    #[serde(rename = "type")]
    pub server_type: String,
    pub name: String,
    pub port: u16,
    pub base_url: String,
    pub guessed: bool,
}

/// What a probe learned: the server did not answer at all, or it answered with this JSON and text.
enum Probe {
    Refused,
    Answer { json: Option<Value>, text: String },
}

/// The test a server type's answer must pass.
#[derive(Clone, Copy)]
enum Check {
    OllamaVersion,
    LmStudioData,
    LlamaCppSettings,
    ColibriMetrics,
    ColibriHealth,
    VllmVersion,
    LemonadeData,
}

/// The probe path and the test for each server type. Ports 8000 and 8080 are shared, so a server is named by what it
/// answers, never by where it listens.
const SIGNATURES: [(&str, &str, Check); 7] = [
    ("ollama", "/api/version", Check::OllamaVersion),
    ("lmstudio", "/api/v0/models", Check::LmStudioData),
    ("llamacpp", "/props", Check::LlamaCppSettings),
    // Colibri shares port 8000 with vLLM and Lemonade; its scheduler metrics and health counters are its own.
    ("colibri", "/metrics", Check::ColibriMetrics),
    ("colibri", "/health", Check::ColibriHealth),
    ("vllm", "/version", Check::VllmVersion),
    ("lemonade", "/api/v1/models", Check::LemonadeData),
];

fn passes(check: Check, json: Option<&Value>, text: &str) -> bool {
    match check {
        Check::OllamaVersion | Check::VllmVersion => json
            .and_then(|j| j.get("version"))
            .is_some_and(Value::is_string),
        Check::LmStudioData | Check::LemonadeData => json
            .and_then(|j| j.get("data"))
            .is_some_and(Value::is_array),
        Check::LlamaCppSettings => json.is_some_and(|j| {
            truthy(j.get("default_generation_settings")) || truthy(j.get("total_slots"))
        }),
        Check::ColibriMetrics => colibri_metrics_line(text),
        Check::ColibriHealth => json.is_some_and(|j| {
            // `json.scheduler ?? json`: a server that nests its counters under `scheduler` is read there.
            let scheduler = match j.get("scheduler") {
                None | Some(Value::Null) => j,
                Some(nested) => nested,
            };
            ["active", "queued"]
                .iter()
                .all(|key| scheduler.get(*key).is_some_and(Value::is_number))
        }),
    }
}

fn colibri_metrics_line(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"(?m)^colibri_scheduler_").ok())
        .as_ref()
        .is_some_and(|re| re.is_match(text))
}

/// The address of an entry's server on a given port: its own address with the port swapped in, no trailing slash.
fn with_port(base_url: &str, port: u16) -> Option<String> {
    let mut url = Url::parse(base_url).ok()?;
    url.set_port(Some(port)).ok()?;
    Some(url.as_str().trim_end_matches('/').to_owned())
}

/// The ports a scan touches: every local server's usual port, minus the excluded ones and the dev port in development.
pub fn ports(catalog: &Catalog, excluded: &[u16], is_dev: bool) -> Vec<u16> {
    let mut own: HashSet<u16> = excluded.iter().copied().collect();
    if is_dev {
        own.insert(DEV_PORT);
    }
    let mut seen = HashSet::new();
    catalog
        .entries()
        .iter()
        .filter(|entry| entry.kind == "local")
        .filter_map(|entry| entry.discovery.as_ref().map(|discovery| discovery.port))
        .filter(|port| seen.insert(*port))
        .filter(|port| !own.contains(port))
        .collect()
}

/// Probes loopback through an HTTP client, with the short timeout discovery uses.
pub struct Discovery<H: HttpClient> {
    http: H,
}

impl<H: HttpClient> Discovery<H> {
    pub fn new(http: H) -> Self {
        Self { http }
    }

    /// Every server found on the given ports, in port order.
    pub fn scan(&self, catalog: &Catalog, excluded: &[u16], is_dev: bool) -> Vec<Server> {
        let scanned = ports(catalog, excluded, is_dev);
        let found: Vec<Server> = scanned
            .iter()
            .filter_map(|port| self.identify(catalog, *port))
            .collect();
        let types: Vec<&str> = found
            .iter()
            .map(|server| server.server_type.as_str())
            .collect();
        info!(target: "providers.discovery", ports = scanned.len(), found = found.len(), ?types, "scan done");
        found
    }

    fn probe(&self, port: u16, path: &str) -> Probe {
        let request = HttpRequest {
            method: Method::Get,
            url: format!("http://{HOST}:{port}{path}"),
            headers: Default::default(),
            body: None,
            timeout_ms: Some(TIMEOUT_MS),
        };
        match self.http.send(&request) {
            Err(_) => Probe::Refused,
            Ok(response) if !response.ok() => Probe::Answer {
                json: None,
                text: String::new(),
            },
            Ok(response) => answer_of(response),
        }
    }

    fn identify(&self, catalog: &Catalog, port: u16) -> Option<Server> {
        let entries: Vec<&CatalogEntry> = catalog
            .entries()
            .iter()
            .filter(|entry| entry.kind == "local")
            .collect();
        for (server_type, path, check) in SIGNATURES {
            let (json, text) = match self.probe(port, path) {
                Probe::Refused => return None,
                Probe::Answer { json, text } => (json, text),
            };
            if !passes(check, json.as_ref(), &text) {
                continue;
            }
            let entry = entries.iter().find(|entry| entry.id == server_type)?;
            return Some(Server {
                server_type: entry.id.clone(),
                name: entry.name.clone(),
                port,
                base_url: with_port(&entry.base_url, port)?,
                guessed: false,
            });
        }
        // Only a listing to go on: named after the catalog's usual server on this port, and marked a guess.
        let json = match self.probe(port, "/v1/models") {
            Probe::Refused => return None,
            Probe::Answer { json, .. } => json,
        };
        if !json
            .as_ref()
            .and_then(|j| j.get("data"))
            .is_some_and(Value::is_array)
        {
            return None;
        }
        let entry = entries.iter().find(|entry| {
            entry
                .discovery
                .as_ref()
                .is_some_and(|d| d.port == port && d.probe == "/v1/models")
        })?;
        Some(Server {
            server_type: entry.id.clone(),
            name: entry.name.clone(),
            port,
            base_url: with_port(&entry.base_url, port)?,
            guessed: true,
        })
    }
}

/// The JSON and the text of a 2xx answer. A body that is not JSON (metrics, an empty body) has no JSON.
fn answer_of(response: HttpResponse) -> Probe {
    let json = serde_json::from_str::<Value>(&response.body).ok();
    Probe::Answer {
        json,
        text: response.body,
    }
}
