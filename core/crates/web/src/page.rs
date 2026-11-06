//! The readable text of a fetched page: its title and body text, without scripts, styles or page chrome.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::time::Duration;

use encoding_rs::{Encoding, UTF_8};
use scraper::{ElementRef, Html, Node, Selector};
use serde_json::Value;
use url::Url;

use crate::http::HttpError;
use crate::policy::{UrlPolicy, refusal_for};
use crate::readable;
use crate::search::DESKTOP_USER_AGENT;

/// Tags whose text is never part of what a reader sees.
const SKIPPED: [&str; 9] = [
    "script", "style", "noscript", "template", "svg", "head", "iframe", "nav", "footer",
];
/// Tags that start a new line.
const BLOCKS: [&str; 22] = [
    "p",
    "div",
    "section",
    "article",
    "main",
    "header",
    "li",
    "ul",
    "ol",
    "br",
    "tr",
    "table",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "blockquote",
    "form",
    "dd",
];

/// The title and the visible text of an HTML page, one block per line.
pub fn page_text(html: &str) -> (String, String) {
    let document = Html::parse_document(html);
    let title = Selector::parse("title")
        .ok()
        .and_then(|selector| document.select(&selector).next())
        .map(|node| collapse(&node.text().collect::<String>()))
        .unwrap_or_default();
    let mut out = String::new();
    let body = Selector::parse("body")
        .ok()
        .and_then(|selector| document.select(&selector).next());
    if let Some(body) = body {
        walk(body, &mut out);
    }
    let lines: Vec<String> = out
        .lines()
        .map(collapse)
        .filter(|line| !line.is_empty())
        .collect();
    (title, lines.join("\n"))
}

