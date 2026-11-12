//! The Codex account: sign-in, status, sign-out and the model listing, over its app-server's stdio RPC. Port of
//! adapters/codex.cjs and codex/process.cjs. Codex keeps its tokens in the private home, so Draggy holds none.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;
use std::process::Stdio;
use std::sync::{OnceLock, PoisonError};
use std::time::Duration;

use draggy_providers::account::env::account_env;
use draggy_providers::account::supervisor::RuntimeUnavailable;
use draggy_providers::adapters::common::ListedModel;
use draggy_providers::codex::binary::{Unpack, VERSION, asset_for, ensure, installed_binary};
use draggy_providers::codex::process::{
    ARGS, CATALOG_NAME, INITIALIZED, config_toml, context_windows, initialize_params,
};
use draggy_providers::install_fs::{InstallFs, Progress, SingleFlight};
use draggy_providers::models::{AccountRuntime, ListError};
use draggy_providers::rpc::{Event, Rpc, RpcOptions};
use serde_json::{Value, json};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::oneshot;

use super::super::diag;
use super::install::{Disk, Net};
use super::{PROGRESS, SignInError, UNKNOWN, UTILITY_MS, app_data_root, node_arch, open_sign_in};
use crate::ipc::emit;

const CODEX: &str = "codex";
/// The catalog the reference ships, read at build time so a listing needs no file beside the app.
const MODELS: &str = include_str!("../../../../../electron/providers/codex/models.json");
const STOPPED: &str = "Codex stopped.";
const START_FAILED: &str = "Codex did not start.";
const LOGIN_DONE: &str = "account/login/completed";
const SIGN_IN_FAILED: &str = "Sign-in did not finish.";
const UNPACK_FAILED: &str = "The download could not be unpacked.";
/// A listing reads at most this many pages, so a cursor that never ends cannot hold the runtime.
const MAX_PAGES: usize = 50;

static CODEX_INSTALL: OnceLock<SingleFlight<Result<String, RuntimeUnavailable>>> = OnceLock::new();

/// The Codex runtime the model lister asks for an account's models.
pub struct Codex;

impl AccountRuntime for Codex {
    fn models(&self, instance_id: &str) -> Result<Vec<ListedModel>, ListError> {
        let root = app_data_root().map_err(ListError::Other)?;
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                Duration::from_millis(UTILITY_MS),
                list_models(&root, instance_id),
            )
            .await
            .unwrap_or_else(|_| Err("Codex did not answer in time.".to_owned()))
        })
        .map_err(ListError::Other)
    }
}

/// Codex's browser sign-in: the install, then OpenAI's page and Codex's own callback. A signed-in account skips the page.
pub(super) async fn sign_in(
    app: &AppHandle,
    id: &str,
    hosts: &[String],
) -> Result<Value, SignInError> {
    let root = app_data_root().map_err(SignInError::Refused)?;
    let binary = install(app, id, &root)
        .await
        .map_err(SignInError::Refused)?;
    let (home, env) = setup(&root, id).map_err(SignInError::Refused)?;
    let mut client = Client::start(&binary, &home, &env)
        .await
        .map_err(SignInError::Login)?;
    let read = client
        .request("account/read", json!({}))
        .await
        .map_err(SignInError::Login)?;
    if account_of_read(&read).is_none() {
        login(app, id, &mut client, hosts).await?;
    }
    emit(app, PROGRESS, json!({ "id": id, "step": "done" }));
    read_status(&mut client).await.map_err(SignInError::Login)
}

/// The status a page shows; never installs, since opening a page is no reason to fetch the runtime.
pub(super) async fn status(root: &str, id: &str) -> Result<Value, String> {
    let Some(binary) = installed_binary(root, &Disk) else {
        return Ok(json!({ "signedIn": false }));
    };
    let (home, env) = setup(root, id)?;
    let mut client = Client::start(&binary, &home, &env).await?;
    read_status(&mut client).await
}

/// Signs the Codex account out when the runtime is on disk; nothing to do otherwise.
pub(super) async fn sign_out(root: &str, id: &str) -> Result<(), String> {
    let Some(binary) = installed_binary(root, &Disk) else {
        return Ok(());
    };
    let (home, env) = setup(root, id)?;
    let mut client = Client::start(&binary, &home, &env).await?;
    client
        .request("account/logout", json!({}))
        .await
        .map(|_| ())
}

