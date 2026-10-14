//! Reads scraped pages with the extract scripts' selectors. The CJS ran them in a hidden window, so these rules
//! approximate innerText and href only as far as the fixtures pin them.

use scraper::{ElementRef, Html, Node, Selector};
use serde_json::{Value, json};
use url::Url;

use super::RESULT_LIMIT;
use crate::js::{js_trim, utf16_prefix};

/// Elements a browser puts on their own line.
const BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "caption",
    "dd",
    "details",
    "dialog",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "li",
    "main",
    "menu",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "summary",
    "table",
    "tbody",
    "thead",
    "tfoot",
    "tr",
    "ul",
];

/// Elements a browser never renders as text.
const HIDDEN_TAGS: &[&str] = &["script", "style", "noscript", "template"];

pub fn duckduckgo_rows(document: &Html, base: &Url) -> Vec<Value> {
    let mut rows = Vec::new();
    for item in select_all(document, ".result:not(.result--ad)") {
        let Some(title_el) = select_first(item, ".result__a") else {
            continue;
        };
        let title = trimmed_text(title_el);
        let url = href_of(title_el, base);
        if title.is_empty() || url.is_empty() {
            continue;
        }
        let snippet = select_first(item, ".result__snippet")
            .map(trimmed_text)
            .unwrap_or_default();
        rows.push(row(&title, &url, &snippet));
    }
    rows.truncate(RESULT_LIMIT);
    rows
}

pub fn lite_rows(document: &Html, base: &Url) -> Vec<Value> {
    let mut rows = Vec::new();
    for link in select_all(document, "a.result-link") {
        let url = href_of(link, base);
        if url.is_empty() {
            continue;
        }
        // The snippet is the row below the link's row, falling back to that whole row when it has no snippet cell.
        let next = closest_row(link).and_then(next_element);
        let snippet_el = next.map(|next| select_first(next, ".result-snippet").unwrap_or(next));
        let snippet = snippet_el.map(trimmed_text).unwrap_or_default();
        rows.push(row(&trimmed_text(link), &url, &snippet));
    }
    rows.truncate(RESULT_LIMIT);
    rows
}

pub fn startpage_rows(document: &Html, base: &Url) -> Vec<Value> {
    let mut rows = Vec::new();
    for item in select_all(document, ".result, .w-gl__result") {
        let Some(link) = select_first(
            item,
            r#"a.result-link, a.w-gl__result-title, h2 a, a[href^="http"]"#,
        ) else {
            continue;
        };
        let url = href_of(link, base);
        if !url.starts_with("http") {
            continue;
        }
        let heading = select_first(item, "h2, h3");
        let title = trimmed_text(heading.unwrap_or(link));
        if title.is_empty() {
            continue;
        }
        let snippet = select_first(item, ".description, .w-gl__description, p")
            .map(trimmed_text)
            .unwrap_or_default();
        rows.push(row(&title, &url, &snippet));
    }
    rows.truncate(RESULT_LIMIT);
    rows
}

pub fn brave_html_rows(document: &Html, base: &Url) -> Vec<Value> {
    let mut rows = Vec::new();
    for item in select_all(document, r#"#results .snippet, .snippet[data-type="web"]"#) {
        let Some(link) = select_first(item, r#"a[href^="http"]"#) else {
            continue;
        };
        let heading = select_first(item, r#".title, .snippet-title, div[class*="title"]"#);
        // The title is the last non-empty line of the heading, so a site name above it is skipped.
        let raw = trimmed_text(heading.unwrap_or(link));
        let last_line = raw
            .split('\n')
            .rfind(|line| !line.is_empty())
            .unwrap_or_default();
        let title = utf16_prefix(last_line, 200);
        if title.is_empty() {
            continue;
        }
        let url = href_of(link, base);
        let snippet = select_first(item, ".snippet-description, .snippet-content, p")
            .map(trimmed_text)
            .unwrap_or_default();
        rows.push(row(&title, &url, &snippet));
    }
    rows.truncate(RESULT_LIMIT);
    rows
}

fn row(title: &str, url: &str, snippet: &str) -> Value {
    json!({ "title": title, "url": url, "snippet": snippet })
}

fn select_all<'a>(document: &'a Html, css: &str) -> Vec<ElementRef<'a>> {
    match Selector::parse(css) {
        Ok(selector) => document.select(&selector).collect(),
        Err(_) => Vec::new(),
    }
}