fn walk(element: ElementRef<'_>, out: &mut String) {
    let name = element.value().name();
    if SKIPPED.contains(&name) {
        return;
    }
    let block = BLOCKS.contains(&name);
    if block {
        out.push('\n');
    }
    for child in element.children() {
        match child.value() {
            Node::Text(text) => out.push_str(text),
            Node::Element(_) => {
                if let Some(child) = ElementRef::wrap(child) {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
    if block {
        out.push('\n');
    }
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}


// Page reading for read_url, ported from electron/pageExtract.cjs: metadata, script-shell detection, paging and the
// fetch-first flow. There is no hidden browser here, so a page that needs scripts comes back with a note instead.

/// Characters per page of a long read.
pub const PAGE_SIZE: usize = 12_000;
/// Fewer characters of Markdown than this and the page may be a script shell.
pub const MIN_TEXT: usize = 500;
const MAX_HTML_BYTES: usize = 4 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 30 * 1024 * 1024;
const MAX_HOPS: usize = 5;
/// The most pages the paging cache holds.
pub const CACHE_LIMIT: usize = 24;
/// How long a cached read stays valid, in milliseconds.
pub const CACHE_TTL_MS: u64 = 30 * 60 * 1000;
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const ACCEPT: &str = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5";
/// Said after a read whose page builds its content with scripts.
const BROWSER_NOTE: &str = "This page builds much of its content with scripts and Draggy has no browser to run them here, so the text may be incomplete. If it is not enough, tell the user the page needs to be opened in a browser.";

/// The title, site, author, dates, language and canonical link of a page. Every field may be missing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PageMeta {
    pub title: Option<String>,
    pub site: Option<String>,
    pub author: Option<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub language: Option<String>,
    pub canonical: Option<String>,
}

fn replace_numeric(text: &str, hex: bool) -> String {
    let radix = if hex { 16 } else { 10 };
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("&#") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let body = if hex {
            after.strip_prefix(['x', 'X'])
        } else {
            Some(after)
        };
        let decoded = body.and_then(|body| {
            let digits = body.find(|c: char| !c.is_digit(radix)).unwrap_or(body.len());
            if digits == 0 || !body[digits..].starts_with(';') {
                return None;
            }
            let ch = char::from_u32(u32::from_str_radix(&body[..digits], radix).ok()?)?;
            Some((ch, after.len() - body.len() + digits + 1))
        });
        if let Some((ch, used)) = decoded {
            out.push(ch);
            rest = &after[used..];
        } else {
            out.push_str("&#");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// Decodes the entities the CJS decodes, in its order, so `&amp;lt;` becomes `&lt;` and no further.
fn decode_entities(value: &str) -> String {
    replace_numeric(&replace_numeric(value, true), false)
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn tidy(text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// A value from a parsed attribute or tag text, which the HTML parser has already decoded.
fn clean(value: Option<&str>) -> Option<String> {
    value.and_then(tidy)
}

/// A value from JSON-LD, which sits in a script and is decoded here.
fn clean_json(value: Option<&Value>) -> Option<String> {
    let text = match value? {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    tidy(&decode_entities(&text))
}

fn select_all<'a>(document: &'a Html, css: &str) -> Vec<ElementRef<'a>> {
    Selector::parse(css)
        .map(|selector| document.select(&selector).collect())
        .unwrap_or_default()
}

fn meta_map(document: &Html) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for tag in select_all(document, "meta") {
        let value = tag.value();
        let key = ["property", "name", "itemprop"]
            .iter()
            .filter_map(|name| value.attr(name))
            .find(|text| !text.is_empty())
            .unwrap_or("")
            .to_lowercase();
        if let (false, Some(content)) = (key.is_empty(), value.attr("content")) {
            map.entry(key).or_insert_with(|| content.to_owned());
        }
    }
    map
}

/// Every object in every JSON-LD block, nested `@graph` entries after their parent, breadth first.
fn json_ld_nodes(document: &Html) -> Vec<Value> {
    let mut nodes = Vec::new();
    for script in select_all(document, "script") {
        let is_ld = script
            .value()
            .attr("type")
            .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/ld+json"));
        if !is_ld {
            continue;
        }
        let text: String = script.text().collect();
        let Ok(data) = serde_json::from_str::<Value>(text.trim()) else {
            continue;
        };
        let mut queue = VecDeque::from([data]);
        while let Some(item) = queue.pop_front() {
            match item {
                Value::Array(items) => queue.extend(items),
                Value::Object(object) => {
                    if let Some(graph) = object.get("@graph").filter(|graph| !graph.is_null()) {
                        queue.push_back(graph.clone());
                    }
                    nodes.push(Value::Object(object));
                }
                _ => {}
            }
        }
    }
    nodes
}

fn types_of(node: &Value) -> Vec<String> {
    match node.get("@type") {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| item.as_str().map_or_else(|| item.to_string(), str::to_owned))
            .collect(),
        Some(Value::String(kind)) => vec![kind.clone()],
        _ => Vec::new(),
    }
}

fn has_type(node: &Value, wanted: &[&str]) -> bool {
    types_of(node)
        .iter()
        .any(|kind| wanted.contains(&kind.as_str()))
}

fn name_of(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Array(items) => {
            let names: Vec<String> = items.iter().filter_map(|item| name_of(Some(item))).collect();
            (!names.is_empty()).then(|| names.join(", "))
        }
        Value::Object(object) => clean_json(object.get("name")),
        other => clean_json(Some(other)),
    }
}

fn resolve_url(value: &str, base: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    match Url::parse(base) {
        Ok(base) => base.join(value).ok(),
        Err(_) => Url::parse(value).ok(),
    }
    .map(String::from)
}

const ARTICLE_TYPES: [&str; 9] = [
    "Article",
    "NewsArticle",
    "BlogPosting",
    "ScholarlyArticle",
    "TechArticle",
    "Report",
    "WebPage",
    "ReportageNewsArticle",
    "LiveBlogPosting",
];
const ORG_TYPES: [&str; 3] = ["Organization", "NewsMediaOrganization", "WebSite"];

/// Title, site, author, dates, language and canonical URL. JSON-LD wins over OpenGraph, then plain meta.
pub fn extract_metadata(html: &str, page_url: &str) -> PageMeta {
    let document = Html::parse_document(html);
    let meta = meta_map(&document);
    let nodes = json_ld_nodes(&document);
    let null = Value::Null;
    let node = nodes
        .iter()
        .find(|node| has_type(node, &ARTICLE_TYPES))
        .unwrap_or(&null);
    let org = nodes.iter().find(|node| has_type(node, &ORG_TYPES));
    let field = |key: &str| clean_json(node.get(key));
    let tagged = |key: &str| clean(meta.get(key).map(String::as_str));

    let title_tag = select_all(&document, "title")
        .first()
        .and_then(|tag| clean(Some(tag.text().collect::<String>().as_str())));
    let canonical_href = select_all(&document, "link").into_iter().find_map(|tag| {
        let rel = tag.value().attr("rel").unwrap_or("");
        rel.split_whitespace()
            .any(|word| word.eq_ignore_ascii_case("canonical"))
            .then(|| tag.value().attr("href"))
            .flatten()
    });
    let lang = select_all(&document, "html")
        .first()
        .and_then(|tag| clean(tag.value().attr("lang")));

    PageMeta {
        title: field("headline")
            .or_else(|| field("name"))
            .or_else(|| tagged("og:title"))
            .or_else(|| tagged("twitter:title"))
            .or(title_tag),
        site: name_of(node.get("publisher"))
            .or_else(|| clean_json(org.and_then(|org| org.get("name"))))
            .or_else(|| tagged("og:site_name"))
            .or_else(|| tagged("application-name")),
        author: name_of(node.get("author"))
            .or_else(|| tagged("author"))
            .or_else(|| tagged("article:author"))
            .or_else(|| tagged("dc.creator")),
        published: field("datePublished")
            .or_else(|| tagged("article:published_time"))
            .or_else(|| tagged("datepublished"))
            .or_else(|| tagged("date"))
            .or_else(|| tagged("pubdate"))
            .or_else(|| tagged("dc.date")),
        modified: field("dateModified")
            .or_else(|| tagged("article:modified_time"))
            .or_else(|| tagged("og:updated_time"))
            .or_else(|| tagged("datemodified"))
            .or_else(|| tagged("last-modified")),
        language: field("inLanguage")
            .or_else(|| tagged("og:locale"))
            .or(lang),
        canonical: canonical_href
            .or_else(|| meta.get("og:url").map(String::as_str))
            .and_then(|href| resolve_url(href, page_url)),
    }
}

/// Removes every `<name ...>...</name>` block for the listed names, as the CJS regex does. Case does not matter.
fn strip_blocks(html: &str, names: &[&str]) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    while at < html.len() {
        let block = names.iter().find_map(|name| {
            let open = format!("<{name}");
            if !lower[at..].starts_with(&open) {
                return None;
            }
            let after = lower.as_bytes().get(at + open.len()).copied();
            if after.is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_') {
                return None;
            }
            let close = format!("</{name}>");
            let end = lower[at + open.len()..].find(&close)? + at + open.len() + close.len();
            Some(end)
        });
        if let Some(end) = block {
            out.push(' ');
            at = end;
        } else if let Some(ch) = html[at..].chars().next() {
            out.push(ch);
            at += ch.len_utf8();
        } else {
            break;
        }
    }
    out
}

fn strip_comments(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        let Some(len) = rest[start + 4..].find("-->") else { break };
        out.push_str(&rest[..start]);
        out.push(' ');
        rest = &rest[start + 4 + len + 3..];
    }
    out.push_str(rest);
    out
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        match rest[start + 1..].find('>') {
            Some(0) | None => {
                out.push('<');
                rest = &rest[start + 1..];
            }
            Some(len) => {
                out.push(' ');
                rest = &rest[start + 1 + len + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Text a reader would see: no scripts, styles or tags.
pub fn visible_text(html: &str) -> String {
    let blocks = strip_blocks(html, &["script", "style", "noscript", "template", "svg"]);
    let text = strip_tags(&strip_comments(&blocks));
    tidy(&decode_entities(&text)).unwrap_or_default()
}

/// A page whose content arrives through script: almost no text in the HTML and scripts to build it.
pub fn is_script_shell(html: &str) -> bool {
    html.to_ascii_lowercase().contains("<script") && visible_text(html).chars().count() < 300
}

/// Whether the fast path's Markdown is too thin to trust.
pub fn needs_render(markdown: &str, html: &str) -> bool {
    markdown.trim().chars().count() < MIN_TEXT || is_script_shell(html)
}

/// Whether a response is a PDF, by its content type first and by the address when the type says nothing.
pub fn is_pdf_source(content_type: &str, url: &str) -> bool {
    let kind = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    match kind.as_str() {
        "application/pdf" | "application/x-pdf" => true,
        "text/html" | "application/xhtml+xml" => false,
        _ => Url::parse(url).is_ok_and(|url| url.path().to_lowercase().ends_with(".pdf")),
    }
}

fn split_at_chars(text: &str, count: usize) -> (&str, &str) {
    let at = text.char_indices().nth(count).map_or(text.len(), |(at, _)| at);
    text.split_at(at)
}

fn paragraphs(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'\n' {
            let run = bytes[at..].iter().take_while(|byte| **byte == b'\n').count();
            if run >= 2 {
                parts.push(&text[start..at]);
                start = at + run;
            }
            at += run;
        } else {
            at += 1;
        }
    }
    parts.push(&text[start..]);
    parts
}

/// Splits on paragraph boundaries into pages of about `size` characters. Never returns zero pages.
pub fn split_pages(markdown: &str, size: usize) -> Vec<String> {
    let text = markdown.trim();
    if text.is_empty() {
        return vec![String::new()];
    }
    let mut pieces: Vec<String> = Vec::new();
    for paragraph in paragraphs(text) {
        if paragraph.chars().count() <= size {
            pieces.push(paragraph.to_owned());
            continue;
        }
        // An oversized paragraph breaks on lines, then on the size itself.
        let mut line = String::new();
        for part in paragraph.split('\n') {
            if !line.is_empty() && line.chars().count() + part.chars().count() + 1 > size {
                pieces.push(std::mem::take(&mut line));
            }
            if line.is_empty() {
                line = part.to_owned();
            } else {
                line = format!("{line}\n{part}");
            }
            while line.chars().count() > size {
                let (head, tail) = split_at_chars(&line, size);
                let (head, tail) = (head.to_owned(), tail.to_owned());
                pieces.push(head);
                line = tail;
            }
        }
        if !line.is_empty() {
            pieces.push(line);
        }
    }
    let mut pages = Vec::new();
    let mut current = String::new();
    for piece in pieces {
        if !current.is_empty() && current.chars().count() + piece.chars().count() + 2 > size {
            pages.push(std::mem::take(&mut current));
        }
        if current.is_empty() {
            current = piece;
        } else {
            current = format!("{current}\n\n{piece}");
        }
    }
    if !current.is_empty() {
        pages.push(current);
    }
    pages
}

/// Model-facing line for a page of a long read.
pub fn page_note(page: usize, count: usize) -> String {
    if count <= 1 {
        return String::new();
    }
    let head = format!("Page {page} of {count}.");
    if page >= count {
        format!("{head} This is the last page.")
    } else {
        format!(
            "{head} More follows: call read_url again with the same url and page={} to read the next page.",
            page + 1
        )
    }
}

/// The charset a `<meta>` tag in the first bytes names.
fn sniff_charset(bytes: &[u8]) -> Option<String> {
    let head: String = bytes.iter().take(2048).map(|byte| char::from(*byte)).collect();
    let lower = head.to_lowercase();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<meta") {
        let start = from + start;
        let end = lower[start..].find('>').map_or(lower.len(), |at| start + at);
        let tag = &lower[start..end];
        if let Some(at) = tag.find("charset") {
            let rest = tag[at + 7..].trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let label: String = rest
                    .trim_start()
                    .trim_start_matches(['"', '\''])
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_'))
                    .collect();
                if !label.is_empty() {
                    return Some(label);
                }
            }
        }
        from = end;
    }
    None
}

/// Decodes a body by the header charset, then by a `<meta>` charset, then as UTF-8.
pub fn decode_body(bytes: &[u8], content_type: &str) -> String {
    let header = content_type.split(';').skip(1).find_map(|param| {
        let (name, value) = param.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches('"').trim_matches('\'').to_owned())
    });
    let label = header.or_else(|| sniff_charset(bytes));
    let encoding = label
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(UTF_8);
    encoding.decode(bytes).0.into_owned()
}

