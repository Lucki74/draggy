//! The readable text of a fetched page: its title and body text, without scripts, styles or page chrome.

use scraper::{ElementRef, Html, Node, Selector};

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
