//! Reads the small Markdown subset the office writers take, plus the slide splitter and the CSV reader.
//! Ports the parsing half of electron/documents.cjs. Every pattern is the JavaScript one, through `js`.

use std::sync::LazyLock;

use serde::Serialize;

use crate::js::{JS_DOT, Pattern, captures, compile, trim};

/// Body lines a slide holds before the rest of its text moves to a continuation slide.
pub const SLIDE_BODY_LINES: usize = 12;

/// The font every emoji run is set in, so Word draws it in colour.
pub const EMOJI_FONT: &str = "Segoe UI Emoji";

static HEADING: Pattern = LazyLock::new(|| compile(&format!(r"^(#{{1,6}})[{{S}}]+({JS_DOT}*)$")));
static ORDERED: Pattern = LazyLock::new(|| compile(&format!(r"^[0-9]+\.[{{S}}]+({JS_DOT}*)$")));
static BULLET: Pattern = LazyLock::new(|| compile(&format!(r"^[-*][{{S}}]+({JS_DOT}*)$")));
static BULLET_PREFIX: Pattern = LazyLock::new(|| compile(r"^[-*][{S}]+"));
static SLIDE_RULE: Pattern = LazyLock::new(|| compile(r"(?m)^[{S}]*(?:---|\*\*\*)[{S}]*$"));
static INLINE: Pattern =
    LazyLock::new(|| compile(r"\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*"));
pub(crate) static EMOJI: Pattern = LazyLock::new(|| {
    compile(
        r"(?:\p{Extended_Pictographic}(?:[\x{FE0E}\x{FE0F}\x{200D}]|[\x{1F3FB}-\x{1F3FF}]|\p{Extended_Pictographic})*|[\x{1F1E6}-\x{1F1FF}]{2})",
    )
});

/// One line of a Markdown body, classified the way the Word writer reads it. The text is trimmed.
#[derive(Debug, Clone, PartialEq)]
pub enum Block<'a> {
    Blank,
    Heading { level: usize, text: &'a str },
    Rule,
    Numbered(&'a str),
    Bullet(&'a str),
    Text(&'a str),
}

/// Classifies one raw line. Headings come first, then rules, numbered items, bullets and plain text.
pub fn classify(raw: &str) -> Block<'_> {
    let line = trim(raw);
    if line.is_empty() {
        return Block::Blank;
    }
    if let Some(caps) = captures(&HEADING, line) {
        let level = caps.get(1).map_or(1, |m| m.as_str().len());
        let text = caps.get(2).map_or("", |m| m.as_str());
        return Block::Heading { level, text };
    }
    if line == "---" || line == "***" {
        return Block::Rule;
    }
    if let Some(caps) = captures(&ORDERED, line) {
        return Block::Numbered(caps.get(1).map_or("", |m| m.as_str()));
    }
    if let Some(caps) = captures(&BULLET, line) {
        return Block::Bullet(caps.get(1).map_or("", |m| m.as_str()));
    }
    Block::Text(line)
}

/// A run of text and the emphasis and font it carries. The emoji font is only ever set on emoji.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InlineRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub font: Option<&'static str>,
}

#[derive(Clone, Copy, Default)]
struct Emphasis {
    bold: bool,
    italic: bool,
}

/// The runs of one line: `***both***`, `**bold**` and `*italic*`, first match wins, unmatched markers stay text.
pub fn inline_runs(text: &str) -> Vec<InlineRun> {
    let mut runs = Vec::new();
    let mut position = 0;
    if let Some(regex) = INLINE.as_ref() {
        for found in regex.captures_iter(text) {
            let Some(whole) = found.get(0) else { continue };
            if whole.start() > position {
                push_formatted(
                    &mut runs,
                    &text[position..whole.start()],
                    Emphasis::default(),
                );
            }
            if let Some(inner) = found.get(1) {
                push_formatted(
                    &mut runs,
                    inner.as_str(),
                    Emphasis {
                        bold: true,
                        italic: true,
                    },
                );
            } else if let Some(inner) = found.get(2) {
                push_formatted(
                    &mut runs,
                    inner.as_str(),
                    Emphasis {
                        bold: true,
                        italic: false,
                    },
                );
            } else if let Some(inner) = found.get(3) {
                push_formatted(
                    &mut runs,
                    inner.as_str(),
                    Emphasis {
                        bold: false,
                        italic: true,
                    },
                );
            }
            position = whole.end();
        }
    }
    if position < text.len() {
        push_formatted(&mut runs, &text[position..], Emphasis::default());
    }
    if runs.is_empty() {
        runs.push(run(text, Emphasis::default(), None));
    }
    runs
}

/// Splits text into emoji and non-emoji runs. Empty text adds nothing.
fn push_formatted(runs: &mut Vec<InlineRun>, text: &str, emphasis: Emphasis) {
    if text.is_empty() {
        return;
    }
    let mut last = 0;
    if let Some(emoji) = EMOJI.as_ref() {
        for found in emoji.find_iter(text) {
            if found.start() > last {
                runs.push(run(&text[last..found.start()], emphasis, None));
            }
            runs.push(run(found.as_str(), emphasis, Some(EMOJI_FONT)));
            last = found.end();
        }
    }
    if last < text.len() {
        runs.push(run(&text[last..], emphasis, None));
    }
}

fn run(text: &str, emphasis: Emphasis, font: Option<&'static str>) -> InlineRun {
    InlineRun {
        text: text.to_owned(),
        bold: emphasis.bold,
        italic: emphasis.italic,
        font,
    }
}

/// One slide: a title (empty when none) and its body lines.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Slide {
    pub title: String,
    pub body: Vec<String>,
}

