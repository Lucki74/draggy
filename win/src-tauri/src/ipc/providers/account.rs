//! The account channels: sign-in, cancel, the code hand-off, sign-out and status for a signed-in Claude subscription.
//! Port of providers/ipc.cjs and the sign-in path of adapters/claude.cjs. Claude Code keeps its credentials in the
//! instance's private home, so Draggy never holds a token and writes none to disk.

mod codex;
mod install;
mod session;

pub use self::codex::Codex;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::ErrorKind;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use draggy_providers::account::env::{account_env, private_home};
use draggy_providers::account::supervisor::RuntimeUnavailable;
use draggy_providers::adapters::common::ListedModel;
use draggy_providers::catalog::CatalogEntry;
use draggy_providers::claude::adapter::listed_models;
use draggy_providers::claude::binary::{
    ASSETS, asset_for, ensure, installed_binary, previous_binary,
};
use draggy_providers::claude::process::{FLAGS, QUIET, initialize_params, work_folder};
use draggy_providers::install_fs::{Progress, SingleFlight};
use draggy_providers::models::{AccountRuntime, ListError};
use serde_json::{Value, json};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

use self::install::{Disk, Net};
use self::session::Session;
use super::{diag, forget, log_failure, store, text};
use crate::ipc::{IpcError, emit};

const CLAUDE: &str = "claude";
const CODEX: &str = "codex";
const PROGRESS: &str = "providers:account-progress";
const UNKNOWN: &str = "provider-unknown-error";
const ACCOUNT_UNAVAILABLE: &str = "account-runtime-unavailable";
/// How long a status read or a listing may take before it is given up on.
const UTILITY_MS: u64 = 60_000;

/// Logins in progress, by instance. A cancel fires the sender, which ends the login and kills its process.
static LOGINS: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
/// One install for the run, so a listing and a sign-in never empty each other's staging folder.
static INSTALL: OnceLock<SingleFlight<Result<Option<String>, RuntimeUnavailable>>> =
    OnceLock::new();

/// The Claude runtime the model lister asks for an account's models. Each listing starts the runtime and asks it.
pub struct Claude;

impl AccountRuntime for Claude {
    fn models(&self, instance_id: &str) -> Result<Vec<ListedModel>, ListError> {
        let root = app_data_root().map_err(ListError::Other)?;
        tauri::async_runtime::block_on(list_models(&root, instance_id)).map_err(ListError::Other)
    }
}

enum SignInError {
    /// A refusal the page shows as an error, as the reference throws it.
    Refused(String),
    /// A login that ended on the way; the page shows it inside the status.
    Login(String),
    Cancelled,
}

pub(super) async fn sign_in(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let entry = match account_of(&app, &id) {
        Ok(entry) => entry,
        Err(refusal) => return Ok(refusal),
    };
    let hosts = entry.sign_in_hosts.clone().unwrap_or_default();
    let outcome = if entry.protocol == CODEX {
        codex::sign_in(&app, &id, &hosts).await
    } else {
        run_sign_in(&app, &id, &hosts).await
    };
    Ok(match outcome {
        Ok(status) => {
            forget(&id);
            json!({ "success": true, "status": status })
        }
        Err(SignInError::Refused(message)) => refused(&app, &message),
        Err(SignInError::Login(message)) => json!({
            "success": true,
            "status": { "signedIn": false, "cancelled": false, "error": message },
        }),
        Err(SignInError::Cancelled) => json!({
            "success": true,
            "status": { "signedIn": false, "cancelled": true, "error": null },
        }),
    })
}

pub(super) async fn cancel(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    if let Err(refusal) = account_of(&app, &id) {
        return Ok(refusal);
    }
    cancel_login(&id);
    Ok(json!({ "success": true }))
}

/// Accepted never: Claude Code asks for no code in this flow, so the page's code goes nowhere and is not kept.
pub(super) async fn submit_code(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    if let Err(refusal) = account_of(&app, &id) {
        return Ok(refusal);
    }
    Ok(json!({ "success": true, "accepted": false }))
}

