//! The providers the user added. Records live in the kv store under one key; a key lives only in the keystore and
//! never reaches the renderer, which sees whether one is set and its last four characters.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::info;
use url::Url;

use crate::adapters::common::Connection;
use crate::catalog::{Catalog, CatalogEntry};
use crate::js::{slice_units, to_string};
use crate::models::ConnectionSource;

const KEY: &str = "providers";
const PROFILES: [&str; 3] = ["auto", "compact", "full"];
const FLAG_NAMES: [&str; 3] = ["tools", "vision", "thinking"];
const MAX_PINNED: usize = 500;

/// Where the records are kept. A write replaces the whole value.
pub trait KvStore {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&mut self, key: &str, value: &str);
}

/// The keystore: one key per owner, never handed back to the renderer.
pub trait Keystore {
    fn available(&self) -> bool;
    fn get(&self, owner: &str) -> Option<String>;
    /// Stores the key, or clears it when `None`. False when the keystore refused the write.
    fn set(&mut self, owner: &str, key: Option<&str>) -> bool;
    fn remove(&mut self, owner: &str);
}

/// A user-visible refusal. Its text is the reference's message, shown to the user as it is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct RegistryError(pub String);

/// A flag a user set for one model. Only the three capability flags are kept.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<bool>,
}

/// One added provider as it is stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub label: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub pinned_models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_models: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_profile: Option<String>,
    #[serde(default)]
    pub model_overrides: BTreeMap<String, ModelOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
}

/// What the renderer may see of an instance: everything but the key, with the address and key hint worked out.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub label: String,
    pub enabled: bool,
    pub pinned_models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_models: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_profile: Option<String>,
    pub model_overrides: BTreeMap<String, ModelOverride>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    pub name: String,
    pub kind: String,
    pub protocol: String,
    pub base_url: String,
    pub has_key: bool,
    pub key_hint: String,
    pub needs_key: bool,
    pub new_models: Vec<String>,
}

/// What `add` takes: the type, and optionally a label, an address and headers.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddArgs {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub label: Option<String>,
    pub base_url: Option<String>,
    pub headers: Option<BTreeMap<String, Value>>,
}

/// The fields `update` may change. Each `None` is left as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub label: Option<String>,
    pub base_url: Option<String>,
    pub headers: Option<BTreeMap<String, Value>>,
    pub prompt_profile: Option<String>,
    pub pinned_models: Option<Vec<String>>,
    pub model_overrides: Option<BTreeMap<String, Value>>,
    pub enabled: Option<bool>,
}

/// An instance and everything a request to it needs.
#[derive(Debug, Clone)]
pub struct InstanceConnection {
    pub instance: Instance,
    pub entry: Option<CatalogEntry>,
    pub base_url: String,
    pub api_key: String,
    pub headers: BTreeMap<String, String>,
}

impl InstanceConnection {
    /// The connection the adapters take.
    pub fn adapter(&self) -> Connection {
        Connection {
            instance_id: Some(self.instance.id.clone()),
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            headers: self.headers.clone(),
            entry: self.entry.clone(),
        }
    }
}

/// The added providers over a kv store and a keystore. `catalog` is the list in use; `bundled` is what ships.
pub struct Registry<K: KvStore, S: Keystore> {
    storage: K,
    secrets: S,
    catalog: Catalog,
    bundled: Catalog,
}

impl<K: KvStore, S: Keystore> Registry<K, S> {
    pub fn new(storage: K, secrets: S, catalog: Catalog) -> Self {
        Self {
            storage,
            secrets,
            catalog,
            bundled: Catalog::bundled(),
        }
    }

    /// Swaps in a catalog, such as one a verified remote file produced.
    pub fn set_catalog(&mut self, catalog: Catalog) {
        self.catalog = catalog;
    }

