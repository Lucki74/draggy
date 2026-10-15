//! Finds servers Draggy does not ship, from the public MCP registry. The last answer is kept, so an offline search still answers.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Map, Value};
use tracing::{debug, info, warn};

use crate::catalogue::{Entry, EnvVar, find_entry};
use crate::js::{or, text, truthy, utf16_len};
use crate::net::{Http, Method, Request};

/// Where the registry is asked.
pub const REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0/servers";

/// How long a search answer is kept before the registry is asked again.
pub const CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;

const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const CACHE_FILE: &str = "registry-cache.json";

/// Where the last answers are kept, per query. The app keeps this in its own data folder.
pub trait Cache: Send + Sync {
    fn read(&self) -> Option<String>;
    fn write(&self, text: &str) -> Result<(), String>;
    fn remove(&self) -> Result<(), String>;
}

/// The cache as a file in the app's data folder.
#[derive(Debug, Clone)]
pub struct FileCache {
    path: PathBuf,
}

impl FileCache {
    pub fn new(user_data: &Path) -> Self {
        Self {
            path: user_data.join(CACHE_FILE),
        }
    }
}

impl Cache for FileCache {
    fn read(&self) -> Option<String> {
        fs::read_to_string(&self.path).ok()
    }

    fn write(&self, text: &str) -> Result<(), String> {
        fs::write(&self.path, text).map_err(|error| error.to_string())
    }

    fn remove(&self) -> Result<(), String> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// What a search answered. `stale` means the answer is older than the TTL and the registry could not be asked.
#[derive(Debug, Clone, PartialEq)]
pub struct Search {
    pub success: bool,
    pub entries: Vec<Entry>,
    pub cached: bool,
    pub stale: bool,
    pub error: Option<String>,
}

/// The registry search, with its cache and the network behind it.
pub struct Registry<H, C> {
    http: H,
    cache: C,
}

/// One kept answer: when it was fetched, and what it held.
struct Answer {
    at: Option<f64>,
    entries: Vec<Entry>,
}

impl<H: Http, C: Cache> Registry<H, C> {
    pub fn new(http: H, cache: C) -> Self {
        Self { http, cache }
    }

    /// Searches the registry. A search answered within the TTL costs nothing; a failed one falls back to the last answer.
    pub async fn search(&self, query: &str, now_ms: u64) -> Search {
        let term = query.trim();
        let key = term.to_lowercase();
        let term_chars = utf16_len(term);
        let mut cache = read_cache(&self.cache);
        let kept = cache.get(&key).map(answer_of);

        if let Some(answer) = kept.as_ref().filter(|answer| fresh(answer, now_ms)) {
            debug!(target: "mcp.registry", term_chars, entries = answer.entries.len(), "search answered from cache");
            return Search {
                success: true,
                entries: answer.entries.clone(),
                cached: true,
                stale: false,
                error: None,
            };
        }

        match self.fetch(term).await {
            Ok(entries) => {
                info!(target: "mcp.registry", term_chars, entries = entries.len(), "search answered");
                cache.insert(key, answer_to_value(now_ms, &entries));
                if let Err(error) = write_cache(&self.cache, &cache) {
                    warn!(target: "mcp.registry", reason = %error, "could not write the cache");
                }
                Search {
                    success: true,
                    entries,
                    cached: false,
                    stale: false,
                    error: None,
                }
            }
            Err(reason) => {
                warn!(target: "mcp.registry", term_chars, reason = %reason, stale = kept.is_some(), "search failed");
                match kept {
                    Some(answer) => Search {
                        success: true,
                        entries: answer.entries,
                        cached: true,
                        stale: true,
                        error: None,
                    },
                    None => Search {
                        success: false,
                        entries: Vec::new(),
                        cached: false,
                        stale: false,
                        error: Some(reason),
                    },
                }
            }
        }
    }

    /// Drops every kept answer.
    pub fn forget(&self) -> Result<(), String> {
        self.cache.remove()
    }

    async fn fetch(&self, term: &str) -> Result<Vec<Entry>, String> {
        let mut url = url::Url::parse(REGISTRY_URL).map_err(|error| error.to_string())?;
        {
            let mut query = url.query_pairs_mut();
            if !term.is_empty() {
                query.append_pair("search", term);
            }
            query.append_pair("limit", "30");
        }

        let request = Request {
            method: Method::Get,
            url: url.to_string(),
            headers: vec![("Accept".to_owned(), "application/json".to_owned())],
            body: None,
            timeout: SEARCH_TIMEOUT,
        };

        let response = self
            .http
            .send(request)
            .await
            .map_err(|error| error.to_string())?;
        if !response.ok() {
            return Err(format!("the registry answered {}", response.status));
        }

        let payload: Value = serde_json::from_str(&response.body)
            .map_err(|_| "the registry sent invalid JSON".to_owned())?;
        Ok(parse_servers(&payload))
    }
}

/// The last name segment, since registry names are namespaced like packages. Each UTF-16 unit outside ASCII becomes a dash.
pub fn id_for(name: &str) -> String {
    let last = name.rsplit('/').next().unwrap_or_default();
    let mapped: String = last
        .encode_utf16()
        .map(|unit| match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-' => {
                char::from(byte)
            }
            _ => '-',
        })
        .collect();

    let trimmed = mapped.trim_matches('-').to_ascii_lowercase();
    if trimmed.is_empty() {
        "server".to_owned()
    } else {
        trimmed
    }
}

