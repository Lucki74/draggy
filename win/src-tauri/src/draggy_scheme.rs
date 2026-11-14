//! The `draggy` scheme: created pictures, site icons and cached model files for the renderer. Ports Electron's
//! `protocol.handle("draggy")` (main.cjs serveCachedModelFile, imageIpc.cjs, favicon.cjs, modelCache.cjs).

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_models::download::{Body, HttpClient, Reply, ReqwestBody, ReqwestClient, read_all};
use regex::Regex;
use tauri::http::{Response, header};
use tauri::{AppHandle, Manager, UriSchemeResponder, Url};

use crate::AppState;
use crate::engines::sd::created_mime;
use crate::ipc::files::created_dir;

const MODEL_ORIGIN: &str = "https://huggingface.co";
const ICON_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ICON_BYTES: usize = 256 * 1024;
const ICON_PAGE_CHARS: usize = 60_000;
const ICON_CACHE_SECONDS: u32 = 604_800;
const REDIRECT_LIMIT: usize = 20;
/// Hosts whose icons come from another name, as Electron's HOST_ALIASES.
const HOST_ALIASES: &[(&str, &str)] = &[("spotify.com", "open.spotify.com")];

#[derive(Debug, PartialEq, Eq)]
enum Route {
    Favicon(String),
    Images(String),
    Models(String),
    Unknown,
}

/// Answers one `draggy://` request. The work runs off the webview thread: a model may be downloaded first.
pub fn handle(app: AppHandle, uri: String, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        let response = serve(&app, &uri).await;
        responder.respond(response);
    });
}

async fn serve(app: &AppHandle, uri: &str) -> Response<Vec<u8>> {
    let data = app.state::<AppState>().storage.data_dir().to_path_buf();
    match route(uri) {
        Route::Images(name) => serve_created(&created_dir(&data), &name),
        Route::Favicon(host) => favicon(app, &data.join("favicon-cache"), &host).await,
        Route::Models(relative) => model(app, &data.join("model-cache"), &relative).await,
        Route::Unknown => text(404, "Not found"),
    }
}

/// The host picks the kind on draggy://<kind>/; WebView2 asks http://draggy.localhost/<kind>/, which Tauri hands over as draggy://localhost/<kind>/.
fn route(uri: &str) -> Route {
    let Some((_, rest)) = uri.split_once("://") else {
        return Route::Unknown;
    };
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (kind, tail) = if host.eq_ignore_ascii_case("draggy.localhost") || host.eq_ignore_ascii_case("localhost") {
        path.split_once('/').unwrap_or((path, ""))
    } else {
        (host, path)
    };
    let Some(name) = percent_decode(tail).map(|decoded| decoded.trim_start_matches('/').to_owned())
    else {
        return Route::Unknown;
    };
    match kind {
        "favicon" => Route::Favicon(name),
        "images" => Route::Images(name),
        "models" => Route::Models(name),
        _ => Route::Unknown,
    }
}

fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A picture the chat made, from the created-files folder: a bare name of an allowed type, nothing else.
fn serve_created(dir: &Path, name: &str) -> Response<Vec<u8>> {
    let Some(content_type) = created_mime(name) else {
        return text(400, "Bad request");
    };
    if name.is_empty() || name.contains(['/', '\\']) {
        return text(400, "Bad request");
    }
    let target = dir.join(name);
    if !target.is_file() {
        return text(404, "Not found");
    }
    match fs::read(&target) {
        Ok(bytes) => respond(200, content_type, bytes),
        Err(_) => text(500, "Read failed"),
    }
}

