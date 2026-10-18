//! Markdown in assistant replies, read into blocks the widgets draw. Text leaves as Pango markup with every character
//! escaped, so no reply can change the markup around it. Nothing here needs a display.

/// One block of a reply. Text blocks hold Pango markup; code keeps its characters as they are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Paragraph(String),
    Heading(String),
    Quote(String),
    /// A list item with its marker: a bullet, or the number as the reply typed it.
    Item { marker: String, markup: String },
    Code { language: String, code: String },
}

/// Reads a reply into blocks. A fence that is never closed runs to the end, which suits a reply still arriving.
pub fn parse(text: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut lines = text.lines();
    // True while the previous line was plain text, so the next plain line continues the same paragraph.
    let mut joins = false;
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            joins = false;
        } else if let Some((marker, language)) = fence_open(trimmed) {
            let mut code = Vec::new();
            for inner in lines.by_ref() {
                if closes_fence(inner, marker) {
                    break;
                }
                code.push(inner);
            }
            blocks.push(Block::Code {
                language,
                code: code.join("\n"),
            });
            joins = false;
        } else if let Some(rest) = heading(trimmed) {
            blocks.push(Block::Heading(inline(rest)));
            joins = false;
        } else if let Some(rest) = trimmed.strip_prefix('>') {
            let markup = inline(rest.trim_start());
            if let Some(Block::Quote(text)) = blocks.last_mut().filter(|_| joins) {
                text.push('\n');
                text.push_str(&markup);
            } else {
                blocks.push(Block::Quote(markup));
            }
            joins = true;
        } else if let Some((marker, rest)) = list_item(trimmed) {
            blocks.push(Block::Item {
                marker,
                markup: inline(rest),
            });
            joins = false;
        } else {
            let markup = inline(trimmed);
            if let Some(Block::Paragraph(text)) = blocks.last_mut().filter(|_| joins) {
                text.push('\n');
                text.push_str(&markup);
            } else {
                blocks.push(Block::Paragraph(markup));
            }
            joins = true;
        }
    }
    blocks
}

/// The fence character and the language after an opening fence of three or more backticks or tildes.
fn fence_open(trimmed: &str) -> Option<(char, String)> {
    let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let run = trimmed.chars().take_while(|c| *c == marker).count();
    if run < 3 {
        return None;
    }
    let language = trimmed[run..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    Some((marker, language))
}

/// A closing fence is a line of nothing but the same marker, at least as long as the opening one. The length is not
/// tracked, so a longer closing run also closes the block.
fn closes_fence(line: &str, marker: char) -> bool {
    let trimmed = line.trim();
    trimmed.len() >= 3 && trimmed.chars().all(|c| c == marker)
}

/// The text of an ATX heading such as `## Title`. A `#` without the space after it is plain text.
fn heading(trimmed: &str) -> Option<&str> {
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&hashes) || !trimmed[hashes..].starts_with(' ') {
        return None;
    }
    Some(trimmed[hashes..].trim())
}

/// A bullet or numbered item: its marker and the rest of the line. A bullet becomes "•"; a number keeps its dot.
fn list_item(trimmed: &str) -> Option<(String, &str)> {
    for bullet in ["- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(bullet) {
            return Some(("•".to_owned(), rest));
        }
    }
    let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let after = &trimmed[digits..];
    let rest = after
        .strip_prefix(". ")
        .or_else(|| after.strip_prefix(") "))?;
    Some((format!("{}.", &trimmed[..digits]), rest))
}

/// Pango markup for a run of text: code spans, bold, italic and http or https links. Every other character is
/// escaped. A marker without a partner stays as typed.
pub fn inline(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if let Some((markup, next)) = styled(&chars, i) {
            out.push_str(&markup);
            i = next;
        } else {
            out.push_str(&escape(&chars[i].to_string()));
            i += 1;
        }
    }
    out
}

/// A span starting at `start`, its markup, and the index just past it. `None` when nothing starts a span there.
fn styled(chars: &[char], start: usize) -> Option<(String, usize)> {
    match chars[start] {
        '`' => {
            let run = run_length(chars, start, '`');
            let end = find_run(chars, start + run, '`', run)?;
            let code: String = chars[start + run..end].iter().collect();
            let markup = format!("<span font_family=\"monospace\">{}</span>", escape(&code));
            Some((markup, end + run))
        }
        '*' if chars.get(start + 1) == Some(&'*') => {
            let end = find_run(chars, start + 2, '*', 2)?;
            if end == start + 2 {
                return None;
            }
            let inner: String = chars[start + 2..end].iter().collect();
            Some((format!("<b>{}</b>", inline(&inner)), end + 2))
        }
        '*' => {
            let next = *chars.get(start + 1)?;
            if next.is_whitespace() || next == '*' {
                return None;
            }
            let end = (start + 2..chars.len()).find(|&k| {
                chars[k] == '*' && !chars[k - 1].is_whitespace() && chars.get(k + 1) != Some(&'*')
            })?;
            let inner: String = chars[start + 1..end].iter().collect();
            Some((format!("<i>{}</i>", inline(&inner)), end + 1))
        }
        '[' => link(chars, start),
        _ => None,
    }
}

