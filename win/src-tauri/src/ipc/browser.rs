//! The in-app browser pane's channels: where the pane sits, which tabs it holds and the pages in them.
//! Each tab is a child webview of the main window that stays hidden until the renderer shows the pane.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{Value, json};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Url, Webview,
    WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
#[cfg(not(windows))]
use tokio::sync::broadcast;
use tokio::sync::{oneshot, watch};
use tokio::time::sleep;

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::browser::cdp::Cdp;
#[cfg(not(windows))]
use crate::browser::cdp::CdpError;
#[cfg(windows)]
use crate::browser::cdp_webview2::WebView2Cdp;
use crate::browser::dialogs::{self, DialogState};
use crate::browser::elements;
use crate::browser::observe::{self, Fail, Observer};
use crate::browser::pages;
use crate::browser::pane::{self, Bounds, MAX_TABS, Tabs};
use crate::browser::policy;
use crate::browser::safety::{Grants, RateLimit, Standing};
use crate::browser::trace::Trace;
use crate::browser::{act, safety};

const PANE_LABEL: &str = "browser-pane-";
const MAIN_WINDOW: &str = "main";
const BLANK: &str = "about:blank";
/// How long a request waits for the renderer to open the pane before it gives up.
const OPEN_WAIT: Duration = Duration::from_secs(4);
const OPEN_POLL: Duration = Duration::from_millis(100);
const NAVIGATE_PACE: Duration = Duration::from_secs(2);
const HISTORY_PACE: Duration = Duration::from_millis(300);
const TABS_ACTION: &str = "The tabs action is list, new, select or close.";
const HISTORY_ACTION: &str = "The history action is back, forward or reload.";
/// The saved trusted sites, under the key the Electron build used.
const TRUSTED_SITES_KEY: &str = "browserTrustedSites";
/// A consent the user does not answer within this long is a no.
const CONSENT_WAIT: Duration = Duration::from_secs(120);
const DENY: &str = "deny";
/// The saved ad-block choice, under the key the Electron build used.
const ADBLOCK_KEY: &str = "adblockEnabled";
const TRACE_KIND: &str = "The trace kind is console or network.";
const TRACE_EVENTS: [&str; 5] = [
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Network.loadingFailed",
];

/// The pane's tabs, one child webview each, the counter that names new ones, and what the user has
/// let the agent do.
#[derive(Default)]
pub struct Panes {
    tabs: Mutex<Tabs<Webview>>,
    labels: AtomicU64,
    observer: Arc<Observer>,
    actions: Arc<RateLimit>,
    grants: Mutex<Option<Grants>>,
    action_sessions: Mutex<Vec<String>>,
    consents: Mutex<HashMap<String, oneshot::Sender<String>>>,
    consent_seq: AtomicU64,
    dialogs: Mutex<HashMap<String, Arc<DialogState>>>,
    /// The agent step in flight; a takeover sends `true` to it.
    run: Mutex<Option<watch::Sender<bool>>>,
    traces: Mutex<HashMap<String, Arc<Mutex<Trace>>>>,
}

impl Panes {
    fn lock(&self) -> MutexGuard<'_, Tabs<Webview>> {
        self.tabs.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn register_all(registry: &mut Registry) {
    register!(registry, "browser-pane:bounds" => pane_bounds);
    register!(registry, "browser-pane:visible" => pane_visible);
    register!(registry, "browser-navigate" => navigate);
    register!(registry, "browser-tabs" => tabs);
    register!(registry, "browser-history" => history);
    register!(registry, "browser-close" => close_pane);
    register!(registry, "browser-snapshot" => snapshot);
    register!(registry, "browser-get-elements" => get_elements);
    register!(registry, "browser-get-text" => get_text);
    register!(registry, "browser-screenshot" => screenshot);
    register!(registry, "browser-click" => click);
    register!(registry, "browser-type" => type_text);
    register!(registry, "browser-press-key" => press_key);
    register!(registry, "browser-hover" => hover);
    register!(registry, "browser-drag" => drag);
    register!(registry, "browser-scroll" => scroll);
    register!(registry, "browser-select-option" => select_option);
    register!(registry, "browser-wait" => wait);
    register!(registry, "browser-consent:answer" => consent_answer);
    register!(registry, "browser-grants:list" => grants_list);
    register!(registry, "browser-grants:revoke" => grants_revoke);
    register!(registry, "browser-dialog" => answer_dialog);
    register!(registry, "browser-agent:stop" => agent_stop);
    register!(registry, "browser-agent:release" => agent_release);
    register!(registry, "browser-bar-action" => bar_action);
    register!(registry, "browser-bar-menu" => bar_menu);
    register!(registry, "browser-bar-set-adblock" => bar_set_adblock);
    register!(registry, "browser-trace" => trace);
}

async fn pane_bounds(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(limit) = window_limit(&app) else {
        return Ok(json!({ "success": false }));
    };
    let Some(rect) = args
        .first()
        .and_then(|raw| pane::sanitise_bounds(raw, limit))
    else {
        return Ok(json!({ "success": false }));
    };
    let panes = app.state::<Panes>();
    panes.lock().set_bounds(rect);
    apply_layout(&panes);
    Ok(json!({ "success": true }))
}

async fn pane_visible(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let panes = app.state::<Panes>();
    panes.lock().set_visible(args.first().is_some_and(truthy));
    apply_layout(&panes);
    Ok(json!({ "success": true }))
}

async fn navigate(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let url = match policy::check(args.first().and_then(Value::as_str).unwrap_or("")) {
        Ok(url) => url,
        Err(message) => return Ok(pages::failure("refused_url", Some(message))),
    };
    if let Err(failed) = ensure_page(&app).await {
        return Ok(failed);
    }
    let Some(webview) = front_webview(&app) else {
        return Ok(pages::failure("pane_unavailable", None));
    };
    Ok(load(&webview, &url).await)
}

async fn tabs(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let action = args.first().and_then(Value::as_str).unwrap_or("");
    let options = args.get(1).cloned().unwrap_or(Value::Null);
    let reply = match action {
        "list" => json!({ "ok": true, "tabs": tab_rows(&app).await }),
        "new" => new_tab(&app, &options).await,
        "select" => select_tab(&app, &options).await,
        "close" => close_tab(&app, &options),
        _ => pages::failure("invalid_input", Some(TABS_ACTION)),
    };
    Ok(reply)
}

async fn history(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let action = args.first().and_then(Value::as_str).unwrap_or("");
    if !matches!(action, "back" | "forward" | "reload") {
        return Ok(pages::failure("invalid_input", Some(HISTORY_ACTION)));
    }
    let Some(webview) = front_webview(&app) else {
        return Ok(pages::failure("not_navigated", None));
    };
    if webview
        .url()
        .map(|url| url.as_str() == BLANK)
        .unwrap_or(true)
    {
        return Ok(pages::failure("not_navigated", None));
    }
    if let Err(failed) = show(&app).await {
        return Ok(failed);
    }
    Ok(step(&webview, action).await)
}

/// The pane's agent driver ends with this; the pane itself stays where it is.
async fn close_pane(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "ok": true }))
}