/// One registry server as something installable or callable. Anything that is neither is dropped rather than shown and failing.
pub fn to_entry(server: &Value) -> Option<Entry> {
    let packages = array_of(server.get("packages"));
    let remotes = array_of(server.get("remotes"));

    let npm = packages.iter().find(|one| {
        let registry = or(&[one.get("registry_name"), one.get("registryType")]);
        registry.and_then(Value::as_str) == Some("npm")
    });

    let remote = remotes.iter().find(|one| {
        let kind = text(or(&[one.get("type"), one.get("transport_type")]));
        ["streamable-http", "streamable", "http", "sse"].contains(&kind.to_lowercase().as_str())
    });

    if npm.is_none() && remote.is_none() {
        return None;
    }

    let docs = text(or(&[
        server
            .get("repository")
            .and_then(|repository| repository.get("url")),
        server.get("website_url"),
    ]));

    let base = Entry {
        id: id_for(&text(server.get("name"))),
        name: or(&[server.get("title"), server.get("name")]).map(|value| text(Some(value))),
        description: text(server.get("description")).trim().to_owned(),
        source: Some("registry".to_owned()),
        docs: Some(docs),
        ..Entry::default()
    };

    Some(match (npm, remote) {
        (Some(package), _) => {
            let variables = env_of(package, server);
            Entry {
                package: or(&[package.get("name"), package.get("identifier")])
                    .map(|value| text(Some(value))),
                args: Some(Vec::new()),
                env: Some(variables),
                ..base
            }
        }
        (None, Some(one)) => Entry {
            url: one.get("url").map(|value| text(Some(value))),
            transport: Some("http".to_owned()),
            remote: Some(true),
            ..base
        },
        (None, None) => return None,
    })
}

/// The registry's answer as entries. Anything Draggy already ships is left out, since its own entry describes it better.
pub fn parse_servers(payload: &Value) -> Vec<Entry> {
    let servers = match payload.get("servers") {
        Some(Value::Array(servers)) => servers.clone(),
        _ => match payload {
            Value::Array(servers) => servers.clone(),
            _ => Vec::new(),
        },
    };

    servers
        .iter()
        .filter_map(|one| {
            let server = or(&[one.get("server"), Some(one)]).unwrap_or(&Value::Null);
            to_entry(server)
        })
        .filter(|entry| find_entry(&entry.id).is_none())
        .collect()
}

fn env_of(package: &Value, server: &Value) -> Vec<EnvVar> {
    let declared = or(&[
        package.get("environment_variables"),
        package.get("environmentVariables"),
        server.get("environment_variables"),
        server.get("environmentVariables"),
    ]);

    array_of(declared)
        .iter()
        .map(|variable| {
            let key = or(&[variable.get("name"), variable.get("key")]);
            let label = or(&[
                variable.get("description"),
                variable.get("name"),
                variable.get("key"),
            ]);
            EnvVar {
                key: text(key),
                label: label.map(|value| text(Some(value))),
                required: Some(truthy(nullish(
                    variable.get("is_required"),
                    variable.get("required"),
                ))),
                secret: Some(truthy(nullish(
                    variable.get("is_secret"),
                    variable.get("secret"),
                ))),
            }
        })
        .collect()
}

/// `a ?? b`: the first operand that is present and not JSON null.
fn nullish<'a>(first: Option<&'a Value>, second: Option<&'a Value>) -> Option<&'a Value> {
    match first {
        Some(Value::Null) | None => second,
        present => present,
    }
}

fn array_of(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        _ => Vec::new(),
    }
}

fn answer_of(value: &Value) -> Answer {
    let at = value.get("at").and_then(Value::as_f64);
    let entries = serde_json::from_value(value.get("entries").cloned().unwrap_or(Value::Null))
        .unwrap_or_default();
    Answer { at, entries }
}

fn answer_to_value(at: u64, entries: &[Entry]) -> Value {
    serde_json::json!({ "at": at, "entries": entries })
}

fn fresh(answer: &Answer, now_ms: u64) -> bool {
    answer
        .at
        .is_some_and(|at| (now_ms as f64) - at < CACHE_TTL_MS as f64)
}

fn read_cache<C: Cache>(cache: &C) -> Map<String, Value> {
    match cache
        .read()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
    {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn write_cache<C: Cache>(cache: &C, map: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string(map).map_err(|error| error.to_string())?;
    cache.write(&text)
}