/// The cached path for a model file, lexically resolved; None when it would leave the cache folder.
fn cached_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut kept: Vec<&str> = Vec::new();
    for part in Path::new(relative).components() {
        match part {
            Component::Normal(name) => kept.push(name.to_str()?),
            Component::CurDir => {}
            Component::ParentDir => {
                kept.pop()?;
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if kept.is_empty() {
        return None;
    }
    Some(
        kept.iter()
            .fold(root.to_path_buf(), |path, part| path.join(part)),
    )
}

async fn model(app: &AppHandle, root: &Path, relative: &str) -> Response<Vec<u8>> {
    let Some(target) = cached_path(root, relative) else {
        return text(400, "Bad request");
    };
    if target.exists() {
        return match fs::read(&target) {
            Ok(bytes) => model_response(relative, bytes),
            Err(_) => text(500, "Read failed"),
        };
    }
    let Some(client) = client() else {
        return text(502, "Upstream unreachable");
    };
    let Some(mut reply) = fetch(app, client, &format!("{MODEL_ORIGIN}/{relative}"), None).await
    else {
        return text(502, "Upstream unreachable");
    };
    if !(200..300).contains(&reply.status) {
        return text(reply.status, "Fetch refused");
    }
    let Ok(bytes) = read_all(&mut reply.body).await else {
        return text(502, "Download failed");
    };
    store(&target, &bytes);
    model_response(relative, bytes)
}

/// Writes beside the final name and renames once whole, so a cut download never reads as cached. Best effort.
fn store(target: &Path, bytes: &[u8]) {
    let Some(parent) = target.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let partial = PathBuf::from(format!(
        "{}.{}-{nanos}.part",
        target.display(),
        std::process::id()
    ));
    if fs::write(&partial, bytes).is_ok() && fs::rename(&partial, target).is_err() {
        let _ = fs::remove_file(&partial);
    }
}

fn model_response(relative: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let content_type = match Path::new(relative).extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("json") => "application/json",
        Some(ext) if ext.eq_ignore_ascii_case("txt") => "text/plain",
        _ => "application/octet-stream",
    };
    respond(200, content_type, bytes)
}

async fn favicon(app: &AppHandle, cache_dir: &Path, hostname: &str) -> Response<Vec<u8>> {
    if !is_valid_hostname(hostname) {
        return text(400, "Bad request");
    }
    let host = HOST_ALIASES
        .iter()
        .find(|(from, _)| *from == hostname)
        .map_or(hostname, |(_, to)| to);
    let cached = cache_dir.join(format!("{host}.icon"));
    let bytes = match fs::read(&cached) {
        Ok(known) => (!known.is_empty()).then_some(known),
        Err(_) => {
            let fetched = fetch_icon(app, host).await;
            let _ = fs::create_dir_all(cache_dir);
            let _ = fs::write(&cached, fetched.as_deref().unwrap_or_default());
            fetched
        }
    };
    match bytes {
        Some(bytes) => {
            let content_type = sniff_image_type(&bytes).unwrap_or("image/x-icon");
            let builder = Response::builder()
                .status(200)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CACHE_CONTROL,
                    format!("max-age={ICON_CACHE_SECONDS}"),
                );
            with_common(builder, bytes)
        }
        // 204 keeps a site without an icon out of the console as a failed request.
        None => respond(204, "text/plain; charset=utf-8", Vec::new()),
    }
}

/// The icon a host declares, asked of the site itself: /favicon.ico first, then the page's own link tags.
async fn fetch_icon(app: &AppHandle, host: &str) -> Option<Vec<u8>> {
    let origin = format!("https://{host}");
    if let Some(bytes) = icon_at(app, &format!("{origin}/favicon.ico")).await {
        return Some(bytes);
    }
    for url in declared_icon_urls(app, &origin).await {
        if let Some(bytes) = icon_at(app, &url).await {
            return Some(bytes);
        }
    }
    None
}

async fn icon_at(app: &AppHandle, url: &str) -> Option<Vec<u8>> {
    let mut reply = fetch(app, client()?, url, Some(ICON_TIMEOUT)).await?;
    if !(200..300).contains(&reply.status) {
        return None;
    }
    let bytes = read_capped(&mut reply.body, MAX_ICON_BYTES).await?;
    sniff_image_type(&bytes).map(|_| bytes)
}