async fn new_tab(app: &AppHandle, options: &Value) -> Value {
    let target = match options.get("url") {
        Some(raw) => match policy::check(raw.as_str().unwrap_or("")) {
            Ok(url) => Some(url),
            Err(message) => return pages::failure("refused_url", Some(message)),
        },
        None => None,
    };
    if let Err(failed) = add_tab(app) {
        return failed;
    }
    if let Err(failed) = show(app).await {
        return failed;
    }
    if let (Some(url), Some(webview)) = (target, front_webview(app)) {
        let _ = load(&webview, &url).await;
    }
    json!({ "ok": true })
}

async fn select_tab(app: &AppHandle, options: &Value) -> Value {
    let Some(at) = index_of(options.get("index")) else {
        return pages::failure("invalid_tab", None);
    };
    let selected = app.state::<Panes>().lock().select(at);
    if !selected {
        return pages::failure("invalid_tab", None);
    }
    apply_layout(&app.state::<Panes>());
    match show(app).await {
        Ok(()) => json!({ "ok": true }),
        Err(failed) => failed,
    }
}

fn close_tab(app: &AppHandle, options: &Value) -> Value {
    let panes = app.state::<Panes>();
    let closed = index_of(options.get("index")).and_then(|at| panes.lock().close(at));
    let Some(gone) = closed else {
        return pages::failure("invalid_tab", None);
    };
    locked(&panes.dialogs).remove(gone.label());
    let _ = gone.close();
    apply_layout(&panes);
    json!({ "ok": true })
}

async fn tab_rows(app: &AppHandle) -> Vec<Value> {
    let snapshot: Vec<(Webview, bool)> = {
        let panes = app.state::<Panes>();
        let tabs = panes.lock();
        let front = tabs.front();
        let rows: Vec<(Webview, bool)> = tabs
            .views()
            .iter()
            .enumerate()
            .map(|(at, webview)| (webview.clone(), at == front))
            .collect();
        rows
    };
    let mut rows = Vec::with_capacity(snapshot.len());
    for (at, (webview, active)) in snapshot.into_iter().enumerate() {
        let url = webview.url().map(|url| url.to_string()).unwrap_or_default();
        let title = page_title(&webview).await;
        rows.push(json!({ "index": at, "active": active, "title": title, "url": url }));
    }
    rows
}

/// Makes sure there is a tab to show, then that the pane is on screen.
async fn ensure_page(app: &AppHandle) -> Result<(), Value> {
    let empty = app.state::<Panes>().lock().views().is_empty();
    if empty {
        add_tab(app)?;
    }
    show(app).await
}

/// Waits, up to `OPEN_WAIT`, for the renderer to put the pane on screen after asking it to.
async fn show(app: &AppHandle) -> Result<(), Value> {
    let ready = app.state::<Panes>().lock().shown();
    if ready {
        return Ok(());
    }
    emit(app, "browser-pane-open", Value::Null);
    let deadline = Instant::now() + OPEN_WAIT;
    loop {
        let ready = app.state::<Panes>().lock().shown();
        if ready {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(pages::failure("pane_unavailable", None));
        }
        tokio::time::sleep(OPEN_POLL).await;
    }
}

fn add_tab(app: &AppHandle) -> Result<(), Value> {
    let panes = app.state::<Panes>();
    if panes.lock().views().len() >= MAX_TABS {
        return Err(pages::failure("tab_limit", None));
    }
    let webview = create_tab(app, &panes)
        .map_err(|error| pages::failure("pane_unavailable", Some(&error)))?;
    let opened = panes.lock().open(webview);
    if let Err(extra) = opened {
        let _ = extra.close();
        return Err(pages::failure("tab_limit", None));
    }
    apply_layout(&panes);
    Ok(())
}

/// A hidden child webview of the main window, allowed to browse only http, https and about pages.
fn create_tab(app: &AppHandle, panes: &Panes) -> Result<Webview, String> {
    let window = app
        .get_window(MAIN_WINDOW)
        .ok_or("the main window is not open")?;
    let label = format!(
        "{PANE_LABEL}{}",
        panes.labels.fetch_add(1, Ordering::Relaxed)
    );
    let blank = Url::parse(BLANK).map_err(|error| error.to_string())?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(blank))
        .on_navigation(|url: &Url| matches!(url.scheme(), "http" | "https" | "about"));
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|error| error.to_string())?;
    webview.hide().map_err(|error| error.to_string())?;
    app.state::<AppState>()
        .diag
        .info("window.browser.pane", "pane tab created", None);
    Ok(webview)
}

/// Puts each tab where the pane says: the front tab at the stored rectangle while shown, the rest hidden.
fn apply_layout(panes: &Panes) {
    let tabs = panes.lock();
    for (webview, slot) in tabs.views().iter().zip(tabs.layout()) {
        match slot {
            Some(bounds) => {
                let _ = webview.set_bounds(rect_of(bounds));
                let _ = webview.show();
            }
            None => {
                let _ = webview.hide();
            }
        }
    }
}

