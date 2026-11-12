//! Handlers for the provider channels: the catalog, the added providers and their keys, model listings, the
//! connection test, the local scan and the account channels.
//! Claude and Codex accounts have runtimes.

pub(crate) mod account;
pub(crate) mod adapters;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use draggy_diagnostics::Diagnostics;
use draggy_providers::autopin::plan_pins;
use draggy_providers::catalog::{Catalog, CatalogEntry};
use draggy_providers::discovery::Discovery;
use draggy_providers::models::{ListError, ModelLister};
use draggy_providers::registry::{AddArgs, Keystore, Patch, Registry as Providers, RegistryError};
use draggy_providers::remote_catalog::{InstanceUse, PUBLIC_KEY, Refresh, RemoteCatalog};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WindowEvent};

use self::adapters::{AppHttp, AppKeys, AppKv};
use super::storage::blocking;
use super::{IpcError, Registry, emit};
use crate::AppState;

/// The port the local engine listens on by default. Scans skip it.
const ENGINE_PORT: u16 = 11435;
/// The api server's default port and the key its settings live under. Scans skip its port too.
const API_DEFAULT_PORT: u16 = 11500;
const API_CONFIG_KEY: &str = "apiServer";
const FIRST_REFRESH: Duration = Duration::from_secs(30);
const EVERY_REFRESH: Duration = Duration::from_secs(6 * 60 * 60);
const MODELS_CHANGED: &str = "providers:models-changed";
/// A focus refresh is skipped when the last one was this recent.
const FOCUS_GAP: Duration = Duration::from_secs(60);
/// The remote catalog is checked hourly; the file itself is fetched at most once a day.
const REMOTE_EVERY: Duration = Duration::from_secs(60 * 60);

type Lister = ModelLister<AppHttp>;
type Store = Providers<AppKv, AppKeys>;

/// One lister for the run, so the 6h listing cache serves every window and the refresh.
static LISTER: OnceLock<Mutex<Lister>> = OnceLock::new();
/// The ids each instance listed last round. The first round only seeds this.
static LAST_IDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
/// The bundled catalog with the signed remote file laid over it, once one has been accepted.
static ACTIVE_CATALOG: RwLock<Option<Catalog>> = RwLock::new(None);
/// When the last focus refresh started. None until the first.
static LAST_FOCUS: Mutex<Option<Instant>> = Mutex::new(None);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "providers:catalog" => catalog);
    register!(registry, "providers:list" => list);
    register!(registry, "providers:add" => add);
    register!(registry, "providers:update" => update);
    register!(registry, "providers:remove" => remove);
    register!(registry, "providers:set-key" => set_key);
    register!(registry, "providers:models" => models);
    register!(registry, "providers:test" => test);
    register!(registry, "providers:scan" => scan);
    register!(registry, "providers:account-sign-in" => account::sign_in);
    register!(registry, "providers:account-cancel" => account::cancel);
    register!(registry, "providers:account-submit-code" => account::submit_code);
    register!(registry, "providers:account-sign-out" => account::sign_out);
    register!(registry, "providers:account-status" => account::status);
}

async fn catalog(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let view = blocking(move || {
        let keystore = keystore_open(&app);
        let bundled = active_catalog();
        let mut view = catalog_view(bundled.entries(), keystore);
        account::fill_downloads(&mut view, bundled.entries());
        view
    })
    .await?;
    Ok(view)
}

async fn list(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    blocking(move || json!(store(&app).list())).await
}

async fn add(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let input = arg(&args, 0);
    blocking(move || {
        // A missing type is refused by the registry, as the reference does.
        let add: AddArgs = serde_json::from_value(input).unwrap_or_default();
        let result = store(&app).add(add);
        outcome(&app, result, |view| json!({ "instance": view }))
    })
    .await
}

async fn update(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let patch = arg(&args, 1);
    blocking(move || {
        let moves_address = patch
            .as_object()
            .is_some_and(|map| map.contains_key("baseUrl") || map.contains_key("headers"));
        let patch: Patch = serde_json::from_value(patch).unwrap_or_default();
        let result = store(&app).update(&id, patch);
        if result.is_ok() && moves_address {
            forget(&id);
        }
        outcome(&app, result, |view| json!({ "instance": view }))
    })
    .await
}

async fn remove(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    blocking(move || {
        store(&app).remove(&id);
        forget(&id);
        json!({ "success": true })
    })
    .await
}

async fn set_key(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let key = text(&args, 1);
    blocking(move || {
        let result = store(&app).set_key(&id, &key);
        forget(&id);
        outcome(&app, result, |view| json!({ "instance": view }))
    })
    .await
}