/// One response, not followed past a redirect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPage {
    pub status: u16,
    pub content_type: String,
    pub final_url: String,
    pub bytes: Vec<u8>,
}

/// What one request answered: another address to ask, or a body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Hop {
    Redirect(String),
    Page(RawPage),
}

/// The network seam for page reads. `fetch` makes one request and never follows a redirect itself.
pub trait PageSource: Send + Sync {
    fn fetch(&self, url: &str) -> impl Future<Output = Result<Hop, HttpError>> + Send;
}

/// The production source: no automatic redirects, a cookie jar for the life of the value, and capped bodies.
#[derive(Debug, Clone)]
pub struct ReqwestPageSource {
    client: reqwest::Client,
}

impl ReqwestPageSource {
    /// Builds the client. Fails only when the TLS backend cannot start.
    pub fn new() -> Option<Self> {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(true)
            .user_agent(DESKTOP_USER_AGENT)
            .timeout(FETCH_TIMEOUT)
            .build()
            .ok()
            .map(|client| Self { client })
    }
}

fn map_error(error: reqwest::Error) -> HttpError {
    if error.is_timeout() {
        HttpError::Timeout
    } else {
        HttpError::Failed(error.without_url().to_string())
    }
}

impl PageSource for ReqwestPageSource {
    async fn fetch(&self, url: &str) -> Result<Hop, HttpError> {
        let mut response = self
            .client
            .get(url)
            .header(reqwest::header::ACCEPT, ACCEPT)
            .send()
            .await
            .map_err(map_error)?;
        let status = response.status();
        let header = |name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        let location = header(reqwest::header::LOCATION);
        if status.is_redirection()
            && let Some(location) = location
        {
            return Ok(Hop::Redirect(location));
        }
        let content_type = header(reqwest::header::CONTENT_TYPE).unwrap_or_default();
        let limit = if is_pdf_source(&content_type, url) {
            MAX_PDF_BYTES
        } else {
            MAX_HTML_BYTES
        };
        let mut bytes = Vec::new();
        while bytes.len() < limit {
            let Some(chunk) = response.chunk().await.map_err(map_error)? else { break };
            bytes.extend_from_slice(&chunk);
        }
        bytes.truncate(limit);
        Ok(Hop::Page(RawPage {
            status: status.as_u16(),
            content_type,
            final_url: url.to_owned(),
            bytes,
        }))
    }
}

