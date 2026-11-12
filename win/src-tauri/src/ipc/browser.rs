//! The in-app browser pane's channels: where the pane sits, which tabs it holds and the pages in them.
//! Each tab is a child webview of the main window that stays hidden until the renderer shows the pane.

use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Url, Webview,
    WebviewUrl,
};
#[cfg(not(windows))]
use tokio::sync::broadcast;
use tokio::time::sleep;

use super::{IpcError, Registry, emit};
use crate::AppState;
#[cfg(not(windows))]
use crate::browser::cdp::{Cdp, CdpError};
#[cfg(windows)]
use crate::browser::cdp_webview2::WebView2Cdp;
use crate::browser::observe::{self, Fail, Observer};
use crate::browser::pages;
use crate::browser::pane::{self, Bounds, MAX_TABS, Tabs};
use crate::browser::policy;
use crate::browser::safety::RateLimit;
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

/// The pane's tabs, one child webview each, and the counter that names new ones.
#[derive(Default)]
pub struct Panes {
    tabs: Mutex<Tabs<Webview>>,
    labels: AtomicU64,
    observer: Arc<Observer>,
    actions: Arc<RateLimit>,
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
    with_page(app, |cdp| async move {
        let before = pages::evaluate(&*cdp, SIGNATURE)
            .await
            .unwrap_or(Value::Null);
        if !safety::site_allowed(
            before
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ) {
            return pages::failure("site_denied", None);
        }
        let mut out = match f(cdp.clone()).await {
            Ok(out) => out,
            Err(failure) => return failure.reply(),
        };
        sleep(Duration::from_millis(500)).await;
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
    .await
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
    let (observer, _) = panes_parts(&app);
    Ok(with_page(&app, |_cdp| async move {
        json!({ "ok": true, "elements": observer.elements() })
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
    if by_ref.is_none() && !by_point {
        return Ok(pages::failure("invalid_index", None));
    }
    let (observer, _) = panes_parts(&app);
    Ok(acting(&app, move |cdp| async move {
        let point = match &by_ref {
            Some(reference) => {
                let entry = observer.resolve(&*cdp, reference).await?;
                if let Some(why) = safety::risky_action(&entry.role, &entry.name, "") {
                    return Err(Fail::new(
                        "needs_confirmation",
                        format!("This click {why}. Ask the user to do it."),
                    ));
                }
                observer.point_of(&*cdp, reference).await?
            }
            None => observer.shot_point(
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
    let target = args
        .first()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if !observe::is_ref(&target) {
        return Ok(pages::failure("invalid_index", None));
    }
    let text = text_arg(&args, 1);
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
            return Err(Fail::new(
                "needs_confirmation",
                "Submitting a form needs the user to confirm it.",
            ));
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
