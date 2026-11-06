//! A compact Readability-style main-content extractor and an HTML-to-Markdown converter, both on scraper.
//! Paragraphs are scored by text and link density, the best container wins, and page chrome is skipped.

use std::collections::HashMap;

use scraper::{ElementRef, Html, Node, Selector};
use url::Url;

/// What the extractor found: Markdown for the main content, the `<title>` text and a byline when the page names one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Extracted {
    pub markdown: String,
    pub title: String,
    pub byline: String,
}

/// Tags that are never part of the reading text.
const NOISE_TAGS: [&str; 15] = [
    "script", "style", "noscript", "template", "svg", "iframe", "nav", "footer", "aside", "head", "canvas", "object",
    "embed", "dialog", "select",
];
/// Class or id words that mark page chrome, unless a word of `LIKELY` is also there.
const UNLIKELY: [&str; 18] = [
    "comment", "sidebar", "sidenav", "menu", "cookie", "consent", "banner", "advert", "sponsor", "popup", "modal",
    "newsletter", "subscribe", "social", "breadcrumb", "promo", "toolbar", "skip-link",
];
const LIKELY: [&str; 8] = ["article", "body", "content", "main", "post", "entry", "story", "text"];
const NEGATIVE: [&str; 10] = [
    "hidden", "foot", "masthead", "meta", "related", "share", "shopping", "tags", "widget", "outbrain",
];
const BLOCKS: [&str; 18] = [
    "div", "section", "article", "main", "header", "figure", "figcaption", "details", "summary", "address", "dl", "dt",
    "dd", "fieldset", "body", "center", "form", "li",
];
const SKIPPED_INLINE: [&str; 11] = [
    "img", "input", "textarea", "button", "video", "audio", "picture", "source", "map", "label", "option",
];
/// Fewer characters than this and a container is not the article; the whole body is used instead.
const MIN_CONTAINER: usize = 200;

fn id_of(element: ElementRef<'_>) -> usize {
    std::ptr::from_ref(element.value()) as usize
}

fn class_and_id(element: ElementRef<'_>) -> String {
    let value = element.value();
    format!(
        "{} {}",
        value.attr("class").unwrap_or(""),
        value.attr("id").unwrap_or("")
    )
    .to_lowercase()
}

fn has_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

fn is_noise(element: ElementRef<'_>) -> bool {
    let value = element.value();
    let name = value.name();
    if NOISE_TAGS.contains(&name) {
        return true;
    }
    if value.attr("hidden").is_some() || value.attr("aria-hidden") == Some("true") {
        return true;
    }
    if let Some(style) = value.attr("style")
        && style.to_lowercase().replace(' ', "").contains("display:none")
    {
        return true;
    }
    if matches!(name, "html" | "body" | "article" | "main" | "a") {
        return false;
    }
    let marks = class_and_id(element);
    has_any(&marks, &UNLIKELY) && !has_any(&marks, &LIKELY)
}

