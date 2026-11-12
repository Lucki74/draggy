//! Ad and tracker blocking for the browser pane. The lists are the ones Electron fetched; they are
//! compiled once and cached under app data. Each pane webview asks the engine about every request.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use adblock::Engine;
use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use tauri::{AppHandle, Manager};

use super::scriptlets;
use crate::AppState;

/// The version is in the name: a cache is a compiled copy of these lists.
const CACHE_FILE: &str = "adblock-engine-v1.bin";
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
const SETTING_KEY: &str = "adblockEnabled";
const STYLE_ID: &str = "draggy-cosmetic";

/// Electron's list set: uBlock Origin's defaults, AdGuard's, OISD, and the anti-adblock wall list.
const LIST_URLS: &[&str] = &[
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/peter-lowe/serverlist.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/badware.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2020.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2021.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2022.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2023.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2024.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2025.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/quick-fixes.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resource-abuse.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/unbreak.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easyprivacy.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/privacy.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist-cookie.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-others.txt",
    "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-cookies.txt",
    "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt",
    "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_3_Spyware/filter.txt",
    "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_11_Mobile/filter.txt",
    "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14_Annoyances/filter.txt",
    "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_17_TrackParam/filter.txt",
    "https://easylist-downloads.adblockplus.org/antiadblockfilters.txt",
    "https://small.oisd.nl/abp",
];

/// The first-party supplement that ships with the app; the lists leave these endpoints alone.
const EXTRA_RULES: &str = include_str!("filters/draggy-extra.txt");

static ENGINE: OnceLock<Engine> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(true);
static STARTED: AtomicBool = AtomicBool::new(false);

/// Turns blocking on or off for requests made from now on.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
}

/// Loads the engine in the background, once. Reads the saved choice, as Electron's start-up did.
/// Fetching happens here whether or not blocking is on, which matches Electron's priming.
pub fn start(app: &AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let state = app.state::<AppState>();
    let saved = state
        .storage
        .handle()
        .and_then(|store| store.get_value(SETTING_KEY).ok().flatten());
    ENABLED.store(saved.as_deref() != Some("off"), Ordering::SeqCst);

    let diag = state.diag.clone();
    let Some(dir) = crate::paths::data_dir(std::env::var_os("APPDATA")).ok() else {
        diag.warn("net.adblock", "filter lists unavailable", None);
        return;
    };
    tauri::async_runtime::spawn(async move {
        match load(dir).await {
            Ok(mut engine) => {
                // Scriptlets are not part of the cached lists, so they are attached on every start.
                engine.use_resources(scriptlets::resources());
                let _ = ENGINE.set(engine);
                diag.info("net.adblock", "filter engine ready", None);
            }
            Err(reason) => diag.warn(
                "net.adblock",
                "filter lists unavailable",
                Some(serde_json::json!({ "reason": reason })),
            ),
        }
    });
}

/// The cached engine when there is one; otherwise every list is fetched and the result cached.
async fn load(dir: PathBuf) -> Result<Engine, &'static str> {
    let cache = dir.join(CACHE_FILE);
    let cached = tauri::async_runtime::spawn_blocking({
        let cache = cache.clone();
        move || {
            let bytes = fs::read(cache).ok()?;
            let mut engine = Engine::default();
            engine.deserialize(&bytes).ok().map(|_| engine)
        }
    })
    .await
    .ok()
    .flatten();
    if let Some(engine) = cached {
        return Ok(engine);
    }

    let lists = fetch_lists().await?;
    tauri::async_runtime::spawn_blocking(move || {
        let engine = build(lists);
        // A cache that cannot be written only costs the next start a fetch.
        let _ = fs::create_dir_all(&dir).and_then(|_| fs::write(cache, engine.serialize()));
        Ok(engine)
    })
    .await
    .map_err(|_| "the filter engine failed to build")?
}

/// Errors carry no URL: a list address is not something to write to the log.
async fn fetch_lists() -> Result<Vec<String>, &'static str> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|_| "the HTTP client failed to start")?;
    let fetches = LIST_URLS.iter().map(|url| {
        let client = client.clone();
        async move {
            let response = client
                .get(*url)
                .send()
                .await
                .and_then(|response| response.error_for_status())
                .map_err(|_| "a filter list could not be fetched")?;
            response
                .text()
                .await
                .map_err(|_| "a filter list could not be read")
        }
    });
    futures_util::future::try_join_all(fetches).await
}

fn build(lists: Vec<String>) -> Engine {
    let mut set = FilterSet::new(false);
    for text in lists {
        set.add_filter_list(text, ParseOptions::default());
    }
    set.add_filter_list(EXTRA_RULES.to_owned(), ParseOptions::default());
    Engine::new_with_filter_set(set)
}

/// Whether a request from `source_url` for `url` should be stopped. Unknown or unparsable requests pass.
pub fn should_block(url: &str, source_url: &str, request_type: &str) -> bool {
    if !ENABLED.load(Ordering::SeqCst) {
        return false;
    }
    let Some(engine) = ENGINE.get() else {
        return false;
    };
    match Request::new(url, source_url, request_type, "GET") {
        Ok(request) => engine.check_network_request(&request).should_block(),
        Err(_) => false,
    }
}

/// Cosmetic rules for one page: site hide rules, the exceptions that skip generic rules, and generichide.
pub struct PageRules {
    pub css: String,
    pub exceptions: HashSet<String>,
    pub generichide: bool,
    /// Scriptlet JavaScript for the page's `##+js` filters; empty when there are none.
    pub script: String,
}