fn rect_of(bounds: Bounds) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(bounds.x, bounds.y)),
        size: Size::Logical(LogicalSize::new(bounds.width, bounds.height)),
    }
}

fn window_limit(app: &AppHandle) -> Option<(f64, f64)> {
    let window = app.get_window(MAIN_WINDOW)?;
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some((size.width, size.height))
}

fn front_webview(app: &AppHandle) -> Option<Webview> {
    app.state::<Panes>().lock().current().cloned()
}

/// The tab index a renderer sent, read the way `Number(index)` reads it.
fn index_of(value: Option<&Value>) -> Option<usize> {
    let number = match value? {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (number.is_finite() && number >= 0.0 && number.fract() == 0.0).then_some(number as usize)
}

/// JavaScript truthiness for the visibility flag.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

#[cfg(windows)]
async fn load(webview: &Webview, url: &Url) -> Value {
    pages::navigate(
        &WebView2Cdp::new(webview.clone()),
        url.as_str(),
        NAVIGATE_PACE,
    )
    .await
}

#[cfg(not(windows))]
async fn load(_webview: &Webview, _url: &Url) -> Value {
    pages::failure("pane_unavailable", None)
}

#[cfg(windows)]
async fn step(webview: &Webview, action: &str) -> Value {
    pages::history(&WebView2Cdp::new(webview.clone()), action, HISTORY_PACE).await
}

#[cfg(not(windows))]
async fn step(_webview: &Webview, _action: &str) -> Value {
    pages::failure("pane_unavailable", None)
}

#[cfg(windows)]
async fn page_title(webview: &Webview) -> String {
    pages::title(&WebView2Cdp::new(webview.clone())).await
}

#[cfg(not(windows))]
async fn page_title(_webview: &Webview) -> String {
    String::new()
}

// The agent's page steps. Reads run straight; acting steps go through `acting`, which applies the
// rate limit, the site gate and the after-check for a verification page.

/// The page driver on this platform. Only Windows has a WebView2 pane to drive.
#[cfg(windows)]
type PageCdp = WebView2Cdp;

#[cfg(not(windows))]
enum PageCdp {}

#[cfg(not(windows))]
impl Cdp for PageCdp {
    fn call(
        &self,
        _method: &str,
        _params: Value,
    ) -> impl Future<Output = Result<Value, CdpError>> + Send {
        async move { match *self {} }
    }

    fn subscribe(&self, _event: &str) -> broadcast::Receiver<Value> {
        match *self {}
    }
}

#[cfg(windows)]
fn page_cdp(app: &AppHandle) -> Option<PageCdp> {
    front_webview(app).map(WebView2Cdp::new)
}

#[cfg(not(windows))]
fn page_cdp(_app: &AppHandle) -> Option<PageCdp> {
    None
}

async fn with_page<F, Fut>(app: &AppHandle, f: F) -> Value
where
    F: FnOnce(Arc<PageCdp>) -> Fut,
    Fut: Future<Output = Value>,
{
    let Some(cdp) = page_cdp(app) else {
        return pages::failure("pane_unavailable", None);
    };
    // A dialog freezes the page, so every step hears about it first.
    if let Some(open) = dialogs_of(app).and_then(|state| state.pending()) {
        let message = format!(
            "A {} dialog is open: \"{}\". Call browser_dialog to answer it.",
            open.kind, open.message
        );
        return pages::failure("dialog_open", Some(&message));
    }
    f(Arc::new(cdp)).await
}

fn settle(result: Result<Value, Fail>) -> Value {
    result.unwrap_or_else(|failure| failure.reply())
}

fn panes_parts(app: &AppHandle) -> (Arc<Observer>, Arc<RateLimit>) {
    let panes = app.state::<Panes>();
    (panes.observer.clone(), panes.actions.clone())
}

/// Runs one acting step: the rate limit, the site gate, then the step and a check for a verification page.
async fn acting<F, Fut>(app: &AppHandle, f: F) -> Value
where
    F: FnOnce(Arc<PageCdp>) -> Fut,
    Fut: Future<Output = Result<Value, Fail>>,
{
    let (_, actions) = panes_parts(app);
    if !actions.take() {
        return pages::failure("rate_limited", None);
    }
    let stop = begin_run(app);
    let gate = app.clone();
    let out = with_page(app, |cdp| async move {
        if *stop.borrow() {
            return pages::failure("user_took_over", None);
        }
        let before = pages::evaluate(&*cdp, SIGNATURE)
            .await
            .unwrap_or(Value::Null);
        let url = before
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !site_gate(&gate, url).await {
            return pages::failure("site_denied", None);
        }
        let Some(dialogs) = dialogs_of(&gate) else {
            return pages::failure("pane_unavailable", None);
        };
        // A click that raises an alert never returns until the alert is answered.
        let mut out = tokio::select! {
            result = f(cdp.clone()) => match result {
                Ok(out) => out,
                Err(failure) => return failure.reply(),
            },
            () = dialogs.opened() => json!({}),
            () = taken_over(stop.clone()) => return pages::failure("user_took_over", None),
        };
        sleep(Duration::from_millis(500)).await;
        if let Some(open) = dialogs.pending() {
            return json!({
                "ok": true,
                "url": page_url(&cdp).await,
                "dialog": open.to_value(),
            });
        }
        if pages::page_state(&*cdp)
            .await
            .is_ok_and(|state| state.is_bot_challenge())
        {
            return pages::failure("human_verification", None);
        }
        let after = pages::evaluate(&*cdp, SIGNATURE)
            .await
            .unwrap_or(Value::Null);
        let changed = if before.get("url") != after.get("url") {
            format!(
                "The page navigated to {}.",
                after.get("url").and_then(Value::as_str).unwrap_or_default()
            )
        } else if before != after {
            "The page changed in place. Call browser_snapshot to see what is new.".to_owned()
        } else {
            "Nothing visibly changed on the page.".to_owned()
        };
        if let Some(map) = out.as_object_mut() {
            map.insert(
                "title".into(),
                after.get("title").cloned().unwrap_or(Value::Null),
            );
            map.insert(
                "url".into(),
                after.get("url").cloned().unwrap_or(Value::Null),
            );
            map.insert("changed".into(), json!(changed));
        }
        out
    })
    .await;
    end_run(app);
    out
}

/// Starts the step a takeover can end. The slot keeps its sender until the step ends.
fn begin_run(app: &AppHandle) -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(false);
    *locked(&app.state::<Panes>().run) = Some(tx);
    rx
}

