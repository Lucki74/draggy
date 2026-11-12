//! The in-app browser pane's channels: where the pane sits, which tabs it holds and the pages in them.
//! Each tab is a child webview of the main window that stays hidden until the renderer shows the pane.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Url, Webview,
    WebviewUrl,
};

use super::{IpcError, Registry, emit};
use crate::AppState;
#[cfg(windows)]
use crate::browser::cdp_webview2::WebView2Cdp;
use crate::browser::pages;
use crate::browser::pane::{self, Bounds, MAX_TABS, Tabs};
use crate::browser::policy;

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

/// The pane's tabs, one child webview each, and the counter that names new ones.
#[derive(Default)]
pub struct Panes {
    tabs: Mutex<Tabs<Webview>>,
    labels: AtomicU64,
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
