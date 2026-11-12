//! Writes a PDF from Markdown or HTML. WebView2 lays the document out and prints it in a hidden window
//! with no capabilities and scripts switched off, as Electron's pdfWriter did in Chromium. The
//! Markdown converter is a line walk ported from `markdownHtml.cjs`.

use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use regex::{Captures, Regex};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::browser::cdp::Cdp;
use crate::browser::cdp_webview2::WebView2Cdp;

/// How long Chromium is given to lay out and to print one document.
const PRINT_TIMEOUT: Duration = Duration::from_secs(30);

/// Inches. A4 is 8.27 by 11.69 in, the same paper Electron asked for.
const PAPER_WIDTH: f64 = 8.27;
const PAPER_HEIGHT: f64 = 11.69;

const FOOTER_TEMPLATE: &str = r##"<div style="width:100%; font-family:sans-serif; font-size:8px; color:#888; text-align:center; margin:0 12mm;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>"##;

static WINDOWS: AtomicU64 = AtomicU64::new(0);

const PRINT_STYLES: &str = r##"
  @page { size: A4; margin: 18mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Aptos, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #111;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: "Aptos Display", Aptos, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #0f4761;
    line-height: 1.25;
    margin: 1.4em 0 0.5em;
    break-after: avoid;
    page-break-after: avoid;
  }
  h1 { font-size: 20pt; margin-top: 0; }
  h2 { font-size: 15pt; }
  h3 { font-size: 12.5pt; }
  h4, h5, h6 { font-size: 11pt; }
  p { margin: 0 0 0.75em; orphans: 2; widows: 2; }
  ul, ol { margin: 0 0 0.9em; padding-left: 1.6em; }
  li { margin: 0.2em 0; }
  a { color: #0b5cad; text-decoration: none; }
  code {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 9.5pt;
    background: #f2f2f4;
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  pre {
    background: #f6f6f8;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    padding: 10px 12px;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 1em;
  }
  pre code { background: none; padding: 0; font-size: 9pt; }
  blockquote {
    margin: 0 0 0.9em;
    padding: 0.1em 0 0.1em 0.9em;
    border-left: 3px solid #ccccd4;
    color: #444;
  }
  hr { border: none; border-top: 1px solid #d8d8de; margin: 1.4em 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1em;
    font-size: 10pt;
  }
  thead { display: table-header-group; }
  th, td {
    border: 1px solid #d0d0d8;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f2f2f4; font-weight: 600; }
  tr { break-inside: avoid; page-break-inside: avoid; }
"##;

static INLINE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`([^`]+)`").expect("regex"));
static STRONG_EM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\*\*([^*]+)\*\*\*").expect("regex"));
static STRONG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\*\*([^*]+)\*\*").expect("regex"));
static EMPHASIS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^|[^*])\*([^*]+)\*").expect("regex"));
static STRIKE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"~~([^~]+)~~").expect("regex"));
static LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\(([^)\s]+)\)").expect("regex"));
static SENTINEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x00(\d+)\x00").expect("regex"));
static HTTP_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https?://").expect("regex"));
static FENCE_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^`{3,}\s*([a-zA-Z0-9+#-]*)\s*$").expect("regex"));
static FENCE_CLOSE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^`{3,}\s*$").expect("regex"));
static RULE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(-{3,}|\*{3,}|_{3,})$").expect("regex"));
static HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(#{1,6})\s+(.*)$").expect("regex"));
static ALIGNMENT_ROW: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$").expect("regex"));
static LEADING_PIPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\|").expect("regex"));
static TRAILING_PIPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\|\s*$").expect("regex"));
static QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^>\s?(.*)$").expect("regex"));
static ORDERED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+[.)]\s+(.*)$").expect("regex"));
static BULLET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-*+]\s+(.*)$").expect("regex"));
static HTML_DOCTYPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*<!doctype\s+html").expect("regex"));
static HTML_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<\s*(?:html|body|div|p|h[1-6]|table|section|article|ul|ol|style|span|b|strong|em|i)\b[^>]*>")
        .expect("regex")
});
static DOCTYPE_OR_HTML: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<!doctype\b|<html\b").expect("regex"));
static HEAD_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<head\b[^>]*>").expect("regex"));
static SCRIPT_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<(/?script)\b").expect("regex"));

/// Escapes the five HTML-significant characters.
pub fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Code spans first, so their text is shown as written; emphasis, strike and links after.
pub fn inline_html(text: &str) -> String {
    let mut spans: Vec<String> = Vec::new();
    let marked = INLINE_CODE.replace_all(text, |caps: &Captures| {
        spans.push(format!("<code>{}</code>", escape_html(&caps[1])));
        // A NUL sentinel, so a number in the prose can never be mistaken for a span.
        format!("\u{0}{}\u{0}", spans.len() - 1)
    });
    let mut working = escape_html(&marked);
    working = STRONG_EM
        .replace_all(&working, "<strong><em>$1</em></strong>")
        .into_owned();
    working = STRONG
        .replace_all(&working, "<strong>$1</strong>")
        .into_owned();
    working = EMPHASIS.replace_all(&working, "$1<em>$2</em>").into_owned();
    working = STRIKE.replace_all(&working, "<del>$1</del>").into_owned();
    // Only http and https become links; any other href is reduced to its label.
    working = LINK
        .replace_all(&working, |caps: &Captures| {
            if HTTP_URL.is_match(&caps[2]) {
                format!("<a href=\"{}\">{}</a>", &caps[2], &caps[1])
            } else {
                caps[1].to_owned()
            }
        })
        .into_owned();
    SENTINEL
        .replace_all(&working, |caps: &Captures| {
            let index: usize = caps[1].parse().unwrap_or(0);
            spans.get(index).cloned().unwrap_or_default()
        })
        .into_owned()
}

fn is_table_row(line: &str) -> bool {
    line.contains('|') && !line.trim().is_empty()
}

fn table_row_cells(line: &str) -> Vec<String> {
    let without_lead = LEADING_PIPE.replace(line, "");
    let inner = TRAILING_PIPE.replace(&without_lead, "");
    inner
        .split('|')
        .map(|cell| cell.trim().to_owned())
        .collect()
}

fn close_list(out: &mut Vec<String>, list: &mut Option<&'static str>) {
    if let Some(tag) = list.take() {
        out.push(format!("</{tag}>"));
    }
}

fn open_list(out: &mut Vec<String>, list: &mut Option<&'static str>, tag: &'static str) {
    if *list != Some(tag) {
        close_list(out, list);
        out.push(format!("<{tag}>"));
        *list = Some(tag);
    }
}

/// Turns a Markdown document into HTML, one block at a time. Only the open list and fence are carried.
pub fn markdown_to_html(markdown: &str) -> String {
    let normalized = markdown.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut out: Vec<String> = Vec::new();
    let mut list: Option<&'static str> = None;
    let mut index = 0;

    while index < lines.len() {
        let raw = lines[index];
        let line = raw.trim();

        if let Some(fence) = FENCE_OPEN.captures(line) {
            close_list(&mut out, &mut list);
            index += 1;
            let mut body: Vec<&str> = Vec::new();
            while index < lines.len() && !FENCE_CLOSE.is_match(lines[index].trim()) {
                body.push(lines[index]);
                index += 1;
            }
            index += 1;
            let language = &fence[1];
            let attribute = if language.is_empty() {
                String::new()
            } else {
                format!(" data-language=\"{}\"", escape_html(language))
            };
            out.push(format!(
                "<pre{attribute}><code>{}</code></pre>",
                escape_html(&body.join("\n"))
            ));
            continue;
        }

        if line.is_empty() {
            close_list(&mut out, &mut list);
            index += 1;
            continue;
        }

        if RULE.is_match(line) {
            close_list(&mut out, &mut list);
            out.push("<hr />".to_owned());
            index += 1;
            continue;
        }

        if let Some(heading) = HEADING.captures(line) {
            close_list(&mut out, &mut list);
            let level = heading[1].len();
            out.push(format!("<h{level}>{}</h{level}>", inline_html(&heading[2])));
            index += 1;
            continue;
        }

        // A table needs its separator row; without it the pipes are only punctuation.
        if is_table_row(line)
            && index + 1 < lines.len()
            && ALIGNMENT_ROW.is_match(lines[index + 1])
            && lines[index + 1].contains('-')
        {
            close_list(&mut out, &mut list);
            let header = table_row_cells(line);
            index += 2;
            let mut body: Vec<Vec<String>> = Vec::new();
            while index < lines.len() && is_table_row(lines[index]) {
                body.push(table_row_cells(lines[index]));
                index += 1;
            }
            let head: String = header
                .iter()
                .map(|cell| format!("<th>{}</th>", inline_html(cell)))
                .collect();
            let rows: String = body
                .iter()
                .map(|cells| {
                    let row: String = cells
                        .iter()
                        .map(|cell| format!("<td>{}</td>", inline_html(cell)))
                        .collect();
                    format!("<tr>{row}</tr>")
                })
                .collect();
            out.push(format!(
                "<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"
            ));
            continue;
        }

        if let Some(quote) = QUOTE.captures(line) {
            close_list(&mut out, &mut list);
            out.push(format!(
                "<blockquote>{}</blockquote>",
                inline_html(&quote[1])
            ));
            index += 1;
            continue;
        }

        if let Some(item) = ORDERED.captures(line) {
            open_list(&mut out, &mut list, "ol");
            out.push(format!("<li>{}</li>", inline_html(&item[1])));
            index += 1;
            continue;
        }

        if let Some(item) = BULLET.captures(line) {
            open_list(&mut out, &mut list, "ul");
            out.push(format!("<li>{}</li>", inline_html(&item[1])));
            index += 1;
            continue;
        }

        close_list(&mut out, &mut list);
        out.push(format!("<p>{}</p>", inline_html(line)));
        index += 1;
    }

    close_list(&mut out, &mut list);
    out.join("\n")
}

/// Whether the text is HTML rather than Markdown: a doctype, or a common block or inline tag.
fn is_html(content: &str) -> bool {
    let trimmed = content.trim();
    HTML_DOCTYPE.is_match(trimmed) || HTML_TAG.is_match(trimmed)
}

/// True when the byte at `index` does not continue a word, as a regex `\b` after a name would require.
fn is_word_boundary(lower: &str, index: usize) -> bool {
    lower
        .as_bytes()
        .get(index)
        .is_none_or(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_'))
}

/// The end of the first `</script>` at or after `from`, including its `>`. None when it never closes.
fn closing_end(lower: &str, from: usize) -> Option<usize> {
    let mut search = from;
    while let Some(relative) = lower[search..].find("</script") {
        let name_end = search + relative + "</script".len();
        if is_word_boundary(lower, name_end) {
            let gt = lower[name_end..].find('>')?;
            return Some(name_end + gt + 1);
        }
        search = name_end;
    }
    None
}

/// One pass: each script element becomes a space. Unclosed opening tags are left for the escape.
fn remove_script_elements(html: &str) -> String {
    // ASCII lowercasing keeps every byte offset of the original.
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find("<script") {
        let start = cursor + relative;
        let after_name = start + "<script".len();
        let end = if is_word_boundary(&lower, after_name) {
            closing_end(&lower, after_name)
        } else {
            None
        };
        match end {
            Some(end) => {
                out.push_str(&html[cursor..start]);
                out.push(' ');
                cursor = end;
            }
            None => {
                out.push_str(&html[cursor..after_name]);
                cursor = after_name;
            }
        }
    }
    out.push_str(&html[cursor..]);
    out
}

/// Takes every script element out. Removing one can join its neighbours into a new tag, so the pass
/// repeats until nothing changes; any `<script` left is escaped so no browser runs it.
fn strip_scripts(html: &str) -> String {
    let mut current = html.to_owned();
    loop {
        let next = remove_script_elements(&current);
        if next == current {
            break;
        }
        current = next;
    }
    SCRIPT_TAG.replace_all(&current, "&lt;$1").into_owned()
}

/// The full page handed to the printer. Its policy blocks every network fetch; scripts are off too.
pub fn build_document(content: &str, title: &str) -> String {
    let safe_title = escape_html(if title.is_empty() { "Document" } else { title });
    let csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;\" />";

    if is_html(content) {
        let raw = strip_scripts(content);
        if DOCTYPE_OR_HTML.is_match(&raw) {
            if let Some(head) = HEAD_OPEN.find(&raw) {
                let insert = format!("\n{csp}\n<style>{PRINT_STYLES}</style>");
                return format!("{}{insert}{}", &raw[..head.end()], &raw[head.end()..]);
            }
            return format!("{csp}\n<style>{PRINT_STYLES}</style>\n{raw}");
        }
        return format!(
            "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n{csp}\n<title>{safe_title}</title>\n<style>{PRINT_STYLES}</style>\n</head>\n<body>\n{raw}\n</body>\n</html>"
        );
    }

    format!(
        "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n{csp}\n<title>{safe_title}</title>\n<style>{PRINT_STYLES}</style>\n</head>\n<body>\n{}\n</body>\n</html>",
        markdown_to_html(content)
    )
}

/// Writes `content` as a PDF at `path`. The window is destroyed whether or not printing works.
pub async fn write_pdf(app: &AppHandle, path: &Path, content: &str) -> Result<(), String> {
    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Document");
    let html = build_document(content, title);

    let label = format!("pdf-writer-{}", WINDOWS.fetch_add(1, Ordering::Relaxed));
    let blank = Url::parse("about:blank").map_err(|error| error.to_string())?;
    // No capability names this label, so the page has no IPC, events or plugins.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .focused(false)
        .inner_size(794.0, 1123.0)
        .build()
        .map_err(|error| error.to_string())?;

    let printed = match app.get_webview(&label) {
        Some(webview) => print(&WebView2Cdp::new(webview), &html).await,
        None => Err("the print window is not available".to_owned()),
    };
    let _ = window.destroy();

    let bytes = printed?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

/// Sends one command, failing with `message` if the page does not answer in time.
async fn send(cdp: &impl Cdp, method: &str, params: Value, message: &str) -> Result<Value, String> {
    match tokio::time::timeout(PRINT_TIMEOUT, cdp.call(method, params)).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error.0),
        Err(_) => Err(message.to_owned()),
    }
}

async fn print(cdp: &impl Cdp, html: &str) -> Result<Vec<u8>, String> {
    const LAYOUT: &str = "The document took too long to lay out.";
    const PRINTING: &str = "The document took too long to print.";

    send(
        cdp,
        "Emulation.setScriptExecutionDisabled",
        json!({ "value": true }),
        LAYOUT,
    )
    .await?;
    let tree = send(cdp, "Page.getFrameTree", json!({}), LAYOUT).await?;
    let frame_id = tree["frameTree"]["frame"]["id"]
        .as_str()
        .ok_or("the print window has no page")?
        .to_owned();
    send(
        cdp,
        "Page.setDocumentContent",
        json!({ "frameId": frame_id, "html": html }),
        LAYOUT,
    )
    .await?;

    let pdf = send(
        cdp,
        "Page.printToPDF",
        json!({
            "printBackground": true,
            "paperWidth": PAPER_WIDTH,
            "paperHeight": PAPER_HEIGHT,
            "marginTop": 0.7,
            "marginBottom": 0.7,
            "marginLeft": 0.65,
            "marginRight": 0.65,
            "displayHeaderFooter": true,
            "headerTemplate": "<div></div>",
            "footerTemplate": FOOTER_TEMPLATE,
            "generateTaggedPDF": true,
            "generateDocumentOutline": true,
        }),
        PRINTING,
    )
    .await?;
    let data = pdf["data"]
        .as_str()
        .ok_or("the printer returned no document")?;
    STANDARD
        .decode(data)
        .map_err(|_| "the printer returned an unreadable document".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_renders_blocks_and_safe_links() {
        let html = markdown_to_html(
            "# Title\n\n- **bold** and `<x>`\n- [bad](javascript:alert(1)) [ok](https://x.test)\n\n```rust\nlet a = 1 < 2;\n```",
        );
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<ul>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<code>&lt;x&gt;</code>"));
        assert!(!html.contains("javascript:"));
        assert!(html.contains("<a href=\"https://x.test\">ok</a>"));
        assert!(html.contains("<pre data-language=\"rust\"><code>let a = 1 &lt; 2;</code></pre>"));
    }

    #[test]
    fn markdown_tables_need_a_separator_row() {
        let html = markdown_to_html("| a | b |\n|---|---|\n| 1 | 2 |");
        assert!(html.contains("<th>a</th>"));
        assert!(html.contains("<td>1</td><td>2</td>"));
        let plain = markdown_to_html("a | b");
        assert_eq!(plain, "<p>a | b</p>");
    }

    #[test]
    fn html_documents_lose_their_scripts() {
        let page = build_document("<p>hi</p><scr<script>x()</script>ipt>", "t");
        assert!(page.contains("<p>hi</p>"));
        assert!(!page.to_ascii_lowercase().contains("<script>x"));
        assert!(page.contains("Content-Security-Policy"));
    }
}
