//! The models each provider instance offers, and what each can do: the listing's own facts first, then the catalog's
//! patterns, then the user's override, which always wins. Listings are kept for a day, and a refusal for a minute.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use serde_json::Value;
use tracing::{debug, info, warn};

use crate::adapters::common::ListedModel;
use crate::adapters::{anthropic, gemini, ollama, openai};
use crate::autopin::{PinPlan, plan_pins};
use crate::catalog::{CatalogEntry, capabilities_for};
use crate::errors::{from_network, from_response_text};
use crate::http::{HttpClient, HttpRequest, Method};
use crate::js::{count_or_none, truthy};
use crate::registry::{
    Instance, InstanceConnection, Keystore, KvStore, ModelOverride, Patch, Registry,
};
use crate::types::{ErrorKind, ProviderError};

pub const FLAGS: [&str; 3] = ["tools", "vision", "thinking"];
const DAY_MS: u64 = 86_400_000;
const FAILURE_MS: u64 = 60_000;
const TIMEOUT_MS: u64 = 15_000;
/// Ollama is asked about this many models at most; the rest stay unknown.
const MAX_SHOWN: usize = 50;

/// A listing that failed: a provider's failure, or a plain message for anything else.
#[derive(Debug, Clone, PartialEq)]
pub enum ListError {
    Failure(ProviderError),
    Other(String),
}

impl std::fmt::Display for ListError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ListError::Failure(failure) => write!(f, "{failure}"),
            ListError::Other(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ListError {}

/// A model as the renderer sees it: its reference, window, capabilities and whether a pin ticks it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub name: Option<String>,
    pub context_length: Option<u64>,
    pub max_output_tokens: Option<u64>,
    pub capabilities: Vec<String>,
    pub cloud: bool,
    pub pinned: bool,
    #[serde(rename = "override")]
    pub override_flags: Option<ModelOverride>,
}

/// Answers for an account's models, from its own runtime, which the app wires up.
pub trait AccountRuntime {
    fn models(&self, instance_id: &str) -> Result<Vec<ListedModel>, ListError>;
}

/// Where the connection for an instance comes from: the registry, in the app.
pub trait ConnectionSource {
    fn connection_for(&self, instance_id: &str) -> Option<InstanceConnection>;
}

#[derive(Debug, Clone)]
struct Cached {
    stamp: String,
    at: u64,
    listed: Option<Vec<ListedModel>>,
    error: Option<ListError>,
}

/// Lists models per instance over an HTTP client, with the account runtimes it was given. `now` is passed in.
pub struct ModelLister<H: HttpClient> {
    http: H,
    accounts: BTreeMap<String, Box<dyn AccountRuntime>>,
    cache: HashMap<String, Cached>,
}

impl<H: HttpClient> ModelLister<H> {
    pub fn new(http: H) -> Self {
        Self {
            http,
            accounts: BTreeMap::new(),
            cache: HashMap::new(),
        }
    }

    /// Gives an account protocol its runtime.
    pub fn with_account(mut self, protocol: &str, runtime: Box<dyn AccountRuntime>) -> Self {
        self.accounts.insert(protocol.to_owned(), runtime);
        self
    }

    /// Drops the cached listing of one instance, or of every instance.
    pub fn forget(&mut self, instance_id: Option<&str>) {
        match instance_id {
            Some(id) => {
                self.cache.remove(id);
            }
            None => self.cache.clear(),
        }
    }

    /// A forced listing of an enabled instance, then the auto-pin plan written through the registry. A refusal or a
    /// switched-off instance writes nothing, so the menu keeps what it had.
    pub fn refresh_auto_pins<K: KvStore, S: Keystore>(
        &mut self,
        registry: &mut Registry<K, S>,
        instance_id: &str,
        now: u64,
    ) -> Option<PinPlan> {
        let conn = registry.connection_for(instance_id)?;
        if !conn.instance.enabled {
            return None;
        }
        let listed: Vec<String> = self
            .list(&*registry, instance_id, true, now)
            .ok()?
            .into_iter()
            .map(|model| model.id)
            .collect();
        let plan = plan_pins(
            conn.entry.as_ref(),
            &listed,
            &conn.instance.pinned_models,
            conn.instance.seen_models.as_deref(),
        );
        registry
            .update(
                instance_id,
                Patch {
                    pinned_models: Some(plan.pinned_models.clone()),
                    seen_models: Some(plan.seen_models.clone()),
                    ..Patch::default()
                },
            )
            .ok()?;
        Some(plan)
    }