/// Site cosmetic rules for a page URL; None while blocking is off or the engine is not ready.
pub fn page_rules(url: &str) -> Option<PageRules> {
    if !ENABLED.load(Ordering::SeqCst) {
        return None;
    }
    let resources = ENGINE.get()?.url_cosmetic_resources(url);
    let mut selectors: Vec<String> = resources.hide_selectors.into_iter().collect();
    selectors.sort();
    Some(PageRules {
        css: hide_css(&selectors),
        exceptions: resources.exceptions,
        generichide: resources.generichide,
        script: resources.injected_script,
    })
}

/// Generic hide rules for the classes and ids a page uses, less the page's exceptions.
pub fn generic_css(classes: &[String], ids: &[String], exceptions: &HashSet<String>) -> String {
    match ENGINE.get() {
        Some(engine) => hide_css(&engine.hidden_class_id_selectors(classes, ids, exceptions)),
        None => String::new(),
    }
}

fn hide_css(selectors: &[String]) -> String {
    selectors
        .iter()
        .map(|selector| format!("{selector} {{ display: none !important; }}\n"))
        .collect()
}

/// Script that sets the one cosmetic style element of the page to `css`.
pub fn style_script(css: &str) -> String {
    let text = serde_json::to_string(css).unwrap_or_else(|_| "\"\"".to_owned());
    format!(
        "(() => {{ let el = document.getElementById('{STYLE_ID}'); if (!el) {{ el = document.createElement('style'); el.id = '{STYLE_ID}'; (document.head || document.documentElement).appendChild(el); }} el.textContent = {text}; return true; }})()"
    )
}

/// Maps a WebView2 resource context to the request type the engine's rules use.
#[cfg(any(windows, test))]
fn request_type(context: i32) -> &'static str {
    match context {
        2 => "stylesheet",
        3 => "image",
        4 => "media",
        5 => "font",
        6 => "script",
        7 | 8 => "xmlhttprequest",
        11 => "websocket",
        14 => "ping",
        _ => "other",
    }
}

/// Hooks WebView2 requests of one pane webview. Top-level documents are left to the page's own policy.
#[cfg(windows)]
pub fn install(webview: &tauri::Webview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, ICoreWebView2,
        ICoreWebView2WebResourceRequestedEventArgs,
    };
    use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
    use windows::core::{HSTRING, PWSTR};

    const DOCUMENT_CONTEXT: i32 = 1;

    let _ = webview.with_webview(move |platform| {
        let environment = platform.environment();
        let controller = platform.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            return;
        };
        let handler = WebResourceRequestedEventHandler::create(Box::new(
            move |sender: Option<ICoreWebView2>,
                  args: Option<ICoreWebView2WebResourceRequestedEventArgs>| {
                let (Some(sender), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let mut context = Default::default();
                if unsafe { args.ResourceContext(&mut context) }.is_err()
                    || context.0 == DOCUMENT_CONTEXT
                {
                    return Ok(());
                }
                let mut target = PWSTR::null();
                let Ok(request) = (unsafe { args.Request() }) else {
                    return Ok(());
                };
                if unsafe { request.Uri(&mut target) }.is_err() {
                    return Ok(());
                }
                let url = take_pwstr(target);
                let mut page = PWSTR::null();
                let source = if unsafe { sender.Source(&mut page) }.is_ok() {
                    take_pwstr(page)
                } else {
                    String::new()
                };
                if should_block(&url, &source, request_type(context.0)) {
                    block(&environment, &args);
                }
                Ok(())
            },
        ));
        let mut token = 0i64;
        unsafe {
            let _ = core.AddWebResourceRequestedFilter(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            );
            let _ = core.add_WebResourceRequested(&handler, &mut token);
        }
    });
}

/// Answers the request with a 403 and no body, so the page sees a refused resource.
#[cfg(windows)]
fn block(
    environment: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequestedEventArgs,
) {
    use windows::core::w;
    if let Ok(response) =
        unsafe { environment.CreateWebResourceResponse(None, 403, w!("Forbidden"), w!("")) }
    {
        let _ = unsafe { args.SetResponse(&response) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matcher_blocks_listed_hosts_and_passes_exceptions() {
        let mut set = FilterSet::new(false);
        set.add_filter_list(
            "||ads.example^\n@@||ads.example/allowed^\n".to_owned(),
            ParseOptions::default(),
        );
        let engine = Engine::new_with_filter_set(set);
        let check = |url: &str| {
            let request =
                Request::new(url, "https://site.test/", "script", "GET").expect("request");
            engine.check_network_request(&request).should_block()
        };
        assert!(check("https://ads.example/banner.js"));
        assert!(!check("https://ads.example/allowed/x.js"));
        assert!(!check("https://site.test/app.js"));
    }

    #[test]
    fn hide_rules_become_one_display_none_rule_each() {
        let css = hide_css(&[".ad".to_owned(), "#promo".to_owned()]);
        assert_eq!(
            css,
            ".ad { display: none !important; }\n#promo { display: none !important; }\n"
        );
    }

    #[test]
    fn style_script_quotes_the_css_as_one_string() {
        let script = style_script("a[x=\"</style>\"] { }");
        assert!(script.contains("\\\"</style>\\\""));
        assert!(script.contains(STYLE_ID));
    }

    #[test]
    fn resource_contexts_map_to_rule_types() {
        assert_eq!(request_type(6), "script");
        assert_eq!(request_type(7), "xmlhttprequest");
        assert_eq!(request_type(99), "other");
    }
}
