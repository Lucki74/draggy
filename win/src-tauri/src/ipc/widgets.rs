//! MCP Apps widgets: markup from a server, staged for an isolated frame. Each widget is
//! served from widget://<token>/ under a no-network policy, so it can show only what it was given.

use std::borrow::Cow;
use std::sync::{Arc, Mutex, PoisonError};

use draggy_diagnostics::Diagnostics;
use serde_json::{Value, json};
use tauri::http::Response;
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry};
use crate::AppState;

/// How much markup a widget may be before it is treated as a mistake.
const MAX_WIDGET_CHARS: usize = 256 * 1024;
/// How many widgets stay reachable at once. Oldest goes when the room runs out.
const MAX_STAGED: usize = 32;

/// The content policy. `default-src 'none'` keeps a widget from fetching or sending anything off the machine.
const WIDGET_BODY_POLICY: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";
/// The header adds frame-ancestors, which a meta tag cannot carry: only the app's own pages may frame a widget.
/// The dev server's origin is allowed in debug builds only.
fn widget_policy() -> String {
    let mut policy = format!("{WIDGET_BODY_POLICY}; frame-ancestors http://tauri.localhost");
    if cfg!(debug_assertions) {
        policy.push_str(" http://127.0.0.1:5173");
    }
    policy
}

/// The address the renderer loads a widget from: WebView2 serves custom schemes as http://<scheme>.localhost.
fn widget_url(token: &str) -> String {
    if cfg!(windows) {
        format!("http://widget.localhost/{token}/")
    } else {
        format!("widget://{token}/")
    }
}

const WIDGET_HEAD: &str = "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n\
<meta http-equiv=\"Content-Security-Policy\" content=\"";
const WIDGET_STYLE: &str = "\">\n<style>\n  :root { color-scheme: light dark; }\n  \
body { margin: 0; padding: 12px; font: 14px system-ui, sans-serif; }\n</style>\n</head>\n<body>\n";
/// Tells the app how much room the widget needs, so the frame is the widget's own size rather than a guess.
const WIDGET_TAIL: &str = "\n<script>\n  var report = function () {\n    parent.postMessage(\n      \
{ type: \"resize\", height: document.documentElement.scrollHeight },\n      \"*\",\n    );\n  };\n  \
new ResizeObserver(report).observe(document.documentElement);\n  report();\n</script>\n</body>\n</html>";

/// token -> the document served at widget://token/, oldest first.
static STAGED: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

pub struct Staged {
    pub token: String,
    pub url: String,
}

pub fn register_all(registry: &mut Registry) {
    register!(registry, "widget:stage" => stage_channel);
    register!(registry, "widget:release" => release_channel);
}

async fn stage_channel(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let html = args.first().and_then(Value::as_str).unwrap_or_default();
    let diag = diagnostics(&app);
    Ok(match stage(html) {
        Ok(staged) => {
            diag.info(
                "mcp.widgets",
                "widget staged",
                Some(json!({ "chars": html.chars().count() })),
            );
            json!({ "success": true, "token": staged.token, "url": staged.url })
        }
        Err(reason) => {
            diag.warn(
                "mcp.widgets",
                "widget refused",
                Some(json!({ "reason": reason })),
            );
            json!({ "success": false })
        }
    })
}

async fn release_channel(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let token = args.first().and_then(Value::as_str).unwrap_or_default();
    let removed = release(token);
    if removed {
        diagnostics(&app).info("mcp.widgets", "widget released", None);
    }
    Ok(json!({ "success": removed }))
}

fn diagnostics(app: &AppHandle) -> Arc<Diagnostics> {
    Arc::clone(&app.state::<AppState>().diag)
}

/// Puts a widget where the frame can load it from. The token is the host, so no two widgets share an origin.
pub fn stage(html: &str) -> Result<Staged, &'static str> {
    if html.trim().is_empty() {
        return Err("empty");
    }
    if html.chars().count() > MAX_WIDGET_CHARS {
        return Err("too large");
    }
    let token = new_token().ok_or("no randomness")?;
    let document = wrap_widget(html);
    let mut staged = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    admit(&mut staged, &token, document);
    Ok(Staged {
        url: widget_url(&token),
        token,
    })
}

/// Forgets a widget, so a reply scrolled out of sight stops being reachable. False when it was not staged.
pub fn release(token: &str) -> bool {
    let mut staged = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    forget_token(&mut staged, token)
}

/// Serves a staged widget at its address, and nothing else: there is no path to traverse.
pub fn serve(uri: &str) -> Response<Cow<'static, [u8]>> {
    let staged = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    respond(&staged, uri)
}