/// How a fetch with redirect checks ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fetched {
    Page(RawPage),
    /// A redirect led somewhere the URL policy refuses. Holds that address.
    Refused(String),
    Failed,
}

fn fetchable(url: &str) -> bool {
    UrlPolicy::new().is_fetchable_url(url, false)
}

/// Fetches with every redirect hop held to the URL policy. A refused hop is reported, not followed.
pub async fn fetch_following<S: PageSource>(source: &S, url: &str) -> Fetched {
    let mut current = url.to_owned();
    for _ in 0..=MAX_HOPS {
        match source.fetch(&current).await {
            Err(_) => return Fetched::Failed,
            Ok(Hop::Page(page)) => return Fetched::Page(page),
            Ok(Hop::Redirect(location)) => match resolve_url(&location, &current) {
                Some(next) if fetchable(&next) => current = next,
                Some(next) => return Fetched::Refused(next),
                None => return Fetched::Refused(location),
            },
        }
    }
    Fetched::Failed
}

/// Why a page was not read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    /// The URL policy refuses the address.
    Refused,
    /// The address answered, or did not, in a way that gives no readable page.
    Unreachable,
    /// A human-verification page such as Cloudflare's.
    HumanVerification,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blocked {
    pub kind: BlockKind,
    /// A sentence for the model. Empty for `HumanVerification`, whose wording belongs to the tool.
    pub reason: String,
}