    /// Every model the instance lists, from the cache when it is recent enough unless `refresh` asks again.
    pub fn list<R: ConnectionSource>(
        &mut self,
        registry: &R,
        instance_id: &str,
        refresh: bool,
        now: u64,
    ) -> Result<Vec<ModelInfo>, ListError> {
        let conn = registry
            .connection_for(instance_id)
            .ok_or_else(|| ListError::Other(format!("No provider {instance_id}")))?;
        let stamp = format!("{}|{}", conn.base_url, !conn.api_key.is_empty());
        let hit = self.cache.get(instance_id).cloned();
        let fresh = !refresh && hit.as_ref().is_some_and(|hit| hit.stamp == stamp);
        if let Some(hit) = hit.as_ref().filter(|_| fresh)
            && let Some(error) = &hit.error
            && now.saturating_sub(hit.at) < FAILURE_MS
        {
            debug!(target: "providers.models", instance_id, "listing refusal cached");
            return Err(error.clone());
        }
        let cached = hit
            .as_ref()
            .filter(|hit| fresh && now.saturating_sub(hit.at) < DAY_MS)
            .and_then(|hit| hit.listed.clone());
        let listed = match cached {
            Some(listed) => {
                debug!(target: "providers.models", instance_id, models = listed.len(), "listing cache hit");
                listed
            }
            None => {
                debug!(target: "providers.models", instance_id, refresh, "listing cache miss");
                match self.fetch_listing(&conn, now) {
                    Ok(models) => {
                        info!(target: "providers.models", instance_id, models = models.len(), "listing fetched");
                        self.cache.insert(
                            instance_id.to_owned(),
                            Cached {
                                stamp,
                                at: now,
                                listed: Some(models.clone()),
                                error: None,
                            },
                        );
                        models
                    }
                    Err(error) => {
                        warn!(target: "providers.models", instance_id, "listing failed");
                        self.cache.insert(
                            instance_id.to_owned(),
                            Cached {
                                stamp,
                                at: now,
                                listed: None,
                                error: Some(error.clone()),
                            },
                        );
                        return Err(error);
                    }
                }
            }
        };
        let mut infos: Vec<ModelInfo> = listed
            .iter()
            .map(|model| describe(&conn.instance, conn.entry.as_ref(), model))
            .collect();
        // TS quirk: the reference sorts with localeCompare; comparing lowercase text differs for punctuation such as a colon.
        infos.sort_by(|a, b| {
            a.id.to_lowercase()
                .cmp(&b.id.to_lowercase())
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(infos)
    }

    fn fetch_listing(
        &self,
        conn: &InstanceConnection,
        now: u64,
    ) -> Result<Vec<ListedModel>, ListError> {
        let adapter = conn.adapter();
        if let Some(entry) = conn.entry.as_ref().filter(|entry| entry.kind == "account") {
            let runtime = self.accounts.get(&entry.protocol).ok_or_else(|| {
                ListError::Failure(ProviderError {
                    kind: ErrorKind::AccountRuntimeUnavailable,
                    status: None,
                    message: Some(format!("{} is not available here.", entry.name)),
                    provider_message: None,
                    retry_after: None,
                })
            })?;
            return runtime.models(&conn.instance.id);
        }
        let protocol = conn.entry.as_ref().map(|entry| entry.protocol.as_str());
        match protocol {
            Some("ollama") => {
                let mut listed =
                    ollama::parse_models(&self.request(ollama::models_request(&adapter), now)?);
                for model in listed.iter_mut().take(MAX_SHOWN) {
                    // `/api/show` is the only place Ollama says what a model takes; a model it cannot show stays unknown.
                    if let Ok(shown) = self.request(ollama::show_request(&adapter, &model.id), now)
                    {
                        let show = ollama::parse_show(&shown);
                        model.capabilities = Some(show.capabilities);
                        model.context_length = show.context_length;
                    }
                }
                return Ok(listed);
            }
            Some("anthropic") => {
                return Ok(anthropic::parse_models(
                    &self.request(anthropic::models_request(&adapter), now)?,
                ));
            }
            Some("gemini") => {
                return Ok(gemini::parse_models(
                    &self.request(gemini::models_request(&adapter), now)?,
                ));
            }
            _ => {}
        }
        if conn.instance.provider_type == "lmstudio" {
            let origin = conn.base_url.strip_suffix("/v1").unwrap_or(&conn.base_url);
            let request = HttpRequest {
                method: Method::Get,
                url: format!("{origin}/api/v0/models"),
                headers: conn.headers.clone(),
                body: None,
                timeout_ms: None,
            };
            if let Some(data) = self
                .request(request, now)
                .ok()
                .and_then(|listing| listing.get("data").and_then(Value::as_array).cloned())
            {
                return Ok(data
                    .iter()
                    .filter(|model| model.get("type").and_then(Value::as_str) != Some("embeddings"))
                    .map(lm_studio_model)
                    .collect());
            }
        }
        Ok(openai::parse_models(
            &self.request(openai::models_request(&adapter), now)?,
        ))
    }

    /// One request, its answer parsed as JSON. Anything but a 2xx answer is a provider failure.
    fn request(&self, mut request: HttpRequest, now: u64) -> Result<Value, ListError> {
        request.timeout_ms = Some(TIMEOUT_MS);
        let response = self
            .http
            .send(&request)
            .map_err(|error| ListError::Failure(from_network(&error)))?;
        if !response.ok() {
            return Err(ListError::Failure(from_response_text(
                response.status,
                &response.body,
                &response.headers,
                now,
            )));
        }
        serde_json::from_str(&response.body).map_err(|error| ListError::Other(error.to_string()))
    }
}

/// A model from LM Studio's own listing: its window, and the capabilities its type and tags name.
fn lm_studio_model(model: &Value) -> ListedModel {
    let mut capabilities = vec!["completion".to_owned()];
    if model
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|tags| tags.iter().any(|tag| tag.as_str() == Some("tool_use")))
    {
        capabilities.push("tools".to_owned());
    }
    if model.get("type").and_then(Value::as_str) == Some("vlm") {
        capabilities.push("vision".to_owned());
    }
    ListedModel {
        id: model
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        context_length: count_or_none(model.get("max_context_length")),
        capabilities: Some(capabilities),
        ..ListedModel::default()
    }
}

/// Whether a thinking switch counts: only where Draggy has a switch to send, otherwise the pill would do nothing.
fn thinking_controllable(entry: Option<&CatalogEntry>) -> bool {
    let Some(entry) = entry else {
        return false;
    };
    if entry.kind == "account" {
        return true;
    }
    ["ollama", "anthropic", "gemini"].contains(&entry.protocol.as_str())
        || ["reasoningEffort", "enableThinking", "templateKwargs"]
            .iter()
            .any(|name| truthy(entry.quirks.as_ref().and_then(|q| q.get(*name))))
}

/// What a listing states as capability flags, or None where it says nothing.
fn listed_flags(
    model: &ListedModel,
    entry: Option<&CatalogEntry>,
) -> Option<BTreeMap<&'static str, bool>> {
    if let Some(capabilities) = &model.capabilities {
        return Some(
            FLAGS
                .iter()
                .map(|flag| (*flag, capabilities.iter().any(|c| c == flag)))
                .collect(),
        );
    }
    let mut flags = BTreeMap::new();
    if let Some(supported) = &model.supported {
        flags.insert("tools", supported.iter().any(|p| p == "tools"));
        if thinking_controllable(entry) {
            flags.insert("thinking", supported.iter().any(|p| p == "reasoning"));
        }
    }
    if let Some(modalities) = &model.input_modalities {
        flags.insert("vision", modalities.iter().any(|m| m == "image"));
    }
    (!flags.is_empty()).then_some(flags)
}