/// Adds a document, evicting the oldest while more than MAX_STAGED are kept.
fn admit(staged: &mut Vec<(String, String)>, token: &str, document: String) {
    staged.push((token.to_owned(), document));
    while staged.len() > MAX_STAGED {
        staged.remove(0);
    }
}

fn forget_token(staged: &mut Vec<(String, String)>, token: &str) -> bool {
    let before = staged.len();
    staged.retain(|(known, _)| known != token);
    staged.len() != before
}

fn respond(staged: &[(String, String)], uri: &str) -> Response<Cow<'static, [u8]>> {
    let document = token_from_uri(uri)
        .and_then(|token| staged.iter().find(|(known, _)| *known == token))
        .map(|(_, document)| document.clone());
    match document {
        Some(document) => Response::builder()
            .status(200)
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", widget_policy())
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .header("Access-Control-Allow-Headers", "*")
            .header("Cross-Origin-Resource-Policy", "cross-origin")
            .header("Cross-Origin-Embedder-Policy", "credentialless")
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(document.into_bytes()))
            .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..]))),
        None => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(Cow::Borrowed(b"No such widget".as_slice()))
            .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..]))),
    }
}

/// The token a widget address names: its host under widget://, or its first path part under the http form the
/// webview uses on Windows. Anything that is not 32 hex digits is no token at all.
fn token_from_uri(uri: &str) -> Option<String> {
    let rest = uri.split_once("://")?.1;
    let rest = rest.split(['?', '#']).next()?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let token = if host.eq_ignore_ascii_case("widget.localhost") {
        path.split('/').next()?
    } else {
        host
    };
    let valid = token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then(|| token.to_ascii_lowercase())
}

fn new_token() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The document a widget is put inside: its markup, the no-network policy, and the height report.
pub fn wrap_widget(html: &str) -> String {
    let mut document = String::with_capacity(html.len() + 1024);
    document.push_str(WIDGET_HEAD);
    document.push_str(WIDGET_BODY_POLICY);
    document.push_str(WIDGET_STYLE);
    document.push_str(html);
    document.push_str(WIDGET_TAIL);
    document
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn refuses_empty_and_oversized_markup() {
        assert_eq!(stage("   ").err(), Some("empty"));
        let big = "x".repeat(MAX_WIDGET_CHARS + 1);
        assert_eq!(stage(&big).err(), Some("too large"));
    }

    #[test]
    fn oldest_widget_goes_when_the_room_runs_out() {
        let mut staged = Vec::new();
        for index in 0..=MAX_STAGED {
            admit(&mut staged, &format!("t{index}"), String::new());
        }
        assert_eq!(staged.len(), MAX_STAGED);
        assert_eq!(staged[0].0, "t1");
    }

    #[test]
    fn release_reports_whether_it_removed_anything() {
        let mut staged = vec![(TOKEN.to_owned(), String::new())];
        assert!(!forget_token(&mut staged, "missing"));
        assert!(forget_token(&mut staged, TOKEN));
        assert!(staged.is_empty());
    }

    #[test]
    fn addresses_name_their_token_in_both_forms() {
        assert_eq!(
            token_from_uri(&format!("widget://{TOKEN}/")).as_deref(),
            Some(TOKEN)
        );
        assert_eq!(
            token_from_uri(&format!("http://widget.localhost/{TOKEN}/?x=1")).as_deref(),
            Some(TOKEN)
        );
        assert_eq!(token_from_uri("widget://../etc/passwd"), None);
        assert_eq!(token_from_uri(&format!("widget://{TOKEN}x/")), None);
    }

    #[test]
    fn unknown_widgets_are_not_found_and_known_ones_are_served_under_policy() {
        let staged = vec![(TOKEN.to_owned(), wrap_widget("<p>hi</p>"))];
        let missing = respond(&staged, "widget://ffffffffffffffffffffffffffffffff/");
        assert_eq!(missing.status(), 404);
        assert_eq!(missing.body().as_ref(), b"No such widget");

        let found = respond(&staged, &format!("widget://{TOKEN}/"));
        assert_eq!(found.status(), 200);
        assert_eq!(
            found
                .headers()
                .get("Content-Security-Policy")
                .and_then(|v| v.to_str().ok()),
            Some(widget_policy().as_str())
        );
        let body = String::from_utf8_lossy(found.body());
        assert!(body.contains("<p>hi</p>"));
        assert!(body.contains("ResizeObserver"));
    }
}