/// One page of a read, with the page's metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRead {
    pub title: String,
    pub text: String,
    pub url: String,
    pub canonical_url: String,
    pub meta: PageMeta,
    pub page_count: usize,
    pub page: usize,
    pub page_note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum ReadOutcome {
    Page(PageRead),
    Blocked(Blocked),
}

fn blocked(kind: BlockKind, reason: impl Into<String>) -> ReadOutcome {
    ReadOutcome::Blocked(Blocked {
        kind,
        reason: reason.into(),
    })
}

#[derive(Debug, Clone)]
struct Stored {
    url: String,
    canonical_url: String,
    meta: PageMeta,
    pages: Vec<String>,
    needs_browser: bool,
}

impl Stored {
    fn shape(&self, page: usize) -> PageRead {
        let count = self.pages.len();
        let index = page.clamp(1, count);
        let beyond = page > count;
        let mut note = if beyond {
            format!(
                "Page {page} does not exist. This read has {count} page{}.",
                if count == 1 { "" } else { "s" }
            )
        } else {
            page_note(index, count)
        };
        if self.needs_browser {
            note = if note.is_empty() {
                BROWSER_NOTE.to_owned()
            } else {
                format!("{note} {BROWSER_NOTE}")
            };
        }
        PageRead {
            title: self.meta.title.clone().unwrap_or_default(),
            text: if beyond {
                String::new()
            } else {
                self.pages[index - 1].clone()
            },
            url: self.url.clone(),
            canonical_url: self.canonical_url.clone(),
            meta: self.meta.clone(),
            page_count: count,
            page: if beyond { page } else { index },
            page_note: note,
        }
    }
}

/// The paging cache: 24 reads, 30 minutes each, oldest dropped first.
#[derive(Debug, Default)]
pub struct PageCache {
    entries: Vec<(String, u64, Stored)>,
}

impl PageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    fn get(&mut self, url: &str, now: u64) -> Option<&Stored> {
        let at = self.entries.iter().position(|(key, _, _)| key == url)?;
        if now.saturating_sub(self.entries[at].1) > CACHE_TTL_MS {
            self.entries.remove(at);
            return None;
        }
        Some(&self.entries[at].2)
    }

    fn put(&mut self, url: &str, stored: Stored, now: u64) {
        self.entries.retain(|(key, _, _)| key != url);
        self.entries.push((url.to_owned(), now, stored));
        while self.entries.len() > CACHE_LIMIT {
            self.entries.remove(0);
        }
    }
}