/// The model listing of a signed-in or signed-out account: every page the runtime offers, minus hidden ones.
pub(super) async fn list_models(root: &str, id: &str) -> Result<Vec<ListedModel>, String> {
    let Some(binary) = installed_binary(root, &Disk) else {
        return Ok(Vec::new());
    };
    let (home, env) = setup(root, id)?;
    let mut client = Client::start(&binary, &home, &env).await?;
    let catalog = serde_json::from_str::<Value>(MODELS).unwrap_or(Value::Null);
    let windows = context_windows(&catalog);
    let mut listed = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let params = match &cursor {
            Some(next) => json!({ "cursor": next }),
            None => json!({}),
        };
        let page = client.request("model/list", params).await?;
        if let Some(items) = page.get("data").and_then(Value::as_array) {
            listed.extend(items.iter().cloned());
        }
        cursor = text_field(&page, "nextCursor");
        if cursor.is_none() {
            break;
        }
    }
    Ok(to_listed(&listed, &windows))
}

/// The archive size the first sign-in fetches, or null once the runtime is on disk.
pub(super) fn download(root: &str) -> Value {
    if installed_binary(root, &Disk).is_some() {
        return Value::Null;
    }
    asset_for("win32", node_arch())
        .map(|asset| json!(asset.size))
        .unwrap_or(Value::Null)
}

pub(super) async fn install(app: &AppHandle, id: &str, root: &str) -> Result<String, String> {
    let root = root.to_owned();
    let owner = id.to_owned();
    let progress_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut net = Net;
        let mut disk = Disk;
        let mut unpack = Zip;
        let mut report = |progress: Progress| {
            emit(
                &progress_app,
                PROGRESS,
                json!({ "id": owner, "step": "installing", "percent": progress.percent }),
            );
        };
        ensure(
            CODEX_INSTALL.get_or_init(SingleFlight::default),
            &root,
            "win32",
            node_arch(),
            &mut net,
            &mut unpack,
            &mut disk,
            &mut report,
        )
    })
    .await
    .map_err(|_| UNKNOWN.to_owned())?;
    result.map_err(|RuntimeUnavailable(message)| message)
}

async fn login(
    app: &AppHandle,
    id: &str,
    client: &mut Client,
    hosts: &[String],
) -> Result<(), SignInError> {
    let (cancel, cancelled) = oneshot::channel();
    super::logins()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned(), cancel);
    let outcome = run_login(app, id, client, hosts, cancelled).await;
    super::logins()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(id);
    outcome
}

async fn run_login(
    app: &AppHandle,
    id: &str,
    client: &mut Client,
    hosts: &[String],
    cancelled: oneshot::Receiver<()>,
) -> Result<(), SignInError> {
    diag(app).info("providers.codex", "sign-in started", None);
    let started = client
        .request("account/login/start", json!({ "type": "chatgpt" }))
        .await
        .map_err(SignInError::Login)?;
    let (login_id, auth_url) = match (
        text_field(&started, "loginId"),
        text_field(&started, "authUrl"),
    ) {
        (Some(login_id), Some(url)) => (login_id, url),
        _ => return Err(SignInError::Login("Codex gave no sign-in page.".to_owned())),
    };
    emit(
        app,
        PROGRESS,
        json!({ "id": id, "step": "browser", "url": auth_url }),
    );
    if let Err(refusal) = open_sign_in(app, hosts, &auth_url) {
        cancel_remote(client, &login_id).await;
        return Err(refusal);
    }
    let finished = tokio::select! {
        result = client.await_login(&login_id) => Some(result),
        fired = cancelled => match fired {
            Ok(()) => None,
            // A dropped sender means another sign-in took its place; this one keeps running.
            Err(_) => std::future::pending().await,
        },
    };
    let Some(result) = finished else {
        cancel_remote(client, &login_id).await;
        diag(app).info("providers.codex", "sign-in cancelled", None);
        return Err(SignInError::Cancelled);
    };
    let done = result.map_err(SignInError::Login)?;
    if done.get("success").and_then(Value::as_bool) == Some(true) {
        diag(app).info("providers.codex", "sign-in completed", None);
        return Ok(());
    }
    diag(app).warn("providers.codex", "sign-in attempt ended", None);
    if done.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return Err(SignInError::Cancelled);
    }
    let message = done
        .get("error")
        .and_then(|error| error.as_str().or_else(|| error.get("message")?.as_str()))
        .unwrap_or(SIGN_IN_FAILED);
    Err(SignInError::Login(message.to_owned()))
}

async fn cancel_remote(client: &mut Client, login_id: &str) {
    let answer = client.request("account/login/cancel", json!({ "loginId": login_id }));
    let _ = tokio::time::timeout(Duration::from_millis(UTILITY_MS), answer).await;
}