async fn models(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let refresh = arg(&args, 1)
        .get("refresh")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    blocking(move || {
        match with_lister(|lister| lister.list(&store(&app), &id, refresh, now_ms())) {
            Ok(infos) => json!({ "success": true, "models": infos }),
            Err(error) => failed(&app, &error),
        }
    })
    .await
}

/// A fresh listing is the test: it proves the address, the key and the network in one request.
async fn test(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    blocking(
        move || match with_lister(|lister| lister.list(&store(&app), &id, true, now_ms())) {
            Ok(infos) => {
                diag(&app).info(
                    "providers.ipc",
                    "provider test passed",
                    Some(json!({ "count": infos.len() })),
                );
                json!({ "success": true, "count": infos.len() })
            }
            Err(error) => failed(&app, &error),
        },
    )
    .await
}

async fn scan(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    blocking(move || {
        let ports = [ENGINE_PORT, api_port(&app)];
        let servers =
            Discovery::new(AppHttp).scan(&active_catalog(), &ports, cfg!(debug_assertions));
        diag(&app).info(
            "providers.ipc",
            "scan done",
            Some(json!({ "servers": servers.len() })),
        );
        json!({ "success": true, "servers": servers })
    })
    .await
}

/// Keeps every enabled provider's model list current with no setting: shortly after launch, then every six hours.
/// A new model is pinned into the menu and the page is told; the first round only seeds the list.
pub(crate) fn start_auto_refresh(app: &AppHandle) {
    load_remote_catalog(app);
    let remote_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let round_app = remote_app.clone();
            let _ =
                tauri::async_runtime::spawn_blocking(move || refresh_remote_catalog(&round_app))
                    .await;
            tokio::time::sleep(REMOTE_EVERY).await;
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_REFRESH).await;
        loop {
            let round_app = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                refresh_round(&round_app, &[false, true])
            })
            .await;
            tokio::time::sleep(EVERY_REFRESH).await;
        }
    });
}

/// Refreshes local servers when the main window gains focus, from launch on.
pub(crate) fn attach_focus_refresh(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let focus_app = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(true)) {
                focus_refresh(&focus_app);
            }
        });
    }
}

/// Cloud providers first, then local servers, as the reference does. Accounts refresh with the rest.
fn refresh_round(app: &AppHandle, kinds: &[bool]) {
    let mut providers = store(app);
    for &local in kinds {
        for view in providers.list() {
            if !view.enabled || (view.kind == "local") != local {
                continue;
            }
            let _ = refresh_one(app, &mut providers, &view.id);
        }
    }
}

/// The window coming back refreshes local servers only, at most once a minute.
fn focus_refresh(app: &AppHandle) {
    {
        let mut last = LAST_FOCUS.lock().unwrap_or_else(PoisonError::into_inner);
        if !focus_due(*last, Instant::now()) {
            return;
        }
        *last = Some(Instant::now());
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_round(&app, &[true]));
}

fn focus_due(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|at| now.saturating_duration_since(at) >= FOCUS_GAP)
}

/// The stored remote file is laid over the bundled catalog at start, checked again as if just fetched.
fn load_remote_catalog(app: &AppHandle) {
    if let Some(catalog) =
        RemoteCatalog::new(kv(app), AppHttp, PUBLIC_KEY).load(&instance_uses(app))
    {
        set_active_catalog(catalog);
    }
}

/// Fetches the signed file at most once a day, and only while a cloud provider is on.
fn refresh_remote_catalog(app: &AppHandle) {
    let mut remote = RemoteCatalog::new(kv(app), AppHttp, PUBLIC_KEY);
    match remote.refresh(now_ms(), &instance_uses(app)) {
        Refresh::Updated(catalog) => {
            diag(app).info(
                "providers.remote",
                "catalog updated",
                Some(json!({ "entries": catalog.entries().len() })),
            );
            set_active_catalog(catalog);
        }
        Refresh::Failed(reason) => {
            diag(app).warn(
                "providers.remote",
                "catalog refresh failed",
                Some(json!({ "reason": reason })),
            );
        }
        Refresh::Skipped | Refresh::Fresh | Refresh::Unchanged => {}
    }
}

fn instance_uses(app: &AppHandle) -> Vec<InstanceUse> {
    store(app)
        .list()
        .into_iter()
        .map(|view| InstanceUse {
            provider_type: view.provider_type,
            kind: view.kind,
            enabled: view.enabled,
        })
        .collect()
}