async fn declared_icon_urls(app: &AppHandle, origin: &str) -> Vec<String> {
    let Some(client) = client() else {
        return Vec::new();
    };
    let Some(mut reply) = fetch(app, client, origin, Some(ICON_TIMEOUT)).await else {
        return Vec::new();
    };
    if !(200..300).contains(&reply.status) {
        return Vec::new();
    }
    let Ok(bytes) = read_all(&mut reply.body).await else {
        return Vec::new();
    };
    let page: String = String::from_utf8_lossy(&bytes)
        .chars()
        .take(ICON_PAGE_CHARS)
        .collect();
    let Ok(base) = Url::parse(origin) else {
        return Vec::new();
    };
    let mut urls = Vec::new();
    for tag in link_icon_re().find_iter(&page) {
        let Some(mut href) = href_of(tag.as_str()) else {
            continue;
        };
        // A bare value swallows the slash of a self-closing tag; no icon path ends in one.
        if href.ends_with('/') {
            href.pop();
        }
        if href.is_empty() {
            continue;
        }
        if let Ok(joined) = base.join(&href) {
            urls.push(joined.to_string());
        }
        if urls.len() >= 3 {
            break;
        }
    }
    urls
}

fn href_of(tag: &str) -> Option<String> {
    let caps = href_re().captures(tag)?;
    caps.get(1)
        .or(caps.get(2))
        .or(caps.get(3))
        .map(|value| value.as_str().to_owned())
}

fn link_icon_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)<link\b[^>]*\brel\s*=\s*(?:"[^"]*\bicon\b[^"]*"|'[^']*\bicon\b[^']*'|[^\s"'>]*icon[^\s>]*)[^>]*>"#)
            .expect("the icon link pattern is valid")
    })
}

fn href_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#)
            .expect("the href pattern is valid")
    })
}

fn hostname_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^[a-z0-9][a-z0-9.-]{0,253}$").expect("the hostname pattern is valid")
    })
}

fn is_valid_hostname(hostname: &str) -> bool {
    hostname_re().is_match(hostname) && !hostname.contains("..")
}

/// The format of an image, sniffed from its bytes rather than trusted, so an HTML error page is never an icon.
fn sniff_image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }
    if bytes[0] == 0x89 && bytes[1] == 0x50 {
        return Some("image/png");
    }
    if bytes[0] == 0x47 && bytes[1] == 0x49 {
        return Some("image/gif");
    }
    if bytes[0] == 0xff && bytes[1] == 0xd8 {
        return Some("image/jpeg");
    }
    if bytes[..3] == [0x00, 0x00, 0x01] {
        return Some("image/x-icon");
    }
    if bytes[..3] == [0x52, 0x49, 0x46] {
        return Some("image/webp");
    }
    let head = &bytes[..bytes.len().min(300)];
    head.windows(4)
        .any(|window| window == b"<svg")
        .then_some("image/svg+xml")
}

/// One GET that follows redirects by hand, so every hop passes the URL policy. None on refusal or no answer.
async fn fetch(
    app: &AppHandle,
    client: &ReqwestClient,
    first: &str,
    stall: Option<Duration>,
) -> Option<Reply<ReqwestBody>> {
    let mut url = first.to_owned();
    for _ in 0..=REDIRECT_LIMIT {
        if !allowed(app, &url) {
            return None;
        }
        let reply = client.get(&url, &[], stall).await.ok()?;
        if !(300..400).contains(&reply.status) {
            return Some(reply);
        }
        let Some(location) = reply.header("location").map(str::to_owned) else {
            return Some(reply);
        };
        url = Url::parse(&url).ok()?.join(&location).ok()?.to_string();
    }
    None
}

fn allowed(app: &AppHandle, url: &str) -> bool {
    let state = app.state::<AppState>();
    let mut policy = state
        .engines
        .policy
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    policy.is_fetchable_url(url, false)
}

fn client() -> Option<&'static ReqwestClient> {
    static CLIENT: OnceLock<Option<ReqwestClient>> = OnceLock::new();
    CLIENT.get_or_init(|| ReqwestClient::new().ok()).as_ref()
}