/// The host of a URL for the log, never the path or query.
fn host_for_log(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "unparsable url".to_owned())
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let decoded = (bytes[at] == b'%')
            .then(|| text.get(at + 1..at + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        if let Some(byte) = decoded {
            out.push(byte);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

/// Whether a page is a human-verification wall rather than content.
pub fn is_challenge(title: &str, text: &str) -> bool {
    let title = title.to_lowercase();
    let head: String = text.chars().take(600).collect::<String>().to_lowercase();
    title.contains("just a moment")
        || title.contains("attention required")
        || head.contains("verify you are human")
        || head.contains("checking your browser")
}

/// Reads a PDF's bytes into text. The error is the sentence for the model.
pub type PdfReader<'a> = &'a (dyn Fn(&[u8]) -> Result<String, String> + Sync);

/// Reads one page of a URL: URL policy, cache, fetch with every hop checked, PDF or Readability, paging.
/// `now_ms` is the clock for the cache.
pub async fn read_page<S: PageSource>(
    cache: &mut PageCache,
    source: &S,
    url: &str,
    requested_page: Option<u64>,
    now_ms: u64,
    read_pdf: PdfReader<'_>,
) -> ReadOutcome {
    let page = requested_page
        .filter(|page| *page > 0)
        .map_or(1, |page| usize::try_from(page).unwrap_or(usize::MAX));
    if !fetchable(url) {
        tracing::warn!(target: "read-url", "refused {}", host_for_log(url));
        return blocked(BlockKind::Refused, refusal_for(url));
    }
    if let Some(hit) = cache.get(url, now_ms) {
        return ReadOutcome::Page(hit.shape(page));
    }

    let raw = match fetch_following(source, url).await {
        Fetched::Refused(next) => {
            tracing::warn!(target: "read-url", "redirect refused");
            return blocked(BlockKind::Refused, refusal_for(&next));
        }
        Fetched::Failed => {
            tracing::warn!(target: "read-url", "fast fetch failed");
            return blocked(BlockKind::Unreachable, "That page could not be fetched.");
        }
        Fetched::Page(raw) => raw,
    };
    if raw.status >= 400 {
        return blocked(
            BlockKind::Unreachable,
            format!(
                "That page answered with HTTP {} and could not be read. It may block automated readers.",
                raw.status
            ),
        );
    }

    let mut needs_browser = false;
    let markdown;
    let mut meta;
    let via;
    if is_pdf_source(&raw.content_type, &raw.final_url) {
        markdown = match read_pdf(&raw.bytes) {
            Ok(text) => text.trim().to_owned(),
            Err(reason) => {
                tracing::warn!(target: "read-url", "pdf read failed");
                let reason = if reason.is_empty() {
                    "That PDF could not be read.".to_owned()
                } else {
                    reason
                };
                return blocked(BlockKind::Unreachable, reason);
            }
        };
        via = "pdf";
        let name = Url::parse(&raw.final_url)
            .ok()
            .and_then(|url| url.path().rsplit('/').next().map(percent_decode))
            .unwrap_or_default();
        let name = name.trim_end_matches(".pdf").trim_end_matches(".PDF");
        meta = PageMeta {
            title: (!name.is_empty()).then(|| name.to_owned()),
            ..PageMeta::default()
        };
    } else {
        let kind = raw
            .content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let is_text = kind.is_empty()
            || kind.starts_with("text/")
            || matches!(
                kind.as_str(),
                "application/xhtml+xml" | "application/xml" | "application/json"
            );
        if !is_text {
            return blocked(
                BlockKind::Unreachable,
                format!("That address serves {kind}, which cannot be read as a page."),
            );
        }
        let html = decode_body(&raw.bytes, &raw.content_type);
        meta = extract_metadata(&html, &raw.final_url);
        via = "fast";
        if kind == "text/plain" || kind == "application/json" {
            markdown = html.trim().to_owned();
            needs_browser = markdown.is_empty();
        } else {
            let extracted = readable::extract(&html, &raw.final_url);
            markdown = extracted.markdown.trim().to_owned();
            meta.title = meta.title.or_else(|| clean(Some(extracted.title.as_str())));
            meta.author = meta.author.or_else(|| clean(Some(extracted.byline.as_str())));
            needs_browser = needs_render(&markdown, &html);
            let title = meta.title.as_deref().unwrap_or("");
            if is_challenge(title, &markdown) || is_challenge(title, &visible_text(&html)) {
                return blocked(BlockKind::HumanVerification, "");
            }
        }
    }
    if markdown.is_empty() {
        return blocked(
            BlockKind::Unreachable,
            "This page shows no text without a browser, and Draggy has none to run its scripts here. Tell the user it needs to be opened in a browser.",
        );
    }

    let canonical_url = meta
        .canonical
        .clone()
        .filter(|canonical| fetchable(canonical))
        .unwrap_or_else(|| raw.final_url.clone());
    let pages = split_pages(&markdown, PAGE_SIZE);
    tracing::warn!(target: "read-url", "read {via}, {} page(s)", pages.len());
    let stored = Stored {
        url: url.to_owned(),
        canonical_url,
        meta,
        pages,
        needs_browser,
    };
    let shaped = stored.shape(page);
    cache.put(url, stored, now_ms);
    ReadOutcome::Page(shaped)
}

#[cfg(test)]
mod tests {
    use super::page_text;

    #[test]
    fn keeps_title_and_visible_text() {
        let html = "<html><head><title> Hello  World </title><style>p{}</style></head><body><nav>menu</nav><h1>Head</h1><p>One <b>two</b></p><script>x()</script><p>Three</p></body></html>";
        let (title, text) = page_text(html);
        assert_eq!(title, "Hello World");
        assert_eq!(text, "Head\nOne two\nThree");
    }

    #[test]
    fn a_page_with_no_body_text_is_empty() {
        let (title, text) = page_text("<html><body></body></html>");
        assert_eq!((title.as_str(), text.as_str()), ("", ""));
    }
}

#[cfg(test)]
mod read_tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    struct Canned {
        hops: Mutex<VecDeque<Result<Hop, HttpError>>>,
        asked: Mutex<Vec<String>>,
    }

    impl Canned {
        fn new(hops: Vec<Result<Hop, HttpError>>) -> Self {
            Self {
                hops: Mutex::new(hops.into()),
                asked: Mutex::new(Vec::new()),
            }
        }
        fn asked(&self) -> usize {
            self.asked.lock().map_or(0, |asked| asked.len())
        }
    }

    impl PageSource for Canned {
        async fn fetch(&self, url: &str) -> Result<Hop, HttpError> {
            if let Ok(mut asked) = self.asked.lock() {
                asked.push(url.to_owned());
            }
            self.hops
                .lock()
                .ok()
                .and_then(|mut hops| hops.pop_front())
                .unwrap_or(Err(HttpError::Failed("no more answers".to_owned())))
        }
    }

    fn page(content_type: &str, body: &[u8]) -> Result<Hop, HttpError> {
        Ok(Hop::Page(RawPage {
            status: 200,
            content_type: content_type.to_owned(),
            final_url: "https://example.com/a".to_owned(),
            bytes: body.to_vec(),
        }))
    }

    fn run<T>(future: impl Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .map_or_else(|_| unreachable!("runtime"), |runtime| runtime.block_on(future))
    }

    fn no_pdf(_: &[u8]) -> Result<String, String> {
        Err("no pdf here".to_owned())
    }

    fn long_html() -> String {
        let paragraph = "<p>This paragraph is long enough to count as text, with commas, clauses, and a point to make.</p>";
        format!(
            "<html lang=\"en\"><head><title>Long read</title></head><body><article>{}</article></body></html>",
            paragraph.repeat(400)
        )
    }

    #[test]
    fn a_redirect_to_a_private_address_is_refused() {
        let source = Canned::new(vec![Ok(Hop::Redirect("http://127.0.0.1/admin".to_owned()))]);
        let mut cache = PageCache::new();
        let out = run(read_page(&mut cache, &source, "https://example.com/a", None, 0, &no_pdf));
        assert!(matches!(out, ReadOutcome::Blocked(Blocked { kind: BlockKind::Refused, .. })), "{out:?}");
        assert_eq!(source.asked(), 1);
    }

    #[test]
    fn redirects_stop_after_five_hops() {
        let hops = (0..8).map(|n| Ok(Hop::Redirect(format!("/hop{n}")))).collect();
        let source = Canned::new(hops);
        assert_eq!(run(fetch_following(&source, "https://example.com/")), Fetched::Failed);
        assert_eq!(source.asked(), MAX_HOPS + 1);
    }

    #[test]
    fn a_long_page_comes_in_parts_and_later_parts_hit_the_cache() {
        let source = Canned::new(vec![
            page("text/html; charset=utf-8", long_html().as_bytes()),
            page("text/html; charset=utf-8", long_html().as_bytes()),
        ]);
        let mut cache = PageCache::new();
        let url = "https://example.com/a";
        let ReadOutcome::Page(first) = run(read_page(&mut cache, &source, url, None, 0, &no_pdf)) else {
            unreachable!("first page");
        };
        assert_eq!(first.page, 1);
        assert!(first.page_count > 1);
        assert!(first.page_note.contains("page=2"), "{}", first.page_note);
        assert_eq!(first.title, "Long read");
        let ReadOutcome::Page(second) = run(read_page(&mut cache, &source, url, Some(2), 1_000, &no_pdf)) else {
            unreachable!("second page");
        };
        assert_eq!(second.page, 2);
        assert!(!second.text.is_empty());
        assert_eq!(source.asked(), 1);
        let ReadOutcome::Page(beyond) = run(read_page(&mut cache, &source, url, Some(99), 1_000, &no_pdf)) else {
            unreachable!("beyond");
        };
        assert!(beyond.text.is_empty() && beyond.page_note.contains("does not exist"));
        // After the TTL the page is fetched again.
        let _ = run(read_page(&mut cache, &source, url, None, CACHE_TTL_MS + 1_001, &no_pdf));
        assert_eq!(source.asked(), 2);
    }

    #[test]
    fn the_cache_keeps_24_reads() {
        let mut cache = PageCache::new();
        let stored = || Stored {
            url: String::new(),
            canonical_url: String::new(),
            meta: PageMeta::default(),
            pages: vec![String::new()],
            needs_browser: false,
        };
        for n in 0..30 {
            cache.put(&format!("https://example.com/{n}"), stored(), 0);
        }
        assert_eq!(cache.len(), CACHE_LIMIT);
        assert!(cache.get("https://example.com/0", 0).is_none());
        assert!(cache.get("https://example.com/29", 0).is_some());
    }

    #[test]
    fn a_pdf_goes_to_the_reader_and_is_titled_by_its_file() {
        let hop = Ok(Hop::Page(RawPage {
            status: 200,
            content_type: "application/pdf".to_owned(),
            final_url: "https://example.com/files/Annual%20Report.pdf".to_owned(),
            bytes: b"%PDF".to_vec(),
        }));
        let source = Canned::new(vec![hop]);
        let mut cache = PageCache::new();
        let reader = |_: &[u8]| Ok("Page one text".to_owned());
        let url = "https://example.com/files/Annual%20Report.pdf";
        let out = run(read_page(&mut cache, &source, url, None, 0, &reader));
        let ReadOutcome::Page(read) = out else { unreachable!("{out:?}") };
        assert_eq!(read.title, "Annual Report");
        assert_eq!(read.text, "Page one text");
    }

    #[test]
    fn a_script_shell_says_it_needs_a_browser() {
        let html = "<html><head><title>App</title><script src=\"/a.js\"></script></head><body><div id=\"root\"></div><p>Loading the application for you, one moment please, thanks.</p></body></html>";
        let source = Canned::new(vec![page("text/html", html.as_bytes())]);
        let mut cache = PageCache::new();
        let out = run(read_page(&mut cache, &source, "https://example.com/a", None, 0, &no_pdf));
        let ReadOutcome::Page(read) = out else { unreachable!("{out:?}") };
        assert!(read.page_note.contains("browser"), "{}", read.page_note);
    }

    #[test]
    fn a_challenge_page_and_a_non_page_are_blocked() {
        let wall = "<html><head><title>Just a moment...</title><script>a()</script></head><body>Checking your browser</body></html>";
        let source = Canned::new(vec![page("text/html", wall.as_bytes()), page("image/png", b"x")]);
        let mut cache = PageCache::new();
        let first = run(read_page(&mut cache, &source, "https://example.com/a", None, 0, &no_pdf));
        assert!(matches!(first, ReadOutcome::Blocked(Blocked { kind: BlockKind::HumanVerification, .. })));
        let second = run(read_page(&mut cache, &source, "https://example.com/b", None, 0, &no_pdf));
        let ReadOutcome::Blocked(Blocked { reason, .. }) = second else { unreachable!() };
        assert!(reason.contains("image/png"), "{reason}");
    }

    #[test]
    fn spots_a_verification_page() {
        assert!(is_challenge("Just a moment...", ""));
        assert!(is_challenge("", "Please Verify you are human"));
        assert!(!is_challenge("Docs", "Hello"));
    }

    #[test]
    fn entities_decode_once() {
        assert_eq!(decode_entities("a &amp;lt; b &#65;&#x42; &quot;"), "a &lt; b AB \"");
    }

    #[test]
    fn the_body_charset_comes_from_the_header_then_the_meta_tag() {
        assert_eq!(decode_body(&[0xE9], "text/html; charset=iso-8859-1"), "\u{e9}");
        let sniffed = [b"<meta charset=\"windows-1252\">".as_slice(), &[0xE9]].concat();
        assert!(decode_body(&sniffed, "text/html").ends_with('\u{e9}'));
    }
}