pub(super) async fn sign_out(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let entry = match account_of(&app, &id) {
        Ok(entry) => entry,
        Err(refusal) => return Ok(refusal),
    };
    cancel_login(&id);
    let root = match app_data_root() {
        Ok(root) => root,
        Err(message) => return Ok(refused(&app, &message)),
    };
    if entry.protocol == CODEX {
        return Ok(match codex::sign_out(&root, &id).await {
            Ok(()) => {
                forget(&id);
                json!({ "success": true })
            }
            Err(message) => refused(&app, &message),
        });
    }
    if let (Some(binary), Ok(setup)) = (installed_binary(&root, &Disk), Setup::new(&root, &id)) {
        let run = draggy_tools::spawn::exec_hidden(&binary, &["auth", "logout"], |command| {
            command.current_dir(&setup.cwd).env_clear().envs(&setup.env);
        });
        let _ = tokio::time::timeout(Duration::from_millis(UTILITY_MS), run).await;
    }
    if let Ok(home) = private_home(&root, CLAUDE, &id) {
        match fs::remove_dir_all(&home) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => return Ok(refused(&app, "The account folder could not be removed.")),
        }
    }
    forget(&id);
    Ok(json!({ "success": true }))
}

pub(super) async fn status(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text(&args, 0);
    let entry = match account_of(&app, &id) {
        Ok(entry) => entry,
        Err(refusal) => return Ok(refusal),
    };
    let root = match app_data_root() {
        Ok(root) => root,
        Err(message) => return Ok(refused(&app, &message)),
    };
    if entry.protocol == CODEX {
        let run = codex::status(&root, &id);
        return Ok(
            match tokio::time::timeout(Duration::from_millis(UTILITY_MS), run).await {
                Ok(Ok(status)) => json!({ "success": true, "status": status }),
                Ok(Err(message)) => refused(&app, &message),
                Err(_) => refused(&app, "Codex did not answer in time."),
            },
        );
    }
    let auth = match installed_or_previous(&root) {
        Some(binary) => match Setup::new(&root, &id) {
            Ok(setup) => auth_status(&binary, &setup).await,
            Err(message) => return Ok(refused(&app, &message)),
        },
        None => json!({ "loggedIn": false }),
    };
    Ok(json!({ "success": true, "status": status_of(&auth) }))
}

/// Fills the download an account's first sign-in fetches, in bytes; null once the runtime is on disk.
pub(super) fn fill_downloads(view: &mut Value, entries: &[CatalogEntry]) {
    let Some(items) = view.as_array_mut() else {
        return;
    };
    for item in items {
        if item.get("kind").and_then(Value::as_str) != Some("account") {
            continue;
        }
        let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
        let protocol = entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.protocol.as_str())
            .unwrap_or_default();
        item["download"] = download_for(protocol);
    }
}

fn download_for(protocol: &str) -> Value {
    let Ok(root) = app_data_root() else {
        return Value::Null;
    };
    if protocol == CODEX {
        return codex::download(&root);
    }
    if protocol != CLAUDE {
        return Value::Null;
    }
    if installed_binary(&root, &Disk).is_some() {
        return Value::Null;
    }
    asset_for("win32", node_arch(), false)
        .map(|asset| json!(asset.size))
        .unwrap_or(Value::Null)
}

/// The account of a Claude instance, or the refusal the reference gives for anything else.
fn account_of(app: &AppHandle, id: &str) -> Result<CatalogEntry, Value> {
    let entry = store(app)
        .connection_for(id)
        .and_then(|connection| connection.entry);
    match entry {
        Some(entry)
            if entry.kind == "account" && (entry.protocol == CLAUDE || entry.protocol == CODEX) =>
        {
            Ok(entry)
        }
        _ => Err(refused_as(
            ACCOUNT_UNAVAILABLE,
            &format!("{id} is not an account."),
            app,
        )),
    }
}