/// The status Codex reports: signed out with nothing else, or signed in with the email, plan and rate windows.
async fn read_status(client: &mut Client) -> Result<Value, String> {
    let read = client.request("account/read", json!({})).await?;
    let Some(account) = account_of_read(&read) else {
        return Ok(json!({ "signedIn": false }));
    };
    let limits = client
        .request("account/rateLimits/read", json!({}))
        .await
        .ok();
    Ok(status_of(account, limits.as_ref()))
}

fn account_of_read(read: &Value) -> Option<&Value> {
    read.get("account").filter(|account| !account.is_null())
}

fn status_of(account: &Value, limits: Option<&Value>) -> Value {
    let mut status = json!({ "signedIn": true });
    if let Some(email) = text_field(account, "email") {
        status["email"] = json!(email);
    }
    if let Some(plan) = text_field(account, "planType") {
        status["plan"] = json!(plan);
    }
    let windows = limits_of(limits);
    if !windows.is_empty() {
        status["limits"] = json!(windows);
    }
    status
}

/// The primary and secondary rate windows, in the shape the page reads; a read that failed has none.
fn limits_of(limits: Option<&Value>) -> Vec<Value> {
    let Some(rate) = limits.and_then(|read| read.get("rateLimits")) else {
        return Vec::new();
    };
    ["primary", "secondary"]
        .iter()
        .filter_map(|key| rate.get(*key).filter(|window| window.is_object()))
        .map(|window| {
            json!({
                "window": window.get("windowDurationMins").cloned().unwrap_or(Value::Null),
                "usedPercent": window.get("usedPercent").cloned().unwrap_or(Value::Null),
                "resetsAt": window.get("resetsAt").cloned().unwrap_or(Value::Null),
            })
        })
        .collect()
}

/// The listed models in the lister's shape: hidden ones dropped, context taken from the catalog by model id.
fn to_listed(models: &[Value], windows: &BTreeMap<String, u64>) -> Vec<ListedModel> {
    models
        .iter()
        .filter(|model| model.get("hidden").and_then(Value::as_bool) != Some(true))
        .filter_map(|model| {
            let id = text_field(model, "id")?;
            let key = text_field(model, "model").unwrap_or_else(|| id.clone());
            let modalities = model
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
                id,
                name: text_field(model, "displayName"),
                resolved: None,
                context_length: windows.get(&key).copied(),
                supported: None,
                input_modalities: modalities,
                capabilities: None,
                cloud: true,
            })
        })
        .collect()
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Makes the account's home with the catalog and config Codex reads at start, and returns its folder and environment.
pub(super) fn setup(root: &str, id: &str) -> Result<(String, BTreeMap<String, String>), String> {
    let parent: Vec<(String, String)> = std::env::vars().collect();
    let account = account_env(CODEX, root, id, &parent, &[])
        .map_err(|_| "The account folder is not valid.".to_owned())?;
    let home = Path::new(&account.home);
    fs::create_dir_all(home).map_err(|_| "The account folder could not be made.".to_owned())?;
    let catalog = home.join(CATALOG_NAME);
    fs::write(&catalog, MODELS)
        .map_err(|_| "The account folder could not be written.".to_owned())?;
    let toml = config_toml(&catalog.to_string_lossy(), &[], &[]);
    fs::write(home.join("config.toml"), toml)
        .map_err(|_| "The account folder could not be written.".to_owned())?;
    Ok((account.home, account.env))
}

/// One app-server process driven over its stdio RPC. Dropping it kills the process.
pub(super) struct Client {
    _child: Child,
    stdin: ChildStdin,
    pub(super) lines: Lines<BufReader<ChildStdout>>,
    pub(super) rpc: Rpc,
}