/// Splits Markdown into slides. A heading starts one, a rule ends the block before it, and a long slide continues.
pub fn split_into_slides(content: &str) -> Vec<Slide> {
    let mut slides: Vec<Slide> = Vec::new();
    for block in split_at_rules(content) {
        let mut current: Option<usize> = None;
        for raw in block.split('\n') {
            let line = trim(raw);
            if line.is_empty() {
                continue;
            }
            if let Some(caps) = captures(&HEADING, line) {
                let title = caps.get(2).map_or("", |m| m.as_str());
                slides.push(Slide {
                    title: title.to_owned(),
                    body: Vec::new(),
                });
                current = Some(slides.len() - 1);
                continue;
            }
            let mut index = match current {
                Some(index) => index,
                None => {
                    slides.push(Slide {
                        title: String::new(),
                        body: Vec::new(),
                    });
                    slides.len() - 1
                }
            };
            if slides[index].body.len() >= SLIDE_BODY_LINES {
                let title = if slides[index].title.is_empty() {
                    String::new()
                } else {
                    format!("{} (cont.)", slides[index].title)
                };
                slides.push(Slide {
                    title,
                    body: Vec::new(),
                });
                index = slides.len() - 1;
            }
            let text = bullet_as_character(line);
            slides[index].body.push(text);
            current = Some(index);
        }
    }
    slides.retain(|slide| !slide.title.is_empty() || !slide.body.is_empty());
    slides
}

/// The blocks between rules. Without a usable pattern the whole text is one block.
fn split_at_rules(content: &str) -> Vec<&str> {
    match SLIDE_RULE.as_ref() {
        Some(regex) => regex.split(content).collect(),
        None => vec![content],
    }
}

/// A leading `-` or `*` becomes a bullet character, as slides cannot hold list formatting.
fn bullet_as_character(line: &str) -> String {
    match BULLET_PREFIX.as_ref().and_then(|re| re.find(line)) {
        Some(found) => format!("• {}", &line[found.end()..]),
        None => line.to_owned(),
    }
}

/// Parses CSV with quoted fields, doubled quotes and newlines inside quotes. Rows with only blank cells are dropped.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if quoted {
            if ch != '"' {
                field.push(ch);
            } else if chars.peek() == Some(&'"') {
                chars.next();
                field.push('"');
            } else {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' => {}
            other => field.push(other),
        }
    }
    row.push(field);
    rows.push(row);
    rows.retain(|cells| cells.iter().any(|cell| !trim(cell).is_empty()));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_need_a_space_and_at_most_six_marks() {
        assert_eq!(
            classify("# A"),
            Block::Heading {
                level: 1,
                text: "A"
            }
        );
        assert_eq!(
            classify("###### F"),
            Block::Heading {
                level: 6,
                text: "F"
            }
        );
        assert_eq!(classify("####### seven"), Block::Text("####### seven"));
        assert_eq!(classify("#"), Block::Text("#"));
    }

    #[test]
    fn lists_and_rules_classify_after_headings() {
        assert_eq!(classify("1. one"), Block::Numbered("one"));
        assert_eq!(classify("- item"), Block::Bullet("item"));
        assert_eq!(classify("* item"), Block::Bullet("item"));
        assert_eq!(classify("***"), Block::Rule);
        assert_eq!(classify("1.5 rate"), Block::Text("1.5 rate"));
        assert_eq!(classify("   "), Block::Blank);
    }

    #[test]
    fn emphasis_takes_the_first_match() {
        let runs = inline_runs("a **b** *c* ***d***");
        let texts: Vec<(&str, bool, bool)> = runs
            .iter()
            .map(|run| (run.text.as_str(), run.bold, run.italic))
            .collect();
        assert_eq!(
            texts,
            vec![
                ("a ", false, false),
                ("b", true, false),
                (" ", false, false),
                ("c", false, true),
                (" ", false, false),
                ("d", true, true),
            ]
        );
    }

    #[test]
    fn emoji_runs_take_the_emoji_font() {
        let runs = inline_runs("hi 🌊");
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[1].font, Some(EMOJI_FONT));
        assert_eq!(runs[0].font, None);
    }

    #[test]
    fn empty_text_is_one_empty_run() {
        assert_eq!(inline_runs("").len(), 1);
        assert_eq!(inline_runs("")[0].text, "");
    }

    #[test]
    fn a_heading_starts_a_slide_and_a_rule_ends_a_block() {
        let slides = split_into_slides("first\n\n---\n\n# Two\nbody");
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].title, "");
        assert_eq!(slides[1].title, "Two");
        assert_eq!(slides[1].body, vec!["body".to_owned()]);
    }

    #[test]
    fn csv_handles_quotes_and_blank_rows() {
        assert_eq!(
            parse_csv("\"He said \"\"hi\"\"\",1\n\n,\nx,y"),
            vec![
                vec!["He said \"hi\"".to_owned(), "1".to_owned()],
                vec!["x".to_owned(), "y".to_owned()],
            ]
        );
    }
}