/// The catalog in use: the bundled one, or the remote file laid over it.
pub(crate) fn active_catalog() -> Catalog {
    ACTIVE_CATALOG
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .unwrap_or_else(Catalog::bundled)
}

fn set_active_catalog(catalog: Catalog) {
    *ACTIVE_CATALOG
        .write()
        .unwrap_or_else(PoisonError::into_inner) = Some(catalog);
}

fn refresh_one(app: &AppHandle, providers: &mut Store, id: &str) -> Option<()> {
    let listed = with_lister(|lister| lister.list(&*providers, id, true, now_ms())).ok()?;
    let ids: Vec<String> = listed.into_iter().map(|model| model.id).collect();
    let stored = providers.get(id)?;
    let conn = providers.connection_for(id)?;
    let plan = plan_pins(
        conn.entry.as_ref(),
        &ids,
        &stored.pinned_models,
        stored.seen_models.as_deref(),
    );
    let seen_changed = stored
        .seen_models
        .as_ref()
        .is_none_or(|seen| seen.len() != plan.seen_models.len());
    if !plan.added.is_empty() {
        let patch = Patch {
            pinned_models: Some(plan.pinned_models.clone()),
            seen_models: Some(plan.seen_models.clone()),
            ..Patch::default()
        };
        let _ = providers.update(id, patch);
    } else if seen_changed {
        let patch = Patch {
            seen_models: Some(plan.seen_models.clone()),
            ..Patch::default()
        };
        let _ = providers.update(id, patch);
    }
    let joined = ids.join("\n");
    let before = last_ids()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned(), joined.clone());
    if !plan.added.is_empty() || before.is_some_and(|before| before != joined) {
        diag(app).info(
            "providers.autorefresh",
            "models changed",
            Some(json!({ "added": plan.added.len(), "listed": ids.len() })),
        );
        emit(
            app,
            MODELS_CHANGED,
            json!({ "id": id, "added": plan.added }),
        );
    }
    Some(())
}

fn catalog_view(entries: &[CatalogEntry], keystore: bool) -> Value {
    Value::Array(
        entries
            .iter()
            .map(|entry| {
                let keyless = entry.auth == "none" || entry.key_optional.unwrap_or(false);
                json!({
                    "id": entry.id,
                    "name": entry.name,
                    "kind": entry.kind,
                    "protocol": entry.protocol,
                    "vendor": entry.vendor,
                    "keyUrl": entry.key_url,
                    "needsKey": !keyless,
                    // Without a keystore a key could only be kept in the clear, so such a provider cannot be switched on.
                    "available": keyless || keystore,
                    "baseUrl": non_empty(&entry.base_url),
                    "editableBaseUrl": entry.kind == "local" || entry.id == "custom",
                    "remote": entry.remote.unwrap_or(false),
                    "download": Value::Null,
                })
            })
            .collect(),
    )
}

fn non_empty(text: &str) -> Value {
    if text.is_empty() {
        Value::Null
    } else {
        json!(text)
    }
}

/// A success carries the registry's view; a refusal carries the reference's message as the user reads it.
fn outcome<T>(
    app: &AppHandle,
    result: Result<T, RegistryError>,
    wrap: impl FnOnce(T) -> Value,
) -> Value {
    match result {
        Ok(value) => {
            let mut body = wrap(value);
            body["success"] = json!(true);
            body
        }
        Err(error) => {
            log_failure(app, "provider-unknown-error");
            json!({ "success": false, "error": { "kind": "provider-unknown-error", "message": error.0 } })
        }
    }
}

fn failed(app: &AppHandle, error: &ListError) -> Value {
    match error {
        ListError::Failure(failure) => {
            let kind = serde_json::to_value(failure.kind).ok();
            let kind = kind
                .as_ref()
                .and_then(Value::as_str)
                .unwrap_or("provider-unknown-error");
            log_failure(app, kind);
            json!({ "success": false, "error": failure })
        }
        ListError::Other(message) => {
            log_failure(app, "provider-unknown-error");
            json!({ "success": false, "error": { "kind": "provider-unknown-error", "message": message } })
        }
    }
}

fn log_failure(app: &AppHandle, kind: &str) {
    diag(app).warn(
        "providers.ipc",
        "provider call failed",
        Some(json!({ "kind": kind })),
    );
}

fn with_lister<T>(work: impl FnOnce(&mut Lister) -> T) -> T {
    let lister = LISTER.get_or_init(|| {
        Mutex::new(
            ModelLister::new(AppHttp)
                .with_account("claude", Box::new(account::Claude))
                .with_account("codex", Box::new(account::Codex)),
        )
    });
    let mut guard = lister.lock().unwrap_or_else(PoisonError::into_inner);
    work(&mut guard)
}