fn select_first<'a>(scope: ElementRef<'a>, css: &str) -> Option<ElementRef<'a>> {
    let selector = Selector::parse(css).ok()?;
    scope.select(&selector).next()
}

/// The document base URL: the first `<base href>` resolved against the page, or the page itself when there is no usable one.
pub fn document_base(document: &Html, page: &Url) -> Url {
    let Ok(selector) = Selector::parse("base[href]") else {
        return page.clone();
    };
    document
        .select(&selector)
        .next()
        .and_then(|base| base.value().attr("href"))
        .and_then(|raw| page.join(raw).ok())
        .unwrap_or_else(|| page.clone())
}

/// `element.href`: empty when there is no attribute, the resolved URL otherwise, or the raw value when it does not parse.
fn href_of(element: ElementRef<'_>, base: &Url) -> String {
    match element.value().attr("href") {
        None => String::new(),
        Some(raw) => base
            .join(raw)
            .map_or_else(|_| raw.to_owned(), |url| url.to_string()),
    }
}

/// `element.closest('tr')`, for an element that is not itself a row.
fn closest_row(element: ElementRef<'_>) -> Option<ElementRef<'_>> {
    element
        .ancestors()
        .find_map(|node| ElementRef::wrap(node).filter(|found| found.value().name() == "tr"))
}

/// `element.nextElementSibling`.
fn next_element(element: ElementRef<'_>) -> Option<ElementRef<'_>> {
    element.next_siblings().find_map(ElementRef::wrap)
}

fn trimmed_text(element: ElementRef<'_>) -> String {
    js_trim(&inner_text(element)).to_owned()
}

/// `innerText`, simplified: text runs collapse, `<br>` and block edges become line breaks, a table cell with a
/// following cell ends in a tab, and spaces beside a line break go.
fn inner_text(element: ElementRef<'_>) -> String {
    let mut raw = String::new();
    render(element, &mut raw);
    tidy(&raw)
}

fn render(element: ElementRef<'_>, out: &mut String) {
    let tag = element.value().name();
    if HIDDEN_TAGS.contains(&tag) {
        return;
    }
    if tag == "br" {
        out.push('\n');
        return;
    }
    let block = BLOCK_TAGS.contains(&tag);
    if block {
        out.push('\n');
    }
    for child in element.children() {
        match child.value() {
            Node::Text(text) => out.push_str(&collapse_whitespace(text)),
            Node::Element(_) => {
                if let Some(inner) = ElementRef::wrap(child) {
                    render(inner, out);
                }
            }
            _ => {}
        }
    }
    if matches!(tag, "td" | "th")
        && element
            .next_siblings()
            .any(|sibling| matches!(sibling.value(), Node::Element(_)))
    {
        out.push('\t');
    }
    if block {
        out.push('\n');
    }
}

/// Runs of CSS white space (space, tab, line feed, carriage return, form feed) become one space.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for ch in text.chars() {
        if matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{0C}') {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            out.push(ch);
            in_run = false;
        }
    }
    out
}

/// Spaces beside a line break go, and runs of spaces or of line breaks collapse to one.
fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            ' ' => {
                if !(out.is_empty() || out.ends_with([' ', '\n'])) {
                    out.push(' ');
                }
            }
            '\n' => {
                while out.ends_with(' ') {
                    out.pop();
                }
                if !(out.is_empty() || out.ends_with('\n')) {
                    out.push('\n');
                }
            }
            other => out.push(other),
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}