    /// Every instance as the renderer sees it.
    pub fn list(&self) -> Vec<ProviderView> {
        self.load()
            .iter()
            .map(|instance| self.view(instance))
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<Instance> {
        self.load().into_iter().find(|instance| instance.id == id)
    }

    /// Adds an instance, switched off, with the catalog's curated models ticked.
    pub fn add(&mut self, args: AddArgs) -> Result<ProviderView, RegistryError> {
        let entry = self
            .catalog
            .find(&args.provider_type)
            .cloned()
            .ok_or_else(|| err(format!("Unknown provider type: {}", args.provider_type)))?;
        let mut instances = self.load();
        let mut id = args.provider_type.clone();
        let mut n = 2;
        while instances.iter().any(|instance| instance.id == id) {
            id = format!("{}-{n}", args.provider_type);
            n += 1;
        }
        let label = args
            .label
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| entry.name.clone());
        let mut instance = Instance {
            id,
            provider_type: args.provider_type.clone(),
            label: slice_units(&label, 80),
            enabled: false,
            pinned_models: entry.default_models.clone(),
            known_models: Some(entry.default_models.clone()),
            prompt_profile: Some("auto".to_owned()),
            model_overrides: BTreeMap::new(),
            base_url: None,
            headers: None,
        };
        if args.base_url.is_some() || args.provider_type == "custom" {
            instance.base_url = Some(check_base_url(Some(&entry), args.base_url.as_deref())?);
        }
        if let Some(headers) = &args.headers {
            instance.headers = Some(check_headers(headers)?);
        }
        instances.push(instance.clone());
        self.save(&instances);
        info!(target: "providers.registry", id = %instance.id, provider_type = %instance.provider_type, "provider added");
        Ok(self.view(&instance))
    }

    /// Changes an instance. A switch on needs a key, and a keyless provider needs a keystore to hold one.
    pub fn update(&mut self, id: &str, patch: Patch) -> Result<ProviderView, RegistryError> {
        let mut instances = self.load();
        let index = instances
            .iter()
            .position(|instance| instance.id == id)
            .ok_or_else(|| err(format!("No provider {id}")))?;
        let mut instance = instances[index].clone();
        let entry = self.catalog.find(&instance.provider_type).cloned();
        if let Some(label) = patch.label {
            let cut = slice_units(&label, 80);
            instance.label = if cut.is_empty() {
                entry
                    .as_ref()
                    .map_or_else(|| instance.provider_type.clone(), |e| e.name.clone())
            } else {
                cut
            };
        }
        if let Some(base_url) = patch.base_url {
            instance.base_url = Some(check_base_url(entry.as_ref(), Some(&base_url))?);
        }
        if let Some(headers) = &patch.headers {
            instance.headers = Some(check_headers(headers)?);
        }
        if let Some(profile) = patch.prompt_profile {
            if !PROFILES.contains(&profile.as_str()) {
                return Err(err("Unknown prompt profile".to_owned()));
            }
            instance.prompt_profile = Some(profile);
        }
        if let Some(pinned) = patch.pinned_models {
            instance.pinned_models = unique(pinned.into_iter())
                .into_iter()
                .take(MAX_PINNED)
                .collect();
            let mut known = self.known_of(&instance);
            known.extend(self.default_models_of(&instance.provider_type));
            instance.known_models = Some(unique(known.into_iter()));
        }
        if let Some(overrides) = &patch.model_overrides {
            instance.model_overrides = check_overrides(overrides);
        }
        if let Some(enabled) = patch.enabled {
            if enabled
                && self.needs_key(&instance)
                && (!self.secrets.available() || self.key_of(id).is_empty())
            {
                return Err(err(if self.secrets.available() {
                    "Add a key first."
                } else {
                    "No keystore on this system."
                }
                .to_owned()));
            }
            instance.enabled = enabled;
        }
        instances[index] = instance.clone();
        self.save(&instances);
        info!(target: "providers.registry", id, enabled = instance.enabled, pinned = instance.pinned_models.len(), "provider updated");
        Ok(self.view(&instance))
    }

    /// Removes an instance and its key.
    pub fn remove(&mut self, id: &str) {
        let kept: Vec<Instance> = self
            .load()
            .into_iter()
            .filter(|instance| instance.id != id)
            .collect();
        self.save(&kept);
        self.secrets.remove(&owner_of(id));
        info!(target: "providers.registry", id, "provider removed");
    }