async fn run_sign_in(app: &AppHandle, id: &str, hosts: &[String]) -> Result<Value, SignInError> {
    let root = app_data_root().map_err(SignInError::Refused)?;
    let binary = install(app, id, &root)
        .await
        .map_err(SignInError::Refused)?;
    let setup = Setup::new(&root, id).map_err(SignInError::Refused)?;
    if !signed_in(&auth_status(&binary, &setup).await) {
        login(app, id, &binary, &setup, hosts).await?;
    }
    emit(app, PROGRESS, json!({ "id": id, "step": "done" }));
    Ok(status_of(&auth_status(&binary, &setup).await))
}

/// Installs the runtime when it is missing, reporting its progress; an install that is running is shared.
async fn install(app: &AppHandle, id: &str, root: &str) -> Result<String, String> {
    let root = root.to_owned();
    let owner = id.to_owned();
    let progress_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut net = Net;
        let mut disk = Disk;
        let mut report = |progress: Progress| {
            emit(
                &progress_app,
                PROGRESS,
                json!({ "id": owner, "step": "installing", "percent": progress.percent }),
            );
        };
        ensure(
            INSTALL.get_or_init(SingleFlight::default),
            &ASSETS,
            &root,
            "win32",
            node_arch(),
            false,
            &mut net,
            &mut disk,
            &mut report,
        )
    })
    .await
    .map_err(|_| UNKNOWN.to_owned())?;
    match result {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("Claude Code is not installed.".to_owned()),
        Err(RuntimeUnavailable(message)) => Err(message),
    }
}

async fn login(
    app: &AppHandle,
    id: &str,
    binary: &str,
    setup: &Setup,
    hosts: &[String],
) -> Result<(), SignInError> {
    let (cancel, cancelled) = oneshot::channel();
    logins()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned(), cancel);
    diag(app).info("providers.claude", "sign-in started", None);
    let outcome = tokio::select! {
        result = run_login(app, id, binary, setup, hosts) => result,
        fired = cancelled => match fired {
            Ok(()) => Err(SignInError::Cancelled),
            // A dropped sender means another sign-in took its place; this one keeps running.
            Err(_) => std::future::pending().await,
        },
    };
    logins()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(id);
    match &outcome {
        Err(SignInError::Cancelled) => {
            diag(app).info("providers.claude", "sign-in cancelled", None)
        }
        Err(SignInError::Login(_)) => diag(app).warn("providers.claude", "sign-in failed", None),
        _ => {}
    }
    outcome
}

async fn run_login(
    app: &AppHandle,
    id: &str,
    binary: &str,
    setup: &Setup,
    hosts: &[String],
) -> Result<(), SignInError> {
    let mut session = Session::start(binary, &setup.cwd, &setup.env, &process_args(&[]))
        .map_err(SignInError::Login)?;
    let outcome = login_steps(app, id, &mut session, hosts).await;
    session.stop().await;
    outcome
}