async fn read_capped(body: &mut ReqwestBody, cap: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    while let Some(chunk) = body.next_chunk().await.ok()? {
        if out.len() + chunk.len() > cap {
            return None;
        }
        out.extend_from_slice(&chunk);
    }
    Some(out)
}

/// A whole answer with the headers every one carries, as Electron's RESOURCE_HEADERS.
fn respond(status: u16, content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type);
    with_common(builder, bytes)
}

fn with_common(builder: tauri::http::response::Builder, bytes: Vec<u8>) -> Response<Vec<u8>> {
    builder
        .header(header::CONTENT_LENGTH, bytes.len())
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cross-Origin-Embedder-Policy", "credentialless")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn text(status: u16, body: &str) -> Response<Vec<u8>> {
    respond(
        status,
        "text/plain; charset=utf-8",
        body.as_bytes().to_vec(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_picks_the_kind_in_both_address_forms() {
        assert_eq!(
            route("draggy://images/a%20b.png"),
            Route::Images("a b.png".into())
        );
        assert_eq!(
            route("http://draggy.localhost/favicon/example.com"),
            Route::Favicon("example.com".into())
        );
        assert_eq!(
            route("draggy://localhost/favicon/example.com"),
            Route::Favicon("example.com".into())
        );
        assert_eq!(
            route("draggy://models/onnx/model.onnx?x=1"),
            Route::Models("onnx/model.onnx".into())
        );
    }

    #[test]
    fn an_unknown_host_is_not_found() {
        assert_eq!(route("draggy://nowhere/a.png"), Route::Unknown);
        assert_eq!(text(404, "Not found").status(), 404);
    }

    #[test]
    fn path_traversal_is_refused_for_models() {
        let root = Path::new("/cache");
        assert_eq!(cached_path(root, "../secret.json"), None);
        assert_eq!(cached_path(root, "a/../../secret.json"), None);
        assert_eq!(cached_path(root, ""), None);
        assert_eq!(cached_path(root, "a/../b.json"), Some(root.join("b.json")));
    }

    #[test]
    fn a_bare_picture_of_an_allowed_type_is_served() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::write(dir.path().join("fox.png"), b"\x89PNG-bytes").expect("write");
        let served = serve_created(dir.path(), "fox.png");
        assert_eq!(served.status(), 200);
        assert_eq!(served.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(served.body().as_slice(), b"\x89PNG-bytes");
        assert_eq!(serve_created(dir.path(), "../fox.png").status(), 400);
        assert_eq!(serve_created(dir.path(), "notes.txt").status(), 400);
        assert_eq!(serve_created(dir.path(), "missing.png").status(), 404);
    }

    #[test]
    fn a_cached_model_is_served_whole_even_for_a_range_request() {
        // Electron never answered ranges, so the renderer reads the whole file from this host.
        let dir = tempfile::tempdir().expect("a temp folder");
        let file = cached_path(dir.path(), "tokenizer.json").expect("a path");
        fs::write(&file, b"{\"a\":1}").expect("write");
        let served = model_response("tokenizer.json", fs::read(&file).expect("read"));
        assert_eq!(served.status(), 200);
        assert_eq!(served.headers()[header::CONTENT_TYPE], "application/json");
        assert_eq!(served.body().as_slice(), b"{\"a\":1}");
    }

    #[test]
    fn icons_are_sniffed_and_hostnames_checked() {
        assert_eq!(sniff_image_type(b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(sniff_image_type(b"<html>"), None);
        assert!(sniff_image_type(b"<svg xmlns").is_some());
        assert!(is_valid_hostname("example.com"));
        assert!(!is_valid_hostname("a..b"));
        assert!(!is_valid_hostname("-bad"));
    }

    #[test]
    fn icon_links_are_read_from_a_page() {
        let tag = r#"<link rel="shortcut icon" href="/static/i.png">"#;
        assert_eq!(href_of(tag).as_deref(), Some("/static/i.png"));
        assert!(link_icon_re().is_match(tag));
        assert!(!link_icon_re().is_match(r#"<link rel="stylesheet" href="/s.css">"#));
    }
}
