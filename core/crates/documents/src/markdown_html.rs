//! Markdown or HTML to a complete printable page. Ports electron/markdownHtml.cjs. The Markdown reader stays a line
//! walker: the fixtures pin its output byte for byte, and a CommonMark parser would not reproduce it.

use std::sync::LazyLock;

use crate::html::is_html;
use crate::js::{
    JS_DOT, Pattern, captures, ci, compile, is_match, replace_all, replace_first, trim,
};

/// The stylesheet a document is laid out with, extracted byte for byte from the reference.
pub const PRINT_STYLES: &str = include_str!("templates/print_styles.css");

const CSP: &str = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />"#;

/// Escapes the five characters that would change the markup. Nothing gives the empty string.
pub fn escape_html(value: Option<&str>) -> String {
    let mut out = String::new();
    for character in value.unwrap_or("").chars() {
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

static CODE: Pattern = LazyLock::new(|| compile("`([^`]+)`"));
static STRONG_EM: Pattern = LazyLock::new(|| compile(r"\*\*\*([^*]+)\*\*\*"));
static STRONG: Pattern = LazyLock::new(|| compile(r"\*\*([^*]+)\*\*"));
static EM: Pattern = LazyLock::new(|| compile(r"(^|[^*])\*([^*]+)\*"));
static DEL: Pattern = LazyLock::new(|| compile("~~([^~]+)~~"));
static LINK: Pattern = LazyLock::new(|| compile(r"\[([^\]]+)\]\(([^){S}]+)\)"));
static HTTP_HREF: Pattern = LazyLock::new(|| compile(&format!("^{}{}?://", ci("http"), ci("s"))));
static PLACEHOLDER: Pattern = LazyLock::new(|| compile(r"\x00([0-9]+)\x00"));

/// Emphasis, code spans and links. Code spans come out first and go back last, so a document about Markdown can
/// show the syntax it describes. Only http and https become links.
pub fn inline_html(text: &str) -> String {
    let mut spans: Vec<String> = Vec::new();
    let working = replace_all(&CODE, text, |caps| {
        spans.push(format!("<code>{}</code>", escape_html(Some(&caps[1]))));
        // A NUL sentinel, so a number in the text cannot be mistaken for a span index.
        format!("\u{0}{}\u{0}", spans.len() - 1)
    });
    let working = escape_html(Some(&working));
    let working = replace_all(&STRONG_EM, &working, |caps| {
        format!("<strong><em>{}</em></strong>", &caps[1])
    });
    let working = replace_all(&STRONG, &working, |caps| {
        format!("<strong>{}</strong>", &caps[1])
    });
    let working = replace_all(&EM, &working, |caps| {
        format!("{}<em>{}</em>", &caps[1], &caps[2])
    });
    let working = replace_all(&DEL, &working, |caps| format!("<del>{}</del>", &caps[1]));
    let working = replace_all(&LINK, &working, |caps| {
        let label = &caps[1];
        let href = &caps[2];
        if is_match(&HTTP_HREF, href) {
            format!("<a href=\"{href}\">{label}</a>")
        } else {
            label.to_owned()
        }
    });
    // TS quirk: a NUL and digits typed by the model read back as a span, or as "undefined" with none.
    // The reference does this too, and the fixtures pin it.
    replace_all(&PLACEHOLDER, &working, |caps| {
        caps[1]
            .parse::<usize>()
            .ok()
            .and_then(|index| spans.get(index).cloned())
            .unwrap_or_else(|| "undefined".to_owned())
    })
}

static FENCE: Pattern = LazyLock::new(|| compile(r"^```+[{S}]*([a-zA-Z0-9+#-]*)[{S}]*$"));
static FENCE_CLOSE: Pattern = LazyLock::new(|| compile(r"^```+[{S}]*$"));
static RULE: Pattern = LazyLock::new(|| compile(r"^(-{3,}|\*{3,}|_{3,})$"));
// TS quirk: "." does not match a carriage return in JavaScript, so a lone CR stops a heading. Kept.
static HEADING: Pattern = LazyLock::new(|| compile(&format!(r"^(#{{1,6}})[{{S}}]+({JS_DOT}*)$")));
static ALIGNMENT_ROW: Pattern =
    LazyLock::new(|| compile(r"^[{S}]*\|?[{S}:-]*-[{S}:|-]*\|?[{S}]*$"));
static PIPE_LEAD: Pattern = LazyLock::new(|| compile(r"^[{S}]*\|"));
static PIPE_TRAIL: Pattern = LazyLock::new(|| compile(r"\|[{S}]*$"));
static QUOTE: Pattern = LazyLock::new(|| compile(&format!(r"^>[{{S}}]?({JS_DOT}*)$")));
static ORDERED: Pattern = LazyLock::new(|| compile(&format!(r"^[0-9]+[.)][{{S}}]+({JS_DOT}*)$")));
static BULLET: Pattern = LazyLock::new(|| compile(&format!(r"^[-*+][{{S}}]+({JS_DOT}*)$")));

/// Whether a line can be a table row: it has a pipe and some text.
fn is_table_row(line: &str) -> bool {
    line.contains('|') && !trim(line).is_empty()
}

/// The cells of a table row, without its outer pipes, each trimmed.
fn table_row_cells(line: &str) -> Vec<String> {
    let without_lead = replace_first(&PIPE_LEAD, line, |_| String::new());
    let inner = replace_first(&PIPE_TRAIL, &without_lead, |_| String::new());
    inner.split('|').map(|cell| trim(cell).to_owned()).collect()
}

fn close_list(out: &mut Vec<String>, list_tag: &mut Option<&'static str>) {
    if let Some(tag) = list_tag.take() {
        out.push(format!("</{tag}>"));
    }
}

fn open_list(out: &mut Vec<String>, list_tag: &mut Option<&'static str>, tag: &'static str) {
    if *list_tag != Some(tag) {
        close_list(out, list_tag);
        out.push(format!("<{tag}>"));
        *list_tag = Some(tag);
    }
}

/// Converts a Markdown document one block at a time. The only state carried is whether a list or a fence is open.
pub fn markdown_to_html(markdown: Option<&str>) -> String {
    let text = markdown.unwrap_or("").replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<String> = Vec::new();
    let mut list_tag: Option<&'static str> = None;
    let mut index = 0;

    while index < lines.len() {
        let line = trim(lines[index]);

        if let Some(fence) = captures(&FENCE, line) {
            close_list(&mut out, &mut list_tag);
            let language = &fence[1];
            let mut body: Vec<&str> = Vec::new();
            index += 1;
            while index < lines.len() && !is_match(&FENCE_CLOSE, trim(lines[index])) {
                body.push(lines[index]);
                index += 1;
            }
            index += 1;
            let language_attr = if language.is_empty() {
                String::new()
            } else {
                format!(" data-language=\"{}\"", escape_html(Some(language)))
            };
            out.push(format!(
                "<pre{language_attr}><code>{}</code></pre>",
                escape_html(Some(&body.join("\n")))
            ));
            continue;
        }

        if line.is_empty() {
            close_list(&mut out, &mut list_tag);
            index += 1;
            continue;
        }

        if is_match(&RULE, line) {
            close_list(&mut out, &mut list_tag);
            out.push("<hr />".to_owned());
            index += 1;
            continue;
        }

        if let Some(heading) = captures(&HEADING, line) {
            close_list(&mut out, &mut list_tag);
            let level = heading[1].len();
            out.push(format!("<h{level}>{}</h{level}>", inline_html(&heading[2])));
            index += 1;
            continue;
        }

        // A table needs its separator row; without it the pipes are only punctuation in a sentence.
        if is_table_row(line)
            && index + 1 < lines.len()
            && is_match(&ALIGNMENT_ROW, lines[index + 1])
            && lines[index + 1].contains('-')
        {
            close_list(&mut out, &mut list_tag);
            let header = table_row_cells(line);
            index += 2;
            let mut body: Vec<Vec<String>> = Vec::new();
            while index < lines.len()
                && is_table_row(lines[index])
                && !trim(lines[index]).is_empty()
            {
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
                    let tds: String = cells
                        .iter()
                        .map(|cell| format!("<td>{}</td>", inline_html(cell)))
                        .collect();
                    format!("<tr>{tds}</tr>")
                })
                .collect();
            out.push(format!(
                "<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"
            ));
            continue;
        }

        if let Some(quote) = captures(&QUOTE, line) {
            close_list(&mut out, &mut list_tag);
            out.push(format!(
                "<blockquote>{}</blockquote>",
                inline_html(&quote[1])
            ));
            index += 1;
            continue;
        }

        if let Some(item) = captures(&ORDERED, line) {
            open_list(&mut out, &mut list_tag, "ol");
            out.push(format!("<li>{}</li>", inline_html(&item[1])));
            index += 1;
            continue;
        }

        if let Some(item) = captures(&BULLET, line) {
            open_list(&mut out, &mut list_tag, "ul");
            out.push(format!("<li>{}</li>", inline_html(&item[1])));
            index += 1;
            continue;
        }

        close_list(&mut out, &mut list_tag);
        out.push(format!("<p>{}</p>", inline_html(line)));
        index += 1;
    }

    close_list(&mut out, &mut list_tag);
    out.join("\n")
}

static DOCTYPE_TAG: Pattern = LazyLock::new(|| compile(&format!("<!{}(?-u:\\b)", ci("doctype"))));
static HTML_OPEN: Pattern = LazyLock::new(|| compile(&format!("<{}(?-u:\\b)", ci("html"))));
static HEAD_OPEN: Pattern = LazyLock::new(|| compile(&format!("<{}(?-u:\\b)", ci("head"))));
static HEAD_TAG: Pattern = LazyLock::new(|| compile(&format!("<{}(?-u:\\b)[^>]*>", ci("head"))));
static SCRIPT_TAG_NAME: Pattern =
    LazyLock::new(|| compile(&format!("<(/?{})(?-u:\\b)", ci("script"))));

/// Whether the text at `at` starts with `word`, ignoring ASCII case.
fn ascii_word_at(bytes: &[u8], at: usize, word: &str) -> bool {
    bytes
        .get(at..at + word.len())
        .is_some_and(|found| found.eq_ignore_ascii_case(word.as_bytes()))
}

/// Whether a byte continues a word, which is what a `\b` after a tag name must not see.
fn continues_word(byte: Option<&u8>) -> bool {
    byte.is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

/// The first `<script` at or after `from` whose name ends at a word boundary.
fn find_script_open(bytes: &[u8], from: usize) -> Option<usize> {
    (from..bytes.len()).find(|&i| {
        bytes[i] == b'<'
            && ascii_word_at(bytes, i + 1, "script")
            && !continues_word(bytes.get(i + 7))
    })
}

/// The first `</script` at or after `from` whose name ends at a word boundary.
fn find_script_close(bytes: &[u8], from: usize) -> Option<usize> {
    (from..bytes.len()).find(|&i| {
        bytes[i] == b'<'
            && bytes.get(i + 1) == Some(&b'/')
            && ascii_word_at(bytes, i + 2, "script")
            && !continues_word(bytes.get(i + 8))
    })
}

/// The end, exclusive, of the script element that opens at `start`, if one closes. The closing tag is the first
/// `</script` after the open tag, and it ends at the next `>`, whatever junk comes between.
fn script_element_end(bytes: &[u8], start: usize) -> Option<usize> {
    let close = find_script_close(bytes, start + 7)?;
    let gt = bytes.get(close + 8..)?.iter().position(|&b| b == b'>')?;
    Some(close + 8 + gt + 1)
}

/// One pass over the text: each script element becomes a space, which keeps the text either side apart.
fn remove_script_elements(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut search = 0;
    while let Some(start) = find_script_open(bytes, search) {
        match script_element_end(bytes, start) {
            Some(end) => {
                out.push_str(&text[copied..start]);
                out.push(' ');
                copied = end;
                search = end;
            }
            None => search = start + 1,
        }
    }
    out.push_str(&text[copied..]);
    out
}

/// Takes every script element out of `html`, repeating until nothing changes, then escapes any `<script` left
/// over so a browser cannot run to the end of the page on it.
fn strip_scripts(html: &str) -> String {
    let mut current = html.to_owned();
    loop {
        let next = remove_script_elements(&current);
        if next == current {
            break;
        }
        current = next;
    }
    replace_all(&SCRIPT_TAG_NAME, &current, |caps| {
        format!("&lt;{}", &caps[1])
    })
}

/// The page handed to the PDF step. HTML is framed with the policy and print styles, Markdown is converted block by
/// block, and the policy forbids any fetch from the page.
pub fn build_document(content: Option<&str>, title: Option<&str>) -> String {
    let safe_title = escape_html(Some(title.filter(|t| !t.is_empty()).unwrap_or("Document")));

    if is_html(content) {
        let raw = strip_scripts(content.unwrap_or(""));
        if is_match(&DOCTYPE_TAG, &raw) || is_match(&HTML_OPEN, &raw) {
            if is_match(&HEAD_OPEN, &raw) {
                return replace_first(&HEAD_TAG, &raw, |caps| {
                    format!("{}\n{CSP}\n<style>{PRINT_STYLES}</style>", &caps[0])
                });
            }
            return format!("{CSP}\n<style>{PRINT_STYLES}</style>\n{raw}");
        }
        return page(&safe_title, &raw);
    }

    page(&safe_title, &markdown_to_html(content))
}

fn page(safe_title: &str, body: &str) -> String {
    let mut out = String::from("<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n");
    out.push_str(CSP);
    out.push_str("\n<title>");
    out.push_str(safe_title);
    out.push_str("</title>\n<style>");
    out.push_str(PRINT_STYLES);
    out.push_str("</style>\n</head>\n<body>\n");
    out.push_str(body);
    out.push_str("\n</body>\n</html>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_the_characters_that_would_change_the_markup() {
        assert_eq!(
            escape_html(Some("<script>&\"'")),
            "&lt;script&gt;&amp;&quot;&#39;"
        );
        assert_eq!(escape_html(Some("plain words")), "plain words");
        assert_eq!(escape_html(None), "");
    }

    #[test]
    fn renders_bold_italic_and_both_together() {
        assert_eq!(inline_html("**b**"), "<strong>b</strong>");
        assert_eq!(inline_html("*i*"), "<em>i</em>");
        assert_eq!(inline_html("***x***"), "<strong><em>x</em></strong>");
    }

    #[test]
    fn renders_strikethrough_and_code_spans() {
        assert_eq!(inline_html("~~gone~~"), "<del>gone</del>");
        assert_eq!(
            inline_html("run `npm test` now"),
            "run <code>npm test</code> now"
        );
    }

    #[test]
    fn leaves_markup_inside_a_code_span_literal() {
        assert_eq!(inline_html("`**not bold**`"), "<code>**not bold**</code>");
    }

    #[test]
    fn does_not_mistake_a_number_for_a_code_span() {
        assert_eq!(inline_html("I have 3 apples"), "I have 3 apples");
        assert_eq!(
            inline_html("`a` and 0 and `b`"),
            "<code>a</code> and 0 and <code>b</code>"
        );
    }

    #[test]
    fn escapes_html_the_model_wrote() {
        assert!(inline_html("<img src=x onerror=alert(1)>").contains("&lt;img"));
        assert!(!inline_html("<b>hi</b>").contains("<b>"));
    }

    #[test]
    fn links_http_and_https_and_drops_any_other_scheme() {
        assert_eq!(
            inline_html("[site](https://example.com)"),
            r#"<a href="https://example.com">site</a>"#
        );
        assert_eq!(inline_html("[click](javascript:alert)"), "click");
        assert_eq!(inline_html("[file](file:///etc/passwd)"), "file");
        assert!(!inline_html("[x](data:text/html,<script>)").contains("<a "));
    }

    #[test]
    fn stops_a_link_at_the_first_closing_bracket() {
        assert_eq!(
            inline_html("[a](https://e.com/x(1))"),
            r#"<a href="https://e.com/x(1">a</a>)"#
        );
    }

    #[test]
    fn renders_headings_at_every_level() {
        assert_eq!(markdown_to_html(Some("# One")), "<h1>One</h1>");
        assert_eq!(markdown_to_html(Some("###### Six")), "<h6>Six</h6>");
    }

    #[test]
    fn groups_consecutive_bullets_and_numbers() {
        assert_eq!(
            markdown_to_html(Some("- a\n- b\n- c")),
            "<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>"
        );
        assert_eq!(
            markdown_to_html(Some("1. a\n2. b")),
            "<ol>\n<li>a</li>\n<li>b</li>\n</ol>"
        );
    }

    #[test]
    fn closes_a_list_when_the_prose_resumes() {
        assert_eq!(
            markdown_to_html(Some("- a\n\nAfter.")),
            "<ul>\n<li>a</li>\n</ul>\n<p>After.</p>"
        );
    }

    #[test]
    fn starts_a_new_list_when_the_kind_changes() {
        let html = markdown_to_html(Some("- a\n1. b"));
        assert!(html.contains("</ul>"));
        assert!(html.contains("<ol>"));
    }

    #[test]
    fn renders_rules_and_blockquotes() {
        assert_eq!(markdown_to_html(Some("---")), "<hr />");
        assert_eq!(markdown_to_html(Some("***")), "<hr />");
        assert_eq!(
            markdown_to_html(Some("> quoted")),
            "<blockquote>quoted</blockquote>"
        );
    }

    #[test]
    fn keeps_a_fenced_block_verbatim_and_unformatted() {
        let html = markdown_to_html(Some("```js\nconst a = 1 < 2;\n```"));
        assert!(html.contains(r#"data-language="js""#));
        assert!(html.contains("const a = 1 &lt; 2;"));
        let plain = markdown_to_html(Some("```\n**not bold**\n```"));
        assert!(plain.contains("**not bold**"));
        assert!(!plain.contains("<strong>"));
    }

    #[test]
    fn closes_an_unterminated_fence_at_the_end() {
        assert!(
            markdown_to_html(Some("```\nstill code"))
                .contains("<pre><code>still code</code></pre>")
        );
    }

    #[test]
    fn renders_a_table_with_its_header() {
        let html = markdown_to_html(Some("| a | b |\n| --- | --- |\n| 1 | 2 |"));
        assert!(html.contains("<th>a</th>"));
        assert!(html.contains("<td>1</td>"));
    }

    #[test]
    fn needs_the_separator_row_before_it_calls_something_a_table() {
        assert_eq!(
            markdown_to_html(Some("a | b is a choice")),
            "<p>a | b is a choice</p>"
        );
    }

    #[test]
    fn handles_an_empty_document_and_crlf_line_endings() {
        assert_eq!(markdown_to_html(Some("")), "");
        assert_eq!(markdown_to_html(None), "");
        assert_eq!(
            markdown_to_html(Some("# A\r\n\r\nB")),
            "<h1>A</h1>\n<p>B</p>"
        );
    }

    #[test]
    fn the_printable_document_is_a_complete_page_that_carries_the_content() {
        let html = build_document(Some("# Title\n\nBody text."), Some("report"));
        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("</html>"));
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<p>Body text.</p>"));
        assert!(html.contains("<title>report</title>"));
        assert!(html.contains("default-src 'none'"));
        assert!(html.contains("@page"));
        assert!(html.contains("A4"));
    }

    #[test]
    fn escapes_a_title_that_contains_markup() {
        assert!(
            build_document(Some("x"), Some("<script>")).contains("<title>&lt;script&gt;</title>")
        );
    }

    #[test]
    fn frames_an_html_fragment_inside_the_body() {
        let fragment = r#"<h1 style="color: blue;">Direct HTML</h1><p>Styled text</p>"#;
        let doc = build_document(Some(fragment), Some("styled"));
        assert!(doc.contains(r#"<h1 style="color: blue;">Direct HTML</h1>"#));
        assert!(doc.contains("<p>Styled text</p>"));
        assert!(doc.contains("default-src 'none'"));
    }

    #[test]
    fn strips_script_tags_from_html_content() {
        let doc = build_document(
            Some(r#"<h1>Hello</h1><script>alert("hack")</script>"#),
            Some("safe"),
        );
        assert!(doc.contains("<h1>Hello</h1>"));
        assert!(!doc.contains("alert"));
        assert!(!doc.contains("<script>"));
    }

    #[test]
    fn removing_one_script_does_not_join_the_text_around_it_into_another() {
        let joined = [
            "<scr<script></script>ipt>alert(1)</script>",
            "<scr<script></script><script></script>ipt>alert(1)</script>",
            "<<script></script>script>alert(1)</script>",
            "<scr<script>x</script>ipt>alert(1)</scr<script>x</script>ipt>",
        ];
        for html in joined {
            let doc = build_document(Some(&format!("<h1>Hi</h1>{html}")), Some("t"));
            assert!(!doc.to_lowercase().contains("<script"), "{html}");
            assert!(!doc.to_lowercase().contains("</script"), "{html}");
        }
    }

    #[test]
    fn an_unclosed_script_is_escaped_not_run_to_the_end() {
        let doc = build_document(Some(r#"<h1>Hi</h1><script>alert("hack")"#), Some("t"));
        assert!(!doc.to_lowercase().contains("<script"));
        assert!(doc.contains("&lt;script"));
        assert!(doc.contains("<h1>Hi</h1>"));
    }

    #[test]
    fn a_closing_tag_with_junk_or_a_newline_still_ends_the_script() {
        for dangerous in [
            "<h1>Hello</h1><script>alert(\"hack\")</script foo>",
            "<h1>Hello</h1><script>alert(\"hack\")</script\n>",
        ] {
            let doc = build_document(Some(dangerous), Some("safe"));
            assert!(doc.contains("<h1>Hello</h1>"));
            assert!(!doc.contains("alert"));
            assert!(!doc.contains("<script"));
        }
    }

    #[test]
    fn the_print_stylesheet_is_the_reference_one() {
        assert!(PRINT_STYLES.starts_with("\n  @page { size: A4;"));
    }
}