fn end_run(app: &AppHandle) {
    locked(&app.state::<Panes>().run).take();
}

/// Resolves once the user has taken the pane over. A step that ends without one never resolves here.
async fn taken_over(mut rx: watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

async fn agent_stop(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    if let Some(tx) = locked(&app.state::<Panes>().run).as_ref() {
        tx.send_replace(true);
    }
    Ok(json!({ "success": true }))
}

/// The run that drove the pane is over. The Electron overlay has no Tauri counterpart yet, so nothing else.
async fn agent_release(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": true }))
}

const SIGNATURE: &str = "({ url: location.href, title: document.title || '', nodes: document.getElementsByTagName('*').length, text: document.body ? document.body.innerText.length : 0 })";

/// A ref or an x and y point in the last screenshot, as a page point.
async fn locate(observer: &Observer, cdp: &PageCdp, target: &Value) -> Result<(f64, f64), Fail> {
    if let Some(reference) = target.as_str().filter(|t| observe::is_ref(t)) {
        return observer.point_of(cdp, reference).await;
    }
    match (
        target.get("x").and_then(Value::as_f64),
        target.get("y").and_then(Value::as_f64),
    ) {
        (Some(x), Some(y)) => observer.shot_point(x, y),
        _ => Err(Fail::new(
            "invalid_input",
            "Give a ref from browser_snapshot, or x and y from the last screenshot.",
        )),
    }
}

fn text_arg(args: &[Value], at: usize) -> String {
    args.get(at)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

async fn snapshot(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let (observer, _) = panes_parts(&app);
    Ok(with_page(
        &app,
        |cdp| async move { settle(observer.snapshot(&*cdp).await) },
    )
    .await)
}

async fn get_elements(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(with_page(&app, |cdp| async move {
        match read_json(&cdp, &elements::list_script()).await {
            Ok(list) => json!({ "ok": true, "elements": list }),
            Err(failure) => {
                let mut reply = failure.reply();
                reply["elements"] = json!([]);
                reply
            }
        }
    })
    .await)
}

async fn screenshot(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let (observer, _) = panes_parts(&app);
    Ok(with_page(&app, |cdp| async move {
        settle(observer.screenshot(&*cdp).await)
    })
    .await)
}

async fn get_text(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.first().cloned().unwrap_or(Value::Null);
    let (observer, _) = panes_parts(&app);
    let reference = options
        .get("ref")
        .and_then(Value::as_str)
        .filter(|r| !r.is_empty())
        .map(str::to_owned);
    let selector = options
        .get("selector")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Ok(with_page(&app, |cdp| async move {
        let text = match reference {
            Some(reference) => match observer.text_of(&*cdp, &reference).await {
                Ok(text) => text,
                Err(failure) => return failure.reply(),
            },
            None => {
                let script = if selector.is_empty() {
                    "document.body ? document.body.innerText : ''".to_owned()
                } else {
                    format!("(() => {{ const el = document.querySelector({}); return el ? el.innerText : null; }})()", json!(selector))
                };
                match pages::evaluate(&*cdp, &script).await {
                    Ok(Value::Null) => return pages::failure("element_not_found", Some("Nothing on the page matches that selector.")),
                    Ok(value) => value.as_str().unwrap_or_default().to_owned(),
                    Err(error) => return pages::failure("script_failed", Some(&error.0)),
                }
            }
        };
        let text: String = text.chars().take(12000).collect();
        json!({
            "ok": true,
            "title": pages::title(&*cdp).await,
            "url": pages::evaluate(&*cdp, "location.href").await.ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(),
            "text": text,
        })
    })
    .await)
}

async fn click(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let target = args.first().cloned().unwrap_or(Value::Null);
    let options = args.get(1).cloned().unwrap_or(Value::Null);
    let by_ref = target
        .as_str()
        .filter(|t| observe::is_ref(t))
        .map(str::to_owned);
    let by_point = options.get("x").and_then(Value::as_f64).is_some()
        && options.get("y").and_then(Value::as_f64).is_some();
    let by_index = if by_ref.is_none() && !by_point {
        elements::parse_index(&target)
    } else {
        None
    };
    if by_ref.is_none() && !by_point && by_index.is_none() {
        return Ok(pages::failure("invalid_index", None));
    }
    let (observer, _) = panes_parts(&app);
    let gate = app.clone();
    Ok(acting(&app, move |cdp| async move {
        let point = match (&by_ref, by_index) {
            (Some(reference), _) => {
                let entry = observer.resolve(&*cdp, reference).await?;
                if let Some(why) = safety::risky_action(&entry.role, &entry.name, "") {
                    confirm(&gate, &cdp, &why).await?;
                }
                observer.point_of(&*cdp, reference).await?
            }
            (None, Some(index)) => {
                let spot = read_json(&cdp, &elements::click_target_script(index)).await?;
                let point = point_of(&spot).ok_or_else(no_such_element)?;
                let info = read_json(&cdp, &elements::index_info_script(index)).await?;
                if let Some(why) = risky_index(&info) {
                    confirm(&gate, &cdp, &why).await?;
                }
                point
            }
            (None, None) => observer.shot_point(
                options.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                options.get("y").and_then(Value::as_f64).unwrap_or(0.0),
            )?,
        };
        let button = options
            .get("button")
            .and_then(Value::as_str)
            .unwrap_or("left");
        let modifiers: Vec<&str> = options
            .get("modifiers")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        act::click_at(
            &*cdp,
            point.0,
            point.1,
            button,
            options.get("count"),
            &modifiers,
        )
        .await?;
        Ok(json!({}))
    })
    .await)
}

async fn type_text(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let target_value = args.first().cloned().unwrap_or(Value::Null);
    let text = text_arg(&args, 1);
    let Some(target) = target_value
        .as_str()
        .filter(|t| observe::is_ref(t))
        .map(str::to_owned)
    else {
        return Ok(match elements::parse_index(&target_value) {
            Some(index) => type_by_index(&app, index, &text).await,
            None => pages::failure("invalid_index", None),
        });
    };
    let options = args.get(2).cloned().unwrap_or(Value::Null);
    let clear = options
        .get("clear")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let submit = options
        .get("submit")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (observer, _) = panes_parts(&app);
    let gate = app.clone();
    Ok(acting(&app, move |cdp| async move {
        let entry = observer.resolve(&*cdp, &target).await?;
        let object = observe::object_of(&*cdp, entry.backend_id).await?;
        if let Some(what) = safety::sensitive_field(&act::field_attrs(&*cdp, &object).await?) {
            return Err(Fail::new(
                "needs_user",
                format!(
                    "That is {what}. Ask the user to fill it in themselves in the browser pane."
                ),
            ));
        }
        if submit {
            confirm(&gate, &cdp, "submits a form").await?;
        }
        let (value, landed) = act::type_into(&*cdp, &object, &text, clear, submit).await?;
        Ok(json!({ "value": value, "landed": landed }))
    })
    .await)
}

async fn press_key(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let key = text_arg(&args, 0);
    let repeat = args.get(1).and_then(|o| o.get("repeat")).cloned();
    Ok(acting(&app, move |cdp| async move {
        act::press_key(&*cdp, &key, repeat.as_ref()).await?;
        sleep(Duration::from_millis(300)).await;
        Ok(json!({}))
    })
    .await)
}

async fn hover(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let target = args.first().cloned().unwrap_or(Value::Null);
    let (observer, _) = panes_parts(&app);
    Ok(acting(&app, move |cdp| async move {
        let (x, y) = locate(&observer, &cdp, &target).await?;
        act::hover(&*cdp, x, y).await?;
        Ok(json!({}))
    })
    .await)
}

async fn drag(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let from = args.first().cloned().unwrap_or(Value::Null);
    let to = args.get(1).cloned().unwrap_or(Value::Null);
    let (observer, _) = panes_parts(&app);
    Ok(acting(&app, move |cdp| async move {
        let a = locate(&observer, &cdp, &from).await?;
        let b = locate(&observer, &cdp, &to).await?;
        act::drag(&*cdp, a, b).await?;
        Ok(json!({}))
    })
    .await)
}

async fn scroll(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.first().cloned().unwrap_or(Value::Null);
    let reference = options
        .get("ref")
        .and_then(Value::as_str)
        .filter(|r| !r.is_empty())
        .map(str::to_owned);
    let dx = options.get("dx").and_then(Value::as_f64).unwrap_or(0.0);
    let dy = options.get("dy").and_then(Value::as_f64).unwrap_or(0.0);
    let to = options.get("to").and_then(Value::as_str).map(str::to_owned);
    let (observer, _) = panes_parts(&app);
    Ok(acting(&app, move |cdp| async move {
        let position = match reference {
            Some(reference) => {
                observer.point_of(&*cdp, &reference).await?;
                act::position(&*cdp).await
            }
            None => act::scroll(&*cdp, dx, dy, to.as_deref()).await?,
        };
        Ok(json!({ "scroll": position }))
    })
    .await)
}

async fn select_option(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let reference = args
        .first()
        .and_then(Value::as_str)
        .filter(|r| observe::is_ref(r))
        .map(str::to_owned);
    let Some(reference) = reference else {
        return Ok(pages::failure(
            "invalid_input",
            Some("Give the ref of a dropdown from browser_snapshot."),
        ));
    };
    let choice = args.get(1).cloned().unwrap_or(Value::Null);
    let value = choice
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let label = choice
        .get("label")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let (observer, _) = panes_parts(&app);
    Ok(acting(&app, move |cdp| async move {
        let entry = observer.resolve(&*cdp, &reference).await?;
        let object = observe::object_of(&*cdp, entry.backend_id).await?;
        act::select_option(&*cdp, &object, value.as_deref(), label.as_deref()).await
    })
    .await)
}

async fn wait(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.first().cloned().unwrap_or(Value::Null);
    let text = options
        .get("text")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .map(str::to_owned);
    let url = options
        .get("url")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .map(str::to_owned);
    let ms = options.get("ms").cloned();
    let timeout = options.get("timeoutMs").cloned();
    Ok(acting(&app, move |cdp| async move {
        let spent = act::wait(
            &*cdp,
            text.as_deref(),
            url.as_deref(),
            ms.as_ref(),
            timeout.as_ref(),
        )
        .await?;
        Ok(json!({ "waited": spent }))
    })
    .await)
}

/// Locks a slot, reading through a poisoned lock.
fn locked<T>(slot: &Mutex<T>) -> MutexGuard<'_, T> {
    slot.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The saved trusted sites, read from the app store.
fn saved_trusted(app: &AppHandle) -> Vec<String> {
    let raw = app
        .state::<AppState>()
        .storage
        .handle()
        .and_then(|store| store.get_value(TRUSTED_SITES_KEY).ok().flatten());
    safety::parse_trusted(raw.as_deref())
}

fn save_trusted(app: &AppHandle, trusted: &[String]) {
    let Some(store) = app.state::<AppState>().storage.handle() else {
        return;
    };
    if let Ok(text) = serde_json::to_string(trusted) {
        let _ = store.set_value(TRUSTED_SITES_KEY, &text);
    }
}

/// Reads or changes the grants; the saved trusted sites follow any change to them.
fn with_grants<T>(app: &AppHandle, f: impl FnOnce(&mut Grants) -> T) -> T {
    let panes = app.state::<Panes>();
    let mut slot = locked(&panes.grants);
    let grants = slot.get_or_insert_with(|| Grants::new(saved_trusted(app)));
    let before = grants.list().to_vec();
    let out = f(&mut *grants);
    if grants.list() != before.as_slice() {
        save_trusted(app, grants.list());
    }
    out
}

/// The first thing the agent does on a site needs the user's word. Returns whether it may go on.
async fn site_gate(app: &AppHandle, url: &str) -> bool {
    let Some(origin) = safety::origin_of(url) else {
        return true;
    };
    if with_grants(app, |g| g.standing(&origin)) != Standing::Unknown {
        return true;
    }
    let host = safety::host_of(&origin);
    match ask_consent(app, "site", &host, "").await.as_str() {
        "always" => with_grants(app, |g| g.trust(&origin)),
        "session" => with_grants(app, |g| g.allow_session(&origin)),
        "once" => {}
        _ => return false,
    }
    true
}

/// A click or submit that pays, deletes or sends needs the user's word unless they trust the site.
async fn action_gate(app: &AppHandle, url: &str, why: &str) -> bool {
    let origin = safety::origin_of(url);
    if let Some(origin) = origin.as_deref() {
        let trusted = with_grants(app, |g| g.standing(origin) == Standing::Trusted);
        let session = locked(&app.state::<Panes>().action_sessions)
            .iter()
            .any(|o| o == origin);
        if trusted || session {
            return true;
        }
    }
    let host = safety::host_of(origin.as_deref().unwrap_or(""));
    let choice = ask_consent(app, "action", &host, why).await;
    if let Some(origin) = origin.as_deref() {
        match choice.as_str() {
            "always" => with_grants(app, |g| g.trust(origin)),
            "session" => {
                let panes = app.state::<Panes>();
                locked(&panes.action_sessions).push(origin.to_owned());
            }
            _ => {}
        }
    }
    matches!(choice.as_str(), "once" | "always" | "session")
}

/// Asks the user through the main window and waits for the answer. No answer in time is a deny.
async fn ask_consent(app: &AppHandle, kind: &str, host: &str, detail: &str) -> String {
    let (id, waiting) = {
        let panes = app.state::<Panes>();
        let seq = panes.consent_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let id = format!("consent-{seq}");
        let (tx, rx) = oneshot::channel();
        locked(&panes.consents).insert(id.clone(), tx);
        (id, rx)
    };
    emit(
        app,
        "browser-consent",
        json!({ "id": id, "kind": kind, "host": host, "detail": detail }),
    );
    match tokio::time::timeout(CONSENT_WAIT, waiting).await {
        Ok(Ok(choice)) => choice,
        _ => {
            let panes = app.state::<Panes>();
            locked(&panes.consents).remove(&id);
            emit(app, "browser-consent", Value::Null);
            DENY.to_owned()
        }
    }
}

async fn consent_answer(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = text_arg(&args, 0);
    let success = answer_consent(&app.state::<Panes>(), &id, &text_arg(&args, 1));
    if success {
        emit(&app, "browser-consent", Value::Null);
    }
    Ok(json!({ "success": success }))
}

/// Settles the consent a step is waiting on. Anything but a known choice is a deny; an unknown id is not
/// an answer at all.
fn answer_consent(panes: &Panes, id: &str, choice: &str) -> bool {
    let choice = if matches!(choice, "session" | "once" | "always") {
        choice
    } else {
        DENY
    };
    let sender = locked(&panes.consents).remove(id);
    sender.is_some_and(|tx| tx.send(choice.to_owned()).is_ok())
}

async fn grants_list(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!(with_grants(&app, |g| g.list().to_vec())))
}

async fn grants_revoke(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(origin) = args.first().and_then(Value::as_str).map(str::to_owned) else {
        return Ok(json!({ "success": false }));
    };
    with_grants(&app, |g| g.revoke(&origin));
    Ok(json!({ "success": true }))
}

async fn answer_dialog(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(accept) = dialog_accepts(args.first().and_then(Value::as_str)) else {
        return Ok(pages::failure(
            "invalid_input",
            Some("The dialog action is accept or dismiss."),
        ));
    };
    let text = args.get(1).and_then(Value::as_str).map(str::to_owned);
    if let Err(failed) = ensure_page(&app).await {
        return Ok(failed);
    }
    let (Some(cdp), Some(state)) = (page_cdp(&app), dialogs_of(&app)) else {
        return Ok(pages::failure("pane_unavailable", None));
    };
    Ok(
        match dialogs::answer(&state, &cdp, accept, text.as_deref()).await {
            Ok(Some(dialog)) => {
                sleep(Duration::from_millis(300)).await;
                json!({ "ok": true, "answered": dialog.kind, "url": page_url(&cdp).await })
            }
            Ok(None) => pages::failure("no_dialog", None),
            Err(error) => Fail::from(error).reply(),
        },
    )
}

/// The renderer's dialog action: accept is true, dismiss is false, anything else is refused.
fn dialog_accepts(action: Option<&str>) -> Option<bool> {
    match action {
        Some("accept") => Some(true),
        Some("dismiss") => Some(false),
        _ => None,
    }
}

/// The dialog tracker of the page in the front tab, started on first use.
fn dialogs_of(app: &AppHandle) -> Option<Arc<DialogState>> {
    let webview = front_webview(app)?;
    let label = webview.label().to_owned();
    let panes = app.state::<Panes>();
    if let Some(state) = locked(&panes.dialogs).get(&label) {
        return Some(state.clone());
    }
    let state = watch_page(&webview);
    let mut map = locked(&panes.dialogs);
    let tracked = map.entry(label).or_insert(state).clone();
    Some(tracked)
}

#[cfg(windows)]
fn watch_page(webview: &Webview) -> Arc<DialogState> {
    dialogs::watch(Arc::new(WebView2Cdp::new(webview.clone())))
}

#[cfg(not(windows))]
fn watch_page(_webview: &Webview) -> Arc<DialogState> {
    Arc::new(DialogState::default())
}

async fn page_url(cdp: &PageCdp) -> String {
    pages::evaluate(cdp, "location.href")
        .await
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Runs a script that answers with JSON text and reads the answer.
async fn read_json(cdp: &PageCdp, script: &str) -> Result<Value, Fail> {
    read_json_from(cdp, script).await
}

async fn read_json_from(cdp: &impl Cdp, script: &str) -> Result<Value, Fail> {
    let raw = pages::evaluate(cdp, script).await?;
    let text = raw.as_str().unwrap_or_default();
    serde_json::from_str(text).map_err(|_| Fail::new("script_failed", ""))
}

fn point_of(spot: &Value) -> Option<(f64, f64)> {
    Some((spot.get("x")?.as_f64()?, spot.get("y")?.as_f64()?))
}

fn no_such_element() -> Fail {
    Fail::new("element_not_found", "No element has that index.")
}

fn risky_index(info: &Value) -> Option<String> {
    let role = info.get("role").and_then(Value::as_str).unwrap_or_default();
    let name = info.get("name").and_then(Value::as_str).unwrap_or_default();
    let input = info
        .get("inputType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    safety::risky_action(role, name, input)
}

/// Asks before an action that pays, deletes, sends or posts. A refusal is `needs_confirmation`.
async fn confirm(app: &AppHandle, cdp: &PageCdp, why: &str) -> Result<(), Fail> {
    let url = page_url(cdp).await;
    if action_gate(app, &url, why).await {
        return Ok(());
    }
    Err(Fail::new("needs_confirmation", ""))
}

/// Types into a numbered field. A password or payment field is left to the user.
async fn type_by_index(app: &AppHandle, index: i64, text: &str) -> Value {
    let text = text.to_owned();
    acting(
        app,
        move |cdp| async move { type_at(&*cdp, index, &text).await },
    )
    .await
}

/// Types into a numbered field of the page. A password or payment field is left to the user.
async fn type_at(cdp: &impl Cdp, index: i64, text: &str) -> Result<Value, Fail> {
    let info = read_json_from(cdp, &elements::index_info_script(index)).await?;
    let attrs = info.get("attrs").cloned().unwrap_or(Value::Null);
    if let Some(what) = safety::sensitive_field(&attrs) {
        return Err(Fail::new(
            "needs_user",
            format!("That is {what}. Ask the user to fill it in themselves in the browser pane."),
        ));
    }
    let typed = pages::evaluate(cdp, &elements::type_into_script(index, text)).await?;
    if typed.as_bool() != Some(true) {
        return Err(no_such_element());
    }
    Ok(json!({ "ok": true }))
}

/// What the user typed in the address bar: an address, a bare host, or else a search.
fn typed_url(raw: &str) -> Option<Url> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let has_scheme = Regex::new(r"(?i)^[a-z][a-z0-9+.-]*://").is_ok_and(|re| re.is_match(value));
    if has_scheme {
        return policy::check_typed(value).ok();
    }
    let bare_host = Regex::new(r"^[^\s/]+\.[^\s/]{2,}(/|$|\?)").is_ok_and(|re| re.is_match(value));
    if bare_host {
        return policy::check_typed(&format!("https://{value}")).ok();
    }
    policy::check_typed(&format!(
        "https://duckduckgo.com/?q={}",
        encode_query(value)
    ))
    .ok()
}

/// `encodeURIComponent`, for the search fallback.
fn encode_query(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The toolbar's buttons. The Tauri bar lives in the window, so it needs nothing from the pane.
async fn bar_action(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let action = text_arg(&args, 0);
    let value = text_arg(&args, 1);
    let Some(webview) = front_webview(&app) else {
        return Ok(json!({ "success": false }));
    };
    let done = match action.as_str() {
        "back" | "forward" | "reload" => {
            step(&webview, &action).await;
            true
        }
        "stop" => {
            if let Some(cdp) = page_cdp(&app) {
                let _ = cdp.call("Page.stopLoading", json!({})).await;
            }
            true
        }
        "navigate" => {
            if let Some(url) = typed_url(&value) {
                load(&webview, &url).await;
            }
            true
        }
        "external" => {
            open_current(&app).await;
            true
        }
        // Pop-out needs a second window, which this build does not open yet.
        _ => false,
    };
    if done {
        broadcast_bar_state(&app).await;
    }
    Ok(json!({ "success": done }))
}

/// Opens the page's own web address in the system browser, and nothing else.
async fn open_current(app: &AppHandle) {
    let Some(cdp) = page_cdp(app) else {
        return;
    };
    let url = page_url(&cdp).await;
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

/// The bar's state: the page's address, title and load, and the ad-block choice.
async fn broadcast_bar_state(app: &AppHandle) {
    let Some(cdp) = page_cdp(app) else {
        return;
    };
    let script = "({ url: location.href, title: document.title || '', loading: document.readyState !== 'complete', canGoBack: history.length > 1, canGoForward: false })";
    let Ok(mut state) = pages::evaluate(&cdp, script).await else {
        return;
    };
    state["adblock"] = json!(adblock_on(app));
    emit(app, "browser-bar-state", state);
}

/// The toolbar menu grows the bar in Electron. The Tauri bar is part of the window, so there is nothing to move.
async fn bar_menu(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": true }))
}

/// The ad-block choice, on unless the saved value is "off". Only the setting is kept here; no filter runs yet.
fn adblock_on(app: &AppHandle) -> bool {
    let raw = app
        .state::<AppState>()
        .storage
        .handle()
        .and_then(|store| store.get_value(ADBLOCK_KEY).ok().flatten());
    raw.as_deref() != Some("off")
}

async fn bar_set_adblock(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let on = args.first().is_some_and(truthy);
    if let Some(store) = app.state::<AppState>().storage.handle() {
        let _ = store.set_value(ADBLOCK_KEY, if on { "on" } else { "off" });
    }
    // The filters apply to requests as they are made, so the page shows the change after a reload.
    if let Some(webview) = front_webview(&app) {
        step(&webview, "reload").await;
    }
    broadcast_bar_state(&app).await;
    Ok(json!({ "success": true, "enabled": on }))
}

/// Electron's `Math.min(Math.max(Number(limit) || 50, 1), 200)`.
fn trace_limit(value: Option<&Value>) -> usize {
    let number = match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    let number = if number.is_nan() || number == 0.0 {
        50.0
    } else {
        number
    };
    number.clamp(1.0, 200.0) as usize
}

async fn trace(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let kind = args.first().and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "console" | "network") {
        return Ok(pages::failure("invalid_input", Some(TRACE_KIND)));
    }
    let options = args.get(1).cloned().unwrap_or(Value::Null);
    let count = trace_limit(options.get("limit"));
    let only_failed = options.get("onlyFailed") == Some(&Value::Bool(true));
    let Some(webview) = front_webview(&app) else {
        return Ok(pages::failure("pane_unavailable", None));
    };
    let _ = dialogs_of(&app);
    let trace = trace_of(&app, &webview);
    let entries = if kind == "console" {
        locked(&trace).console(count)
    } else {
        locked(&trace).network(count, only_failed)
    };
    Ok(json!({ "ok": true, "entries": entries }))
}

/// The trace of the page in the front tab, started on first use.
fn trace_of(app: &AppHandle, webview: &Webview) -> Arc<Mutex<Trace>> {
    let label = webview.label().to_owned();
    let panes = app.state::<Panes>();
    let mut map = locked(&panes.traces);
    if let Some(trace) = map.get(&label) {
        return trace.clone();
    }
    let trace = Arc::new(Mutex::new(Trace::default()));
    start_trace(webview, trace.clone());
    map.insert(label, trace.clone());
    trace
}

#[cfg(windows)]
fn start_trace(webview: &Webview, trace: Arc<Mutex<Trace>>) {
    pump(WebView2Cdp::new(webview.clone()), trace);
}

#[cfg(not(windows))]
fn start_trace(_webview: &Webview, _trace: Arc<Mutex<Trace>>) {}

/// Feeds the page's console and network events into the trace. The tasks keep the page driver alive,
/// since its event senders live there. Events before the first trace request are not seen.
#[cfg(windows)]
fn pump(cdp: WebView2Cdp, trace: Arc<Mutex<Trace>>) {
    let cdp = Arc::new(cdp);
    for event in TRACE_EVENTS {
        let mut rx = cdp.subscribe(event);
        let trace = trace.clone();
        let keep = cdp.clone();
        tauri::async_runtime::spawn(async move {
            let _keep = keep;
            loop {
                match rx.recv().await {
                    Ok(params) => locked(&trace).handle(event, &params),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::browser::cdp::fake::FakeCdp;

    #[test]
    fn a_numbered_element_gives_its_click_point() {
        assert_eq!(point_of(&json!({ "x": 4.0, "y": 9.0 })), Some((4.0, 9.0)));
        assert_eq!(point_of(&json!({ "missing": true })), None);
    }

    #[test]
    fn a_consent_answer_reaches_the_step_waiting_on_it() {
        let panes = Panes::default();
        let (tx, mut rx) = oneshot::channel();
        locked(&panes.consents).insert("consent-1".to_owned(), tx);
        assert!(answer_consent(&panes, "consent-1", "bogus"));
        assert_eq!(rx.try_recv().ok().as_deref(), Some(DENY));
        assert!(!answer_consent(&panes, "consent-1", "always"));
    }

    #[test]
    fn a_consent_for_an_unknown_step_is_not_an_answer() {
        let panes = Panes::default();
        assert!(!answer_consent(&panes, "consent-9", "once"));
    }

    #[test]
    fn dialog_actions_map_to_accept_or_dismiss() {
        assert_eq!(dialog_accepts(Some("accept")), Some(true));
        assert_eq!(dialog_accepts(Some("dismiss")), Some(false));
        assert_eq!(dialog_accepts(Some("ok")), None);
        assert_eq!(dialog_accepts(None), None);
    }

    #[tokio::test]
    async fn typing_into_a_numbered_field_reads_it_then_types() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Runtime.evaluate",
            json!({ "result": { "value": "{\"attrs\":{\"type\":\"text\"}}" } }),
        )
        .answer("Runtime.evaluate", json!({ "result": { "value": true } }));
        assert_eq!(
            type_at(&cdp, 7, "hello").await.ok(),
            Some(json!({ "ok": true }))
        );
        let scripts: Vec<Value> = cdp.params_of("Runtime.evaluate");
        assert_eq!(scripts.len(), 2);
        assert_eq!(
            scripts[1]["expression"].as_str(),
            Some(elements::type_into_script(7, "hello").as_str())
        );
    }

    #[tokio::test]
    async fn a_password_field_is_left_to_the_user_without_typing() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Runtime.evaluate",
            json!({ "result": { "value": "{\"attrs\":{\"type\":\"password\"}}" } }),
        );
        let Err(failed) = type_at(&cdp, 3, "secret").await else {
            panic!("the password field was typed into");
        };
        assert_eq!(failed.reply()["error"]["code"], json!("needs_user"));
        assert_eq!(cdp.params_of("Runtime.evaluate").len(), 1);
    }

    #[tokio::test]
    async fn a_takeover_ends_a_waiting_step() {
        let (tx, rx) = watch::channel(false);
        let waiting = tokio::spawn(taken_over(rx));
        tx.send_replace(true);
        waiting.await.expect("the step ends");
    }

    #[test]
    fn typed_text_is_an_address_a_host_or_a_search() {
        assert_eq!(
            typed_url("http://localhost:3000/")
                .map(|u| u.to_string())
                .as_deref(),
            Some("http://localhost:3000/")
        );
        assert_eq!(
            typed_url("example.com/a").map(|u| u.to_string()).as_deref(),
            Some("https://example.com/a")
        );
        let search = typed_url("how tall is everest")
            .map(|u| u.to_string())
            .unwrap_or_default();
        assert!(search.starts_with("https://duckduckgo.com/?q=how%20tall%20is%20everest"));
        assert!(typed_url("file:///etc/passwd").is_none());
    }
}