fn inside_noise(element: ElementRef<'_>) -> bool {
    is_noise(element)
        || element
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(is_noise)
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_text(element: ElementRef<'_>) -> String {
    let mut out = String::new();
    gather_text(element, &mut out);
    collapse(&out)
}

/// The text a reader sees under `element`, leaving out noise subtrees.
fn gather_text(element: ElementRef<'_>, out: &mut String) {
    for child in element.children() {
        match child.value() {
            Node::Text(text) => out.push_str(text),
            Node::Element(_) => {
                if let Some(child) = ElementRef::wrap(child)
                    && !is_noise(child)
                {
                    gather_text(child, out);
                }
            }
            _ => {}
        }
    }
}

fn link_density(element: ElementRef<'_>) -> f64 {
    let total = clean_text(element).chars().count();
    if total == 0 {
        return 0.0;
    }
    let linked: usize = element
        .descendants()
        .filter_map(ElementRef::wrap)
        .filter(|node| node.value().name() == "a")
        .map(|node| clean_text(node).chars().count())
        .sum();
    (linked as f64 / total as f64).min(1.0)
}

fn weight(element: ElementRef<'_>) -> f64 {
    let marks = class_and_id(element);
    let mut score = 0.0;
    if has_any(&marks, &NEGATIVE) {
        score -= 25.0;
    }
    if has_any(&marks, &LIKELY) {
        score += 25.0;
    }
    score
}

fn base_score(element: ElementRef<'_>) -> f64 {
    let tag = match element.value().name() {
        "div" => 5.0,
        "pre" | "td" | "blockquote" => 3.0,
        "address" | "ol" | "ul" | "dl" | "dd" | "dt" | "li" | "form" => -3.0,
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "th" => -5.0,
        _ => 0.0,
    };
    tag + weight(element)
}

/// The text a div or section holds directly, outside any child element.
fn own_text(element: ElementRef<'_>) -> String {
    let own: String = element
        .children()
        .filter_map(|child| child.value().as_text().map(|text| &**text))
        .collect();
    collapse(&own)
}

/// Picks the element holding the article, or the body when nothing scores well.
fn pick_container(document: &Html) -> Option<ElementRef<'_>> {
    let body = Selector::parse("body")
        .ok()
        .and_then(|selector| document.select(&selector).next());
    let candidates = Selector::parse("p, pre, td, blockquote, div, section").ok()?;
    let mut scores: HashMap<usize, (f64, ElementRef<'_>)> = HashMap::new();
    for element in document.select(&candidates) {
        let name = element.value().name();
        let text = if matches!(name, "div" | "section") {
            own_text(element)
        } else {
            clean_text(element)
        };
        let length = text.chars().count();
        if length < 25 || inside_noise(element) {
            continue;
        }
        let commas = text.chars().filter(|c| matches!(c, ',' | '，')).count();
        let points = 1.0 + commas as f64 + (length as f64 / 100.0).min(3.0);
        for (level, ancestor) in element
            .ancestors()
            .filter_map(ElementRef::wrap)
            .take(5)
            .enumerate()
        {
            if matches!(ancestor.value().name(), "html" | "body") {
                break;
            }
            let divider = match level {
                0 => 1.0,
                1 => 2.0,
                other => other as f64 * 3.0,
            };
            let entry = scores
                .entry(id_of(ancestor))
                .or_insert_with(|| (base_score(ancestor), ancestor));
            entry.0 += points / divider;
        }
    }
    let mut ranked: Vec<(f64, ElementRef<'_>)> = scores
        .into_values()
        .map(|(score, element)| (score * (1.0 - link_density(element)), element))
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut best = ranked.first().copied();
    // A parent that scored higher still holds the article, with more of it.
    while let Some((score, element)) = best {
        let parent = element
            .parent()
            .and_then(ElementRef::wrap)
            .filter(|parent| !matches!(parent.value().name(), "html" | "body"));
        let Some(parent) = parent else { break };
        match ranked.iter().find(|(_, other)| id_of(*other) == id_of(parent)) {
            Some(entry) if entry.0 > score => best = Some(*entry),
            _ => break,
        }
    }
    let fallback = || {
        ["main", "article", "[role=main]"]
            .iter()
            .filter_map(|css| Selector::parse(css).ok())
            .find_map(|selector| document.select(&selector).next())
            .or(body)
    };
    match best {
        Some((_, element)) if clean_text(element).chars().count() >= MIN_CONTAINER => Some(element),
        _ => fallback(),
    }
}

fn byline_of(document: &Html) -> String {
    let Ok(selector) = Selector::parse("[rel~=author], [itemprop=author], .byline, .author") else {
        return String::new();
    };
    document
        .select(&selector)
        .filter(|element| !inside_noise(*element))
        .map(clean_text)
        .find(|text| !text.is_empty() && text.chars().count() <= 100)
        .unwrap_or_default()
}

/// Finds the main content of `html` and converts it to Markdown. Links resolve against `base`.
pub fn extract(html: &str, base: &str) -> Extracted {
    let document = Html::parse_document(html);
    let title = Selector::parse("title")
        .ok()
        .and_then(|selector| document.select(&selector).next())
        .map(|node| collapse(&node.text().collect::<String>()))
        .unwrap_or_default();
    let mut writer = Writer::new(Url::parse(base).ok());
    if let Some(container) = pick_container(&document) {
        writer.walk(container);
    }
    Extracted {
        markdown: writer.finish(),
        title,
        byline: byline_of(&document),
    }
}

struct Writer {
    out: String,
    base: Option<Url>,
}

impl Writer {
    const fn new(base: Option<Url>) -> Self {
        Self {
            out: String::new(),
            base,
        }
    }

    fn child(&self) -> Self {
        Self::new(self.base.clone())
    }

    fn trim_end(&mut self) {
        let kept = self.out.trim_end_matches([' ', '\t']).len();
        self.out.truncate(kept);
    }

    /// Ends the current block with one empty line.
    fn blank(&mut self) {
        self.trim_end();
        if self.out.is_empty() {
            return;
        }
        let kept = self.out.trim_end_matches('\n').len();
        self.out.truncate(kept);
        self.out.push_str("\n\n");
    }

    fn newline(&mut self) {
        self.trim_end();
        if !self.out.is_empty() && !self.out.ends_with('\n') {
            self.out.push('\n');
        }
    }

    fn text(&mut self, raw: &str) {
        let words = collapse(raw);
        let mut piece = String::new();
        if raw.starts_with(char::is_whitespace) {
            piece.push(' ');
        }
        piece.push_str(&words);
        if !words.is_empty() && raw.ends_with(char::is_whitespace) {
            piece.push(' ');
        }
        if piece.starts_with(' ')
            && (self.out.is_empty() || self.out.ends_with(char::is_whitespace))
        {
            piece.remove(0);
        }
        self.out.push_str(&piece);
    }

    fn finish(mut self) -> String {
        self.trim_end();
        let lines: Vec<&str> = self.out.lines().map(str::trim_end).collect();
        let mut joined = lines.join("\n");
        while joined.contains("\n\n\n") {
            joined = joined.replace("\n\n\n", "\n\n");
        }
        joined.trim().to_owned()
    }

    fn children(&mut self, element: ElementRef<'_>) {
        for child in element.children() {
            match child.value() {
                Node::Text(text) => self.text(text),
                Node::Element(_) => {
                    if let Some(child) = ElementRef::wrap(child) {
                        self.walk(child);
                    }
                }
                _ => {}
            }
        }
    }

    /// The Markdown of an element's children, rendered on their own.
    fn inner(&self, element: ElementRef<'_>) -> String {
        let mut inner = self.child();
        inner.children(element);
        inner.finish()
    }

    fn walk(&mut self, element: ElementRef<'_>) {
        if is_noise(element) {
            return;
        }
        let name = element.value().name();
        match name {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = usize::from(name.as_bytes()[1] - b'0');
                let inner = collapse(&self.inner(element));
                if !inner.is_empty() {
                    self.blank();
                    self.out.push_str(&"#".repeat(level));
                    self.out.push(' ');
                    self.out.push_str(&inner);
                    self.blank();
                }
            }
            "p" => {
                self.blank();
                self.children(element);
                self.blank();
            }
            "br" => self.newline(),
            "hr" => {
                self.blank();
                self.out.push_str("---");
                self.blank();
            }
            "ul" | "ol" => {
                self.blank();
                self.list(element, 0);
                self.blank();
            }
            "pre" => self.pre(element),
            "blockquote" => {
                let inner = self.inner(element);
                if !inner.is_empty() {
                    self.blank();
                    let quoted: Vec<String> = inner
                        .lines()
                        .map(|line| {
                            if line.is_empty() {
                                ">".to_owned()
                            } else {
                                format!("> {line}")
                            }
                        })
                        .collect();
                    self.out.push_str(&quoted.join("\n"));
                    self.blank();
                }
            }
            "table" => self.table(element),
            "a" => self.link(element),
            "strong" | "b" => self.wrap(element, "**"),
            "em" | "i" => self.wrap(element, "*"),
            "code" | "kbd" | "samp" => {
                let code = clean_text(element);
                if !code.is_empty() {
                    self.out.push('`');
                    self.out.push_str(&code);
                    self.out.push('`');
                }
            }
            _ if SKIPPED_INLINE.contains(&name) => {}
            _ if BLOCKS.contains(&name) => {
                self.blank();
                self.children(element);
                self.blank();
            }
            _ => self.children(element),
        }
    }

    fn wrap(&mut self, element: ElementRef<'_>, mark: &str) {
        let inner = collapse(&self.inner(element));
        if inner.is_empty() {
            return;
        }
        let mut raw = String::new();
        gather_text(element, &mut raw);
        if raw.starts_with(char::is_whitespace) {
            self.text(" ");
        }
        self.out.push_str(mark);
        self.out.push_str(&inner);
        self.out.push_str(mark);
        if raw.ends_with(char::is_whitespace) {
            self.text(" ");
        }
    }

    fn link(&mut self, element: ElementRef<'_>) {
        let inner = collapse(&self.inner(element));
        let href = element.value().attr("href").unwrap_or("").trim();
        let skip = href.is_empty()
            || href.starts_with('#')
            || href.to_lowercase().starts_with("javascript:");
        let resolved = match &self.base {
            Some(base) => base.join(href).ok().map(String::from),
            None => Url::parse(href).ok().map(String::from),
        };
        match resolved {
            Some(target) if !skip && !inner.is_empty() => {
                self.out.push_str(&format!(
                    "[{inner}]({})",
                    target.replace(')', "%29").replace(' ', "%20")
                ));
            }
            _ => self.out.push_str(&inner),
        }
    }

    fn pre(&mut self, element: ElementRef<'_>) {
        let language = element
            .descendants()
            .filter_map(ElementRef::wrap)
            .find(|node| node.value().name() == "code")
            .and_then(|node| node.value().attr("class"))
            .and_then(|classes| {
                classes
                    .split_whitespace()
                    .find_map(|class| class.strip_prefix("language-").or_else(|| class.strip_prefix("lang-")))
            })
            .unwrap_or("");
        let code: String = element.text().collect();
        let code = code.trim_matches('\n');
        if code.trim().is_empty() {
            return;
        }
        self.blank();
        self.out.push_str(&format!("```{language}\n{code}\n```"));
        self.blank();
    }

    fn list(&mut self, list: ElementRef<'_>, depth: usize) {
        let ordered = list.value().name() == "ol";
        let mut number = list
            .value()
            .attr("start")
            .and_then(|start| start.trim().parse::<usize>().ok())
            .unwrap_or(1);
        for item in list.children().filter_map(ElementRef::wrap) {
            if item.value().name() != "li" || is_noise(item) {
                continue;
            }
            let mut inner = self.child();
            for child in item.children() {
                match child.value() {
                    Node::Text(text) => inner.text(text),
                    Node::Element(_) => {
                        let Some(child) = ElementRef::wrap(child) else { continue };
                        if matches!(child.value().name(), "ul" | "ol") {
                            inner.newline();
                            inner.list(child, depth + 1);
                        } else {
                            inner.walk(child);
                        }
                    }
                    _ => {}
                }
            }
            let mut body = inner.finish();
            while body.contains("\n\n") {
                body = body.replace("\n\n", "\n");
            }
            if body.is_empty() {
                continue;
            }
            self.newline();
            let marker = if ordered {
                format!("{number}.")
            } else {
                "-".to_owned()
            };
            number += 1;
            self.out
                .push_str(&format!("{}{marker} {body}", "  ".repeat(depth)));
            self.newline();
        }
    }

    fn table(&mut self, table: ElementRef<'_>) {
        let rows: Vec<String> = table
            .descendants()
            .filter_map(ElementRef::wrap)
            .filter(|node| node.value().name() == "tr" && !is_noise(*node))
            .map(|row| {
                row.children()
                    .filter_map(ElementRef::wrap)
                    .filter(|cell| matches!(cell.value().name(), "td" | "th"))
                    .map(clean_text)
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .filter(|row| !row.replace('|', "").trim().is_empty())
            .collect();
        if rows.is_empty() {
            return;
        }
        self.blank();
        self.out.push_str(&rows.join("\n"));
        self.blank();
    }
}

#[cfg(test)]
mod tests {
    use super::extract;

    const ARTICLE: &str = r#"<html><head><title>  The Story </title></head><body>
<nav><a href="/home">Home</a><a href="/about">About</a></nav>
<div class="sidebar"><p>Subscribe to our newsletter for more updates, offers, and news.</p></div>
<main><article><h1>The Story</h1>
<p class="byline">By Ada Lovelace</p>
<p>Machines can <strong>reason</strong>, in a way, about <em>patterns</em> and read the <a href="/docs/rules?a=1">rules</a> that shape them, at length.</p>
<p>A second paragraph of prose follows here, with commas, clauses, and enough words to count as real text for a reader.</p>
<ul><li>First item</li><li>Second item<ul><li>Nested item</li></ul></li></ul>
<ol><li>One</li><li>Two</li></ol>
<pre><code class="language-rust">fn main() {
    println!("hi");
}</code></pre>
<p>Use <code>cargo test</code> to run them.</p>
<table><tr><th>Name</th><th>Score</th></tr><tr><td>Ann</td><td>3</td></tr></table>
<script>track()</script></article></main>
<aside><p>Related links and other things that the aside holds, many of them.</p></aside>
<footer>Copyright footer text</footer></body></html>"#;

    #[test]
    fn keeps_the_article_and_drops_the_chrome() {
        let out = extract(ARTICLE, "https://example.com/post/1");
        let text = &out.markdown;
        assert_eq!(out.title, "The Story");
        assert_eq!(out.byline, "By Ada Lovelace");
        assert!(text.starts_with("# The Story"), "{text}");
        assert!(text.contains("**reason**") && text.contains("*patterns*"), "{text}");
        assert!(text.contains("[rules](https://example.com/docs/rules?a=1)"), "{text}");
        for chrome in ["Home", "newsletter", "Related links", "Copyright", "track()"] {
            assert!(!text.contains(chrome), "{chrome} leaked into {text}");
        }
    }

    #[test]
    fn converts_lists_code_and_tables() {
        let text = extract(ARTICLE, "https://example.com/").markdown;
        assert!(text.contains("- First item\n- Second item\n  - Nested item"), "{text}");
        assert!(text.contains("1. One\n2. Two"), "{text}");
        assert!(text.contains("```rust\nfn main() {\n    println!(\"hi\");\n}\n```"), "{text}");
        assert!(text.contains("`cargo test`"), "{text}");
        assert!(text.contains("Name | Score\nAnn | 3"), "{text}");
    }

    #[test]
    fn a_page_with_no_paragraphs_falls_back_to_the_body() {
        let out = extract("<html><body><div>Just a short line</div></body></html>", "https://example.com/");
        assert_eq!(out.markdown, "Just a short line");
    }

    #[test]
    fn a_link_dense_list_loses_to_the_prose() {
        let links: String = (0..12)
            .map(|n| format!("<li><a href=\"/p{n}\">Linked headline number {n} of the front page</a></li>"))
            .collect();
        let html = format!(
            "<html><body><div id=\"nav-list\"><ul>{links}</ul></div><div id=\"story\"><p>{}</p><p>{}</p></div></body></html>",
            "The real story is told here in long sentences, with detail, and with care. ".repeat(4),
            "It continues in a second paragraph, with more detail, and more care. ".repeat(3)
        );
        let text = extract(&html, "https://example.com/").markdown;
        assert!(text.starts_with("The real story"), "{text}");
        assert!(!text.contains("Linked headline"), "{text}");
    }
}