impl Client {
    pub(super) async fn start(
        binary: &str,
        cwd: &str,
        env: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        let mut child = draggy_tools::spawn::hidden_command(binary, &ARGS, |command| {
            command.current_dir(cwd).env_clear().envs(env);
        })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| START_FAILED.to_owned())?;
        let stdin = child.stdin.take().ok_or_else(|| START_FAILED.to_owned())?;
        let stdout = child.stdout.take().ok_or_else(|| START_FAILED.to_owned())?;
        let mut client = Self {
            _child: child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            rpc: Rpc::new(RpcOptions {
                timeout_ms: UTILITY_MS,
                ..RpcOptions::default()
            }),
        };
        client
            .request("initialize", initialize_params(VERSION))
            .await?;
        client.rpc.notify(INITIALIZED, None);
        client.flush().await?;
        Ok(client)
    }

    pub(super) async fn flush(&mut self) -> Result<(), String> {
        for line in self.rpc.take_outbox() {
            self.stdin
                .write_all(format!("{line}\n").as_bytes())
                .await
                .map_err(|_| STOPPED.to_owned())?;
        }
        self.stdin.flush().await.map_err(|_| STOPPED.to_owned())
    }

    /// The next batch of events, reading one line of output at a time until something happened.
    async fn events(&mut self) -> Result<Vec<Event>, String> {
        loop {
            let events = self.rpc.take_events();
            if !events.is_empty() {
                return Ok(events);
            }
            let line = self
                .lines
                .next_line()
                .await
                .map_err(|_| STOPPED.to_owned())?
                .ok_or_else(|| STOPPED.to_owned())?;
            self.rpc.feed(format!("{line}\n").as_bytes());
            self.flush().await?;
        }
    }

    pub(super) async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self
            .rpc
            .call(method, Some(params), None)
            .map_err(|error| error.message)?;
        self.flush().await?;
        loop {
            for event in self.events().await? {
                match event {
                    Event::Settled {
                        id: answered,
                        result,
                    } if answered == id => {
                        return result.map_err(|error| error.message);
                    }
                    Event::Closed(error) => return Err(error.message),
                    _ => {}
                }
            }
        }
    }

    /// Waits for the completion notice of one login; a notice for another login is not this one's.
    async fn await_login(&mut self, login_id: &str) -> Result<Value, String> {
        loop {
            for event in self.events().await? {
                match event {
                    Event::Notification {
                        method,
                        params: Some(params),
                    } if method == LOGIN_DONE
                        && text_field(&params, "loginId").is_none_or(|found| found == login_id) =>
                    {
                        return Ok(params);
                    }
                    Event::Closed(error) => return Err(error.message),
                    _ => {}
                }
            }
        }
    }
}

/// Unpacks the release archive into the install folder: each file in it, written through the install filesystem.
struct Zip;

impl Unpack for Zip {
    fn unpack(&mut self, archive: &str, dir: &str, fs: &mut dyn InstallFs) -> Result<(), String> {
        let bytes = fs::read(archive).map_err(|_| UNPACK_FAILED.to_owned())?;
        let mut zip =
            zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| UNPACK_FAILED.to_owned())?;
        fs.make_dir(dir);
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|_| UNPACK_FAILED.to_owned())?;
            if entry.is_dir() {
                continue;
            }
            let name = entry
                .enclosed_name()
                .ok_or_else(|| UNPACK_FAILED.to_owned())?;
            let mut data = Vec::new();
            entry
                .read_to_end(&mut data)
                .map_err(|_| UNPACK_FAILED.to_owned())?;
            let target = Path::new(dir).join(name);
            fs.write_file(&target.to_string_lossy(), &data);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_shows_the_email_plan_and_rate_windows_only() {
        let limits = json!({
            "rateLimits": {
                "primary": { "windowDurationMins": 300, "usedPercent": 12, "resetsAt": 1000 },
                "secondary": null,
            }
        });
        let status = status_of(
            &json!({ "email": "a@b.c", "planType": "plus", "accessToken": "secret" }),
            Some(&limits),
        );
        assert_eq!(
            status,
            json!({
                "signedIn": true,
                "email": "a@b.c",
                "plan": "plus",
                "limits": [{ "window": 300, "usedPercent": 12, "resetsAt": 1000 }],
            })
        );
    }

    #[test]
    fn a_failed_rate_read_leaves_no_limits() {
        let status = status_of(&json!({}), None);
        assert_eq!(status, json!({ "signedIn": true }));
        assert!(account_of_read(&json!({ "account": null })).is_none());
        assert!(account_of_read(&json!({})).is_none());
    }

    #[test]
    fn hidden_models_are_dropped_and_context_comes_from_the_model_id() {
        let windows = BTreeMap::from([("gpt-x".to_owned(), 400_000_u64)]);
        let listed = to_listed(
            &[
                json!({ "id": "gpt-x", "displayName": "GPT X", "inputModalities": ["text", "image"] }),
                json!({ "id": "old", "hidden": true }),
                json!({ "id": "alias", "model": "gpt-x", "displayName": "Alias" }),
                json!({ "displayName": "no id" }),
            ],
            &windows,
        );
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "gpt-x");
        assert_eq!(listed[0].context_length, Some(400_000));
        assert_eq!(listed[1].context_length, Some(400_000));
        assert!(listed.iter().all(|model| model.cloud));
    }
}