/// Claude Code's own OAuth on Anthropic's page, ending at its own callback, so Draggy never sees a token.
async fn login_steps(
    app: &AppHandle,
    id: &str,
    session: &mut Session,
    hosts: &[String],
) -> Result<(), SignInError> {
    session
        .request("initialize", initialize_params())
        .await
        .map_err(SignInError::Login)?;
    let auth = session
        .request("claude_authenticate", json!({ "loginWithClaudeAi": true }))
        .await
        .map_err(SignInError::Login)?;
    let url = auth
        .get("automaticUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| SignInError::Login("Claude Code gave no sign-in page.".to_owned()))?;
    emit(
        app,
        PROGRESS,
        json!({ "id": id, "step": "browser", "url": url }),
    );
    open_sign_in(app, hosts, url)?;
    diag(app).info("providers.claude", "sign-in page opened", None);
    session
        .request("claude_oauth_wait_for_completion", json!({}))
        .await
        .map_err(SignInError::Login)?;
    diag(app).info("providers.claude", "sign-in completed", None);
    Ok(())
}

/// Opens the sign-in page only over https on the vendor's own host, whatever the runtime asked for.
fn open_sign_in(app: &AppHandle, hosts: &[String], url: &str) -> Result<(), SignInError> {
    let allowed = https_host(url).is_some_and(|host| hosts.contains(&host));
    if !allowed {
        return Err(SignInError::Refused(
            "Refused to open the sign-in page.".to_owned(),
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| SignInError::Login("Could not open the browser.".to_owned()))
}

/// The lowercase host of an https address, or None for anything else (credentials included).
fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None;
    }
    let host = authority.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

fn cancel_login(id: &str) {
    let sender = logins()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(id);
    if let Some(sender) = sender {
        let _ = sender.send(());
    }
}

fn logins() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    LOGINS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// What a Claude process runs with: its folder and its environment.
struct Setup {
    cwd: String,
    env: BTreeMap<String, String>,
}

impl Setup {
    /// Makes the folders a process needs and returns its environment: the inherited allowlist plus the runtime's
    /// quiet settings, with the account's home in every variable that points a tool at one folder.
    fn new(root: &str, id: &str) -> Result<Self, String> {
        let parent: Vec<(String, String)> = std::env::vars().collect();
        let quiet: Vec<(String, String)> = QUIET
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        let account = account_env(CLAUDE, root, id, &parent, &quiet)
            .map_err(|_| "The account folder is not valid.".to_owned())?;
        let cwd = work_folder(id, "win32", std::env::var("ProgramData").ok().as_deref(), 0);
        fs::create_dir_all(&account.home)
            .map_err(|_| "The account folder could not be made.".to_owned())?;
        fs::create_dir_all(&cwd).map_err(|_| "The work folder could not be made.".to_owned())?;
        Ok(Self {
            cwd,
            env: account.env,
        })
    }
}

/// The arguments of a utility process: the runtime's flags, then any extras.
fn process_args(extra: &[&str]) -> Vec<String> {
    FLAGS
        .iter()
        .copied()
        .chain(extra.iter().copied())
        .map(str::to_owned)
        .collect()
}

fn installed_or_previous(root: &str) -> Option<String> {
    installed_binary(root, &Disk).or_else(|| previous_binary(root, &Disk))
}

/// Asks the runtime who is signed in. Anything unreadable counts as signed out, as the reference does.
async fn auth_status(binary: &str, setup: &Setup) -> Value {
    let run = draggy_tools::spawn::exec_hidden(binary, &["auth", "status", "--json"], |command| {
        command.current_dir(&setup.cwd).env_clear().envs(&setup.env);
    });
    match tokio::time::timeout(Duration::from_millis(UTILITY_MS), run).await {
        Ok(Ok(output)) => parse_auth(&String::from_utf8_lossy(&output.stdout)),
        _ => json!({ "loggedIn": false }),
    }
}

/// The status the page shows: signed out with nothing else, or signed in with the email and plan the runtime reports.
fn status_of(auth: &Value) -> Value {
    if !signed_in(auth) {
        return json!({ "signedIn": false });
    }
    let mut status = json!({ "signedIn": true });
    if let Some(email) = non_empty(auth, "email") {
        status["email"] = json!(email);
    }
    if let Some(plan) = non_empty(auth, "subscriptionType") {
        status["plan"] = json!(plan);
    }
    status
}

fn signed_in(auth: &Value) -> bool {
    auth.get("loggedIn")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn non_empty(auth: &Value, key: &str) -> Option<String> {
    auth.get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// The JSON the runtime prints for `auth status --json`; anything else reads as signed out.
fn parse_auth(text: &str) -> Value {
    serde_json::from_str::<Value>(text)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "loggedIn": false }))
}

/// The models the runtime's initialize lists, without entries that carry no value.
async fn list_models(root: &str, id: &str) -> Result<Vec<ListedModel>, String> {
    let Some(binary) = installed_or_previous(root) else {
        return Ok(Vec::new());
    };
    let setup = Setup::new(root, id)?;
    let mut session = Session::start(
        &binary,
        &setup.cwd,
        &setup.env,
        &process_args(&["--no-session-persistence"]),
    )?;
    let answer = tokio::time::timeout(
        Duration::from_millis(UTILITY_MS),
        session.request("initialize", initialize_params()),
    )
    .await;
    session.stop().await;
    let init = match answer {
        Ok(result) => result?,
        Err(_) => return Err("Claude Code did not answer in time.".to_owned()),
    };
    let listed: Vec<Value> = init
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter(|model| {
                    model
                        .get("value")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(listed_models(&listed)
        .iter()
        .filter_map(to_listed)
        .collect())
}

/// One listed model in the lister's shape. Claude models are served from the cloud.
fn to_listed(value: &Value) -> Option<ListedModel> {
    let modalities = value
        .get("inputModalities")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        });
    Some(ListedModel {
        id: value.get("id")?.as_str()?.to_owned(),
        name: value.get("name").and_then(Value::as_str).map(str::to_owned),
        resolved: value
            .get("resolved")
            .and_then(Value::as_str)
            .map(str::to_owned),
        context_length: None,
        supported: None,
        input_modalities: modalities,
        capabilities: None,
        cloud: true,
    })
}

fn app_data_root() -> Result<String, String> {
    crate::paths::data_dir(std::env::var_os("APPDATA"))
        .map(|dir| dir.to_string_lossy().into_owned())
}

fn node_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        _ => "x64",
    }
}