fn forget(id: &str) {
    with_lister(|lister| lister.forget(Some(id)));
}

fn last_ids() -> &'static Mutex<HashMap<String, String>> {
    LAST_IDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store(app: &AppHandle) -> Store {
    Providers::new(kv(app), AppKeys { app: app.clone() }, active_catalog())
}

fn kv(app: &AppHandle) -> AppKv {
    let state = app.state::<AppState>();
    AppKv {
        storage: state.storage.handle(),
        diag: Some(Arc::clone(&state.diag)),
    }
}

/// The port the api server is set to, or its default. Scans skip it, as they skip the engine's.
fn api_port(app: &AppHandle) -> u16 {
    let raw = app
        .state::<AppState>()
        .storage
        .handle()
        .and_then(|storage| storage.get_value(API_CONFIG_KEY).ok().flatten());
    api_port_from(raw.as_deref())
}

fn api_port_from(raw: Option<&str>) -> u16 {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| value.get("port").and_then(Value::as_u64))
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| (1024..=65535).contains(port))
        .unwrap_or(API_DEFAULT_PORT)
}

fn keystore_open(app: &AppHandle) -> bool {
    AppKeys { app: app.clone() }.available()
}

fn diag(app: &AppHandle) -> Arc<Diagnostics> {
    Arc::clone(&app.state::<AppState>().diag)
}

fn arg(args: &[Value], index: usize) -> Value {
    args.get(index).cloned().unwrap_or(Value::Null)
}

fn text(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, auth: &str, key_optional: Option<bool>) -> CatalogEntry {
        CatalogEntry {
            id: id.to_owned(),
            name: id.to_owned(),
            kind: "cloud".to_owned(),
            protocol: "openai".to_owned(),
            vendor: None,
            base_url: String::new(),
            key_url: None,
            auth: auth.to_owned(),
            sign_in_hosts: None,
            capability_patterns: None,
            noise_patterns: None,
            default_models: Vec::new(),
            quirks: None,
            discovery: None,
            key_optional,
            remote: None,
        }
    }

    #[test]
    fn catalog_needs_a_key_unless_keyless_and_needs_a_keystore_for_keys() {
        let entries = [
            entry("a", "key", None),
            entry("b", "none", None),
            entry("c", "key", Some(true)),
        ];
        let without = catalog_view(&entries, false);
        assert_eq!(without[0]["needsKey"], json!(true));
        assert_eq!(without[0]["available"], json!(false));
        assert_eq!(without[1]["available"], json!(true));
        assert_eq!(without[2]["needsKey"], json!(false));
        assert_eq!(without[2]["available"], json!(true));
        assert_eq!(catalog_view(&entries, true)[0]["available"], json!(true));
        assert_eq!(without[0]["baseUrl"], Value::Null);
    }

    #[test]
    fn list_failure_keeps_the_provider_kind() {
        let failure = draggy_providers::types::ProviderError {
            kind: draggy_providers::types::ErrorKind::InvalidKey,
            status: Some(401),
            message: Some("bad key".to_owned()),
            provider_message: None,
            retry_after: None,
        };
        let kind = serde_json::to_value(failure.kind).expect("kind");
        assert_eq!(kind, json!("provider-invalid-key"));
    }

    #[test]
    fn a_focus_refresh_waits_out_the_gap() {
        let now = Instant::now();
        assert!(focus_due(None, now));
        assert!(!focus_due(Some(now), now + Duration::from_secs(59)));
        assert!(focus_due(Some(now), now + FOCUS_GAP));
    }

    #[test]
    fn arguments_default_when_missing() {
        assert_eq!(text(&[], 0), "");
        assert_eq!(text(&[json!(3)], 0), "");
        assert_eq!(text(&[json!("id")], 0), "id");
        assert_eq!(arg(&[], 2), Value::Null);
    }

    #[test]
    fn api_port_comes_from_settings_or_the_default() {
        assert_eq!(api_port_from(None), 11500);
        assert_eq!(
            api_port_from(Some(r#"{"enabled":true,"port":12000}"#)),
            12000
        );
        assert_eq!(api_port_from(Some(r#"{"port":80}"#)), 11500);
        assert_eq!(api_port_from(Some(r#"{"port":70000}"#)), 11500);
        assert_eq!(api_port_from(Some("junk")), 11500);
    }
}