    /// Stores a key, or clears it. A cleared key switches its provider off. The result never carries the key.
    pub fn set_key(&mut self, id: &str, key: &str) -> Result<ProviderView, RegistryError> {
        if self.get(id).is_none() {
            return Err(err(format!("No provider {id}")));
        }
        if !self.secrets.available() {
            return Err(err("No keystore on this system.".to_owned()));
        }
        let key = key.trim();
        if !self
            .secrets
            .set(&owner_of(id), (!key.is_empty()).then_some(key))
        {
            return Err(err("The key could not be stored.".to_owned()));
        }
        if key.is_empty() {
            self.update(
                id,
                Patch {
                    enabled: Some(false),
                    ..Patch::default()
                },
            )?;
        }
        info!(target: "providers.registry", id, cleared = key.is_empty(), "key updated");
        let instance = self
            .get(id)
            .ok_or_else(|| err(format!("No provider {id}")))?;
        Ok(self.view(&instance))
    }

    /// The address, key and headers a request to the instance uses. Only the main process reads these.
    pub fn connection_for(&self, id: &str) -> Option<InstanceConnection> {
        let instance = self.get(id)?;
        Some(InstanceConnection {
            base_url: self.base_url_of(&instance),
            api_key: self.key_of(id),
            headers: instance.headers.clone().unwrap_or_default(),
            entry: self.catalog.find(&instance.provider_type).cloned(),
            instance,
        })
    }

    /// The addresses of the switched-on instances, for the gateway.
    pub fn enabled_base_urls(&self) -> Vec<String> {
        self.load()
            .iter()
            .filter(|instance| instance.enabled)
            .map(|instance| self.base_url_of(instance))
            .filter(|url| !url.is_empty())
            .collect()
    }

    /// The address an instance uses: its own, else the catalog's, without trailing slashes.
    pub fn base_url_of(&self, instance: &Instance) -> String {
        let raw = match instance.base_url.as_deref().filter(|url| !url.is_empty()) {
            Some(url) => url.to_owned(),
            None => self
                .catalog
                .find(&instance.provider_type)
                .map(|entry| entry.base_url.clone())
                .unwrap_or_default(),
        };
        raw.trim_end_matches('/').to_owned()
    }

    fn load(&self) -> Vec<Instance> {
        let Some(text) = self.storage.get(KEY) else {
            return Vec::new();
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
            return Vec::new();
        };
        let Some(items) = parsed.get("instances").and_then(Value::as_array) else {
            return Vec::new();
        };
        items
            .iter()
            // TS quirk: the reference keeps a stored record that is not a complete instance; the port skips it.
            .filter_map(|item| serde_json::from_value::<Instance>(item.clone()).ok())
            .map(without_default)
            .collect()
    }

    fn save(&mut self, instances: &[Instance]) {
        let text = serde_json::json!({ "instances": instances }).to_string();
        self.storage.set(KEY, &text);
    }

    fn key_of(&self, id: &str) -> String {
        self.secrets.get(&owner_of(id)).unwrap_or_default()
    }

    fn needs_key(&self, instance: &Instance) -> bool {
        match self.catalog.find(&instance.provider_type) {
            None => true,
            Some(entry) => {
                entry.auth != "none" && entry.auth != "account" && entry.key_optional != Some(true)
            }
        }
    }

    /// The models the instance has been shown before: its own list, else the bundled catalog's.
    fn known_of(&self, instance: &Instance) -> Vec<String> {
        instance
            .known_models
            .clone()
            .unwrap_or_else(|| self.default_models_of_bundled(&instance.provider_type))
    }

    fn default_models_of(&self, provider_type: &str) -> Vec<String> {
        self.catalog
            .find(provider_type)
            .map(|entry| entry.default_models.clone())
            .unwrap_or_default()
    }

    fn default_models_of_bundled(&self, provider_type: &str) -> Vec<String> {
        self.bundled
            .find(provider_type)
            .map(|entry| entry.default_models.clone())
            .unwrap_or_default()
    }

    fn view(&self, instance: &Instance) -> ProviderView {
        let key = self.key_of(&instance.id);
        let entry = self.catalog.find(&instance.provider_type);
        let known = self.known_of(instance);
        let new_models = entry
            .map(|entry| entry.default_models.clone())
            .unwrap_or_default()
            .into_iter()
            .filter(|id| !known.contains(id) && !instance.pinned_models.contains(id))
            .collect();
        ProviderView {
            id: instance.id.clone(),
            provider_type: instance.provider_type.clone(),
            label: instance.label.clone(),
            enabled: instance.enabled,
            pinned_models: instance.pinned_models.clone(),
            known_models: instance.known_models.clone(),
            prompt_profile: instance.prompt_profile.clone(),
            model_overrides: instance.model_overrides.clone(),
            headers: instance.headers.clone(),
            name: entry.map_or_else(|| instance.provider_type.clone(), |e| e.name.clone()),
            kind: entry.map_or_else(|| "cloud".to_owned(), |e| e.kind.clone()),
            protocol: entry.map_or_else(|| "openai".to_owned(), |e| e.protocol.clone()),
            base_url: self.base_url_of(instance),
            has_key: !key.is_empty(),
            key_hint: key
                .chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
            needs_key: self.needs_key(instance),
            new_models,
        }
    }
}