fn refused(app: &AppHandle, message: &str) -> Value {
    log_failure(app, UNKNOWN);
    json!({ "success": false, "error": { "kind": UNKNOWN, "message": message } })
}

fn refused_as(kind: &str, message: &str, app: &AppHandle) -> Value {
    log_failure(app, kind);
    json!({ "success": false, "error": { "kind": kind, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_hides_everything_but_the_email_and_plan() {
        let signed_out = status_of(&json!({ "loggedIn": false, "email": "a@b.c" }));
        assert_eq!(signed_out, json!({ "signedIn": false }));

        let signed_in = status_of(&json!({
            "loggedIn": true,
            "email": "a@b.c",
            "subscriptionType": "max",
            "accessToken": "secret",
        }));
        assert_eq!(
            signed_in,
            json!({ "signedIn": true, "email": "a@b.c", "plan": "max" })
        );
    }

    #[test]
    fn unreadable_auth_is_signed_out() {
        assert_eq!(parse_auth("not json"), json!({ "loggedIn": false }));
        assert_eq!(parse_auth("7"), json!({ "loggedIn": false }));
        assert_eq!(
            parse_auth("{\"loggedIn\":true}"),
            json!({ "loggedIn": true })
        );
    }

    #[test]
    fn sign_in_pages_must_be_https_on_their_own_host() {
        assert_eq!(
            https_host("https://claude.ai/oauth?x=1").as_deref(),
            Some("claude.ai")
        );
        assert_eq!(
            https_host("https://Claude.AI:443/x").as_deref(),
            Some("claude.ai")
        );
        assert_eq!(https_host("http://claude.ai/x"), None);
        assert_eq!(https_host("https://claude.ai@evil.example/x"), None);
        assert_eq!(https_host("https:///x"), None);
    }

    #[test]
    fn listed_models_keep_the_fields_the_lister_reads() {
        let model = to_listed(&json!({
            "id": "opus",
            "name": "Opus 5.5",
            "resolved": "claude-opus-5-5",
            "inputModalities": ["text", "image"],
        }))
        .expect("listed");
        assert_eq!(model.id, "opus");
        assert_eq!(model.resolved.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(model.input_modalities.map(|m| m.len()), Some(2));
        assert!(model.cloud);
        assert!(to_listed(&json!({ "name": "no id" })).is_none());
    }

    #[test]
    fn process_arguments_end_with_the_extras() {
        let args = process_args(&["--no-session-persistence"]);
        assert_eq!(args.first().map(String::as_str), Some(FLAGS[0]));
        assert_eq!(
            args.last().map(String::as_str),
            Some("--no-session-persistence")
        );
    }
}