/// A link `[text](url)` whose address is http or https. Anything else stays as typed text.
fn link(chars: &[char], start: usize) -> Option<(String, usize)> {
    let close = (start + 1..chars.len()).find(|&k| chars[k] == ']')?;
    if chars.get(close + 1) != Some(&'(') || close == start + 1 {
        return None;
    }
    let end = (close + 2..chars.len()).find(|&k| chars[k] == ')')?;
    let url: String = chars[close + 2..end].iter().collect();
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    let label: String = chars[start + 1..close].iter().collect();
    let markup = format!("<a href=\"{}\">{}</a>", escape(url.trim()), inline(&label));
    Some((markup, end + 1))
}

fn run_length(chars: &[char], start: usize, marker: char) -> usize {
    chars[start..].iter().take_while(|c| **c == marker).count()
}

/// The start of the next run of exactly `count` markers at or after `from`.
fn find_run(chars: &[char], from: usize, marker: char, count: usize) -> Option<usize> {
    (from..=chars.len().saturating_sub(count)).find(|&k| {
        chars[k..k + count].iter().all(|c| *c == marker) && chars.get(k + count) != Some(&marker)
    })
}

/// Escapes the characters that Pango markup reads as markup.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(markup: &str) -> Block {
        Block::Paragraph(markup.to_owned())
    }

    #[test]
    fn lines_join_into_one_paragraph_and_a_blank_line_ends_it() {
        assert_eq!(parse("a\nb\n\nc"), [text("a\nb"), text("c")]);
    }

    #[test]
    fn headings_need_a_space_after_the_hashes() {
        assert_eq!(parse("## Title"), [Block::Heading("Title".to_owned())]);
        assert_eq!(parse("#Title"), [text("#Title")]);
    }

    #[test]
    fn a_fenced_block_keeps_its_language_and_its_characters() {
        assert_eq!(
            parse("```rust\nlet a = 1 < 2 && **b**;\n```"),
            [Block::Code {
                language: "rust".to_owned(),
                code: "let a = 1 < 2 && **b**;".to_owned(),
            }]
        );
    }

    #[test]
    fn an_open_fence_runs_to_the_end_while_a_reply_streams() {
        assert_eq!(
            parse("```\nx\ny"),
            [Block::Code {
                language: String::new(),
                code: "x\ny".to_owned(),
            }]
        );
    }

    #[test]
    fn bullets_and_numbers_are_items() {
        assert_eq!(
            parse("- one\n* two\n3. three"),
            [
                Block::Item {
                    marker: "•".to_owned(),
                    markup: "one".to_owned(),
                },
                Block::Item {
                    marker: "•".to_owned(),
                    markup: "two".to_owned(),
                },
                Block::Item {
                    marker: "3.".to_owned(),
                    markup: "three".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn quote_lines_form_one_block() {
        assert_eq!(parse("> a\n> b"), [Block::Quote("a\nb".to_owned())]);
    }

    #[test]
    fn text_is_escaped_for_markup() {
        assert_eq!(inline("a <b> & \"c\""), "a &lt;b&gt; &amp; &quot;c&quot;");
    }

    #[test]
    fn bold_italic_and_code_become_markup() {
        assert_eq!(
            inline("**x** *y* `z<`"),
            "<b>x</b> <i>y</i> <span font_family=\"monospace\">z&lt;</span>"
        );
    }

    #[test]
    fn lone_markers_stay_as_typed() {
        assert_eq!(inline("2 * 3 * 4"), "2 * 3 * 4");
        assert_eq!(inline("**unclosed"), "**unclosed");
        assert_eq!(inline("a `b"), "a `b");
    }

    #[test]
    fn only_web_links_become_links() {
        assert_eq!(
            inline("[a](https://x.y/?a=1&b=2)"),
            "<a href=\"https://x.y/?a=1&amp;b=2\">a</a>"
        );
        assert_eq!(inline("[a](javascript:alert)"), "[a](javascript:alert)");
    }

    #[test]
    fn a_reply_can_not_open_markup_with_its_text() {
        assert_eq!(inline("</span><b>"), "&lt;/span&gt;&lt;b&gt;");
    }
}