impl<K: KvStore, S: Keystore> ConnectionSource for Registry<K, S> {
    fn connection_for(&self, instance_id: &str) -> Option<InstanceConnection> {
        Registry::connection_for(self, instance_id)
    }
}

fn err(message: String) -> RegistryError {
    RegistryError(message)
}

fn owner_of(id: &str) -> String {
    format!("provider:{id}")
}

/// A set of strings in first-seen order.
fn unique(items: impl Iterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    items.filter(|item| seen.insert(item.clone())).collect()
}

/// Models an earlier sign-in ticked that the listing no longer offers: Claude's `default` named `opus`, and the
/// ChatGPT backend refuses gpt-5.5 to plan accounts.
fn retired_for(provider_type: &str) -> &'static [(&'static str, Option<&'static str>)] {
    match provider_type {
        "claude" => &[("default", Some("opus"))],
        "chatgpt" => &[("gpt-5.5", None)],
        _ => &[],
    }
}

fn without_default(mut instance: Instance) -> Instance {
    let retired = retired_for(&instance.provider_type);
    if retired.is_empty()
        || !instance
            .pinned_models
            .iter()
            .any(|id| retired.iter().any(|(old, _)| old == id))
    {
        return instance;
    }
    let replaced = instance.pinned_models.iter().filter_map(|id| {
        match retired.iter().find(|(old, _)| old == id) {
            Some((_, new)) => new.map(str::to_owned),
            None => Some(id.clone()),
        }
    });
    instance.pinned_models = unique(replaced);
    instance
}

/// The address a user may give: http or https, no key or credentials in it, and the one the catalog allows.
fn check_base_url(
    entry: Option<&CatalogEntry>,
    value: Option<&str>,
) -> Result<String, RegistryError> {
    let text = value.unwrap_or_default().trim();
    let url = Url::parse(text).map_err(|_| err("That address is not a URL.".to_owned()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(err("Only http and https addresses are allowed.".to_owned()));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some_and(|query| !query.is_empty())
    {
        return Err(err(
            "Put a key in the key field, not in the address.".to_owned()
        ));
    }
    if let Some(entry) = entry {
        if entry.kind == "cloud" && entry.id != "custom" {
            return Err(err("This provider's address cannot be changed.".to_owned()));
        }
        if entry.kind == "local"
            && !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        {
            return Err(err(
                "A server elsewhere on the network is added as Custom.".to_owned()
            ));
        }
    }
    Ok(text.trim_end_matches('/').to_owned())
}

/// Header names that are plain tokens and values that cannot break out of their line.
fn check_headers(
    headers: &BTreeMap<String, Value>,
) -> Result<BTreeMap<String, String>, RegistryError> {
    let mut kept = BTreeMap::new();
    for (name, value) in headers {
        let valid_name = (1..=64).contains(&name.chars().count())
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !valid_name {
            return Err(err(format!("Bad header name: {name}")));
        }
        let text = to_string(value);
        if text.contains('\r') || text.contains('\n') {
            return Err(err(format!("Bad header value for {name}")));
        }
        kept.insert(name.clone(), slice_units(&text, 2000));
    }
    Ok(kept)
}

/// Keeps only the capability flags a user set, as booleans, and drops a model that set none.
fn check_overrides(overrides: &BTreeMap<String, Value>) -> BTreeMap<String, ModelOverride> {
    let mut kept = BTreeMap::new();
    for (model, flags) in overrides {
        let flag = |name: &str| flags.get(name).and_then(Value::as_bool);
        let entry = ModelOverride {
            tools: flag(FLAG_NAMES[0]),
            vision: flag(FLAG_NAMES[1]),
            thinking: flag(FLAG_NAMES[2]),
        };
        if entry != ModelOverride::default() {
            kept.insert(model.clone(), entry);
        }
    }
    kept
}