/// One model's description, from its listing, the catalog's patterns and the instance's override.
fn describe(instance: &Instance, entry: Option<&CatalogEntry>, model: &ListedModel) -> ModelInfo {
    // An account lists aliases such as `opus`; the full name it resolves to is what the patterns know.
    let pattern = capabilities_for(entry, model.resolved.as_deref().unwrap_or(&model.id));
    let mut flags: BTreeMap<&str, bool> = FLAGS
        .iter()
        .map(|flag| (*flag, pattern.capabilities.iter().any(|c| c == flag)))
        .collect();
    for (flag, on) in listed_flags(model, entry).unwrap_or_default() {
        flags.insert(flag, on);
    }
    if !thinking_controllable(entry) {
        flags.insert("thinking", false);
    }
    let override_flags = instance.model_overrides.get(&model.id).cloned();
    if let Some(over) = &override_flags {
        for (flag, value) in [
            ("tools", over.tools),
            ("vision", over.vision),
            ("thinking", over.thinking),
        ] {
            if let Some(on) = value {
                flags.insert(flag, on);
            }
        }
    }
    let name = model
        .name
        .as_deref()
        .filter(|name| !name.is_empty() && *name != model.id)
        .map(str::to_owned);
    ModelInfo {
        id: model.id.clone(),
        reference: format!("@{}/{}", instance.id, model.id),
        name,
        context_length: model
            .context_length
            .filter(|n| *n > 0)
            .or(pattern.context_length),
        max_output_tokens: pattern.max_output_tokens,
        capabilities: std::iter::once("completion".to_owned())
            .chain(
                FLAGS
                    .iter()
                    .filter(|flag| flags.get(*flag).copied().unwrap_or(false))
                    .map(|flag| (*flag).to_owned()),
            )
            .collect(),
        // Data leaves the machine for a cloud provider, and for a local server's cloud-hosted models.
        cloud: entry.is_none_or(|entry| entry.kind != "local") || model.cloud,
        pinned: instance.pinned_models.contains(&model.id),
        override_flags,
    }
}
