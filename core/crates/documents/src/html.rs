//! The HTML the converters read: a forgiving parser for model-written markup, plus the CSS, colour, size and
//! entity readers. Ports the pure part of electron/htmlDocument.cjs; the office writers are not here.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Serialize;

use crate::js::{Pattern, captures, ci, compile, is_match, parse_float, round, trim};

/// A parsed node. Serialises to the shape the reference's AST uses, with `type` naming the variant.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Node {
    Root { children: Vec<Node> },
    Element(Element),
    Text { text: String },
}

/// An element with its lowercased tag, attributes, merged CSS and children.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Element {
    pub tag: String,
    pub attrs: BTreeMap<String, String>,
    pub style: BTreeMap<String, String>,
    pub children: Vec<Node>,
}

/// A width from a `width` attribute or style: pixels, or a percentage of the table.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Width {
    Px { value: f64 },
    Percent { value: f64 },
}

/// Alternatives for the tags `isHtml` looks for, with `h[1-6]` spelled out.
fn html_tag_alternatives() -> String {
    let words = [
        "html", "body", "div", "p", "table", "section", "article", "ul", "ol", "style", "span",
        "b", "strong", "em", "i",
    ];
    let mut parts: Vec<String> = Vec::new();
    for word in words {
        if word == "p" {
            parts.push(ci("p"));
            parts.push("[hH][1-6]".to_owned());
        } else {
            parts.push(ci(word));
        }
    }
    parts.join("|")
}

static DOCTYPE_START: Pattern = LazyLock::new(|| {
    compile(&format!(
        "^[{{S}}]*<!{}[{{S}}]+{}",
        ci("doctype"),
        ci("html")
    ))
});
static HTML_TAG: Pattern = LazyLock::new(|| {
    compile(&format!(
        "<[{{S}}]*(?:{})(?-u:\\b)[^>]*>",
        html_tag_alternatives()
    ))
});
static STYLE_BLOCK: Pattern = LazyLock::new(|| {
    compile(&format!(
        "<{}(?-u:\\b)[^>]*>((?s:.)*?)</{}>",
        ci("style"),
        ci("style")
    ))
});
static RULE: Pattern = LazyLock::new(|| compile(r"([^{}]+)\{([^}]+)\}"));
static TAG: Pattern = LazyLock::new(|| {
    compile(
        r#"(?s:<!--.*?-->)|<(/)?([a-zA-Z0-9:-]+)((?:[{S}]+[^'">{S}/=]+(?:[{S}]*=[{S}]*(?:"[^"]*"|'[^']*'|[^{S}>"']+))?)*)[{S}]*(/)?>|([^<]+)"#,
    )
});
static ATTR: Pattern = LazyLock::new(|| {
    compile(r#"([a-zA-Z0-9:-]+)(?:[{S}]*=[{S}]*(?:"([^"]*)"|'([^']*)'|([^{S}>]+)))?"#)
});
static WS_RUN: Pattern = LazyLock::new(|| compile("[{S}]+"));
static COLOR_HEX: Pattern = LazyLock::new(|| compile(r"^#?([0-9a-f]{3}|[0-9a-f]{6})$"));
static COLOR_RGB: Pattern = LazyLock::new(|| {
    compile(r"^rgba?[{S}]*\([{S}]*([0-9]+)[{S}]*,[{S}]*([0-9]+)[{S}]*,[{S}]*([0-9]+)")
});
static PT: Pattern = LazyLock::new(|| {
    compile(&format!(
        r"^([0-9.]+)[{{S}}]*({}|{}|{}|{})?$",
        ci("pt"),
        ci("px"),
        ci("em"),
        ci("rem")
    ))
});
static WIDTH: Pattern = LazyLock::new(|| {
    compile(&format!(
        r"^([0-9.]+)[{{S}}]*({}|{}|%)?$",
        ci("px"),
        ci("pt")
    ))
});

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];
const HEADING_TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6"];
const AUTO_CLOSE_P: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "dl",
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
    "hr",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];

/// The CSS keyword colours `parseColor` knows, as six hex digits.
fn named_color(raw: &str) -> Option<&'static str> {
    Some(match raw {
        "black" => "000000",
        "white" => "FFFFFF",
        "red" => "FF0000",
        "green" => "008000",
        "blue" => "0000FF",
        "yellow" => "FFFF00",
        "purple" => "800080",
        "orange" => "FFA500",
        "gray" | "grey" => "808080",
        "silver" => "C0C0C0",
        "navy" => "000080",
        "teal" => "008080",
        "aqua" => "00FFFF",
        "fuchsia" => "FF00FF",
        "maroon" => "800000",
        "olive" => "808000",
        "lime" => "00FF00",
        _ => return None,
    })
}

/// A colour as six uppercase hex digits, from a keyword, `#rgb`, `#rrggbb` or `rgb()`. None when it is none of these.
// TS quirk: the reference looks keywords up on a plain object, so "constructor" yields a function. Not kept.
pub fn parse_color(value: Option<&str>) -> Option<String> {
    let value = value.filter(|v| !v.is_empty())?;
    let raw = trim(value).to_lowercase();
    if let Some(hex) = named_color(&raw) {
        return Some(hex.to_owned());
    }
    if let Some(caps) = captures(&COLOR_HEX, &raw) {
        let hex = &caps[1];
        if hex.len() == 3 {
            return Some(
                hex.chars()
                    .flat_map(|c| [c, c])
                    .collect::<String>()
                    .to_uppercase(),
            );
        }
        return Some(hex.to_uppercase());
    }
    if let Some(caps) = captures(&COLOR_RGB, &raw) {
        let channel = |index: usize| {
            let amount = caps[index].parse::<f64>().unwrap_or(f64::INFINITY);
            format!("{:02X}", amount.min(255.0) as u32)
        };
        return Some(format!("{}{}{}", channel(1), channel(2), channel(3)));
    }
    None
}

/// CSS declarations from an inline style or a rule body. Keys are lowercased; a declaration with no key or value is dropped.
pub fn parse_style(text: Option<&str>) -> BTreeMap<String, String> {
    let mut styles = BTreeMap::new();
    let Some(text) = text.filter(|t| !t.is_empty()) else {
        return styles;
    };
    for part in text.split(';') {
        let Some(idx) = part.find(':') else {
            continue;
        };
        if idx == 0 {
            continue;
        }
        let key = trim(&part[..idx]).to_lowercase();
        let value = trim(&part[idx + 1..]);
        if !key.is_empty() && !value.is_empty() {
            styles.insert(key, value.to_owned());
        }
    }
    styles
}

/// A size in points. Pixels are three quarters of a point and em or rem scale by `default_pt`; text that is not a
/// size gives `default_pt`.
pub fn parse_pt(value: Option<&str>, default_pt: f64) -> f64 {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return default_pt;
    };
    let Some(caps) = captures(&PT, trim(value)) else {
        return default_pt;
    };
    let num = parse_float(&caps[1]);
    let unit = caps
        .get(2)
        .map_or_else(|| "pt".to_owned(), |m| m.as_str().to_lowercase());
    match unit.as_str() {
        "px" => round(num * 0.75),
        "em" | "rem" => round(num * default_pt),
        _ => round(num),
    }
}

/// A width in pixels or percent. Any unit other than `%` is read as pixels, as the reference does.
pub fn parse_width(value: Option<&str>) -> Option<Width> {
    let value = value.filter(|v| !v.is_empty())?;
    let caps = captures(&WIDTH, trim(value))?;
    let num = parse_float(&caps[1]);
    let unit = caps.get(2).map_or("px", |m| m.as_str());
    Some(if unit == "%" {
        Width::Percent { value: num }
    } else {
        Width::Px { value: num }
    })
}

/// Decodes the entities the converters meet. `&amp;` goes last, so an escaped `&lt;` decodes once. Numeric
/// references wrap at 16 bits as `String.fromCharCode` does; a lone surrogate comes out as U+FFFD.
pub fn decode_entities(text: Option<&str>) -> String {
    let text = text.unwrap_or("");
    let mut units: Vec<u16> = text.encode_utf16().collect();
    for (from, to) in [
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&nbsp;", " "),
    ] {
        units = replace_literal(&units, from, to);
    }
    units = replace_numeric(&units, false);
    units = replace_numeric(&units, true);
    units = replace_literal(&units, "&amp;", "&");
    String::from_utf16_lossy(&units)
}

fn replace_literal(units: &[u16], from: &str, to: &str) -> Vec<u16> {
    let pattern: Vec<u16> = from.encode_utf16().collect();
    let replacement: Vec<u16> = to.encode_utf16().collect();
    let mut out = Vec::with_capacity(units.len());
    let mut i = 0;
    while i < units.len() {
        if units[i..].starts_with(&pattern) {
            out.extend_from_slice(&replacement);
            i += pattern.len();
        } else {
            out.push(units[i]);
            i += 1;
        }
    }
    out
}

fn replace_numeric(units: &[u16], hex: bool) -> Vec<u16> {
    let mut out = Vec::with_capacity(units.len());
    let mut i = 0;
    while i < units.len() {
        match numeric_reference(units, i, hex) {
            Some((code, next)) => {
                out.push(code);
                i = next;
            }
            None => {
                out.push(units[i]);
                i += 1;
            }
        }
    }
    out
}

/// The reference starting at `start` as `(code unit, index after it)`, for `&#123;` or `&#x7b;`.
fn numeric_reference(units: &[u16], start: usize, hex: bool) -> Option<(u16, usize)> {
    if units.get(start) != Some(&u16::from(b'&')) || units.get(start + 1) != Some(&u16::from(b'#'))
    {
        return None;
    }
    let mut i = start + 2;
    if hex {
        match units.get(i) {
            Some(&c) if c == u16::from(b'x') || c == u16::from(b'X') => i += 1,
            _ => return None,
        }
    }
    let digits_start = i;
    while units.get(i).is_some_and(|&c| is_digit(c, hex)) {
        i += 1;
    }
    if i == digits_start || units.get(i) != Some(&u16::from(b';')) {
        return None;
    }
    let digits: String = units[digits_start..i]
        .iter()
        .filter_map(|&c| u8::try_from(c).ok())
        .map(char::from)
        .collect();
    let code = if hex {
        hex_to_unit(&digits)
    } else {
        decimal_to_unit(&digits)
    };
    Some((code, i + 1))
}

fn is_digit(unit: u16, hex: bool) -> bool {
    let Ok(byte) = u8::try_from(unit) else {
        return false;
    };
    byte.is_ascii_digit() || (hex && byte.is_ascii_hexdigit())
}

/// `String.fromCharCode` of a number: truncated, then taken modulo 2^16. Infinity becomes 0.
fn to_unit(value: f64) -> u16 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(65536.0) as u16
}

fn decimal_to_unit(digits: &str) -> u16 {
    to_unit(digits.parse::<f64>().unwrap_or(f64::INFINITY))
}

fn hex_to_unit(digits: &str) -> u16 {
    let significant = digits.trim_start_matches('0');
    // Past 30 digits the value is at least 2^120, where a double's low 16 bits are always zero.
    if significant.is_empty() || significant.len() > 30 {
        return 0;
    }
    u128::from_str_radix(significant, 16).map_or(0, |value| to_unit(value as f64))
}

/// Every text node under `node`, in document order.
pub fn node_text(node: &Node) -> String {
    let mut out = String::new();
    let mut pending = vec![node];
    while let Some(current) = pending.pop() {
        match current {
            Node::Text { text } => out.push_str(text),
            Node::Root { children } => pending.extend(children.iter().rev()),
            Node::Element(element) => pending.extend(element.children.iter().rev()),
        }
    }
    out
}

/// Whether the content looks like HTML rather than Markdown or plain text: a doctype, or a tag the converters use.
pub fn is_html(content: Option<&str>) -> bool {
    let Some(content) = content else {
        return false;
    };
    let trimmed = trim(content);
    is_match(&DOCTYPE_START, trimmed) || is_match(&HTML_TAG, trimmed)
}

/// Each `<style>` block's rules, keyed by lowercased selector. A selector seen twice merges, later declarations winning.
fn extract_css_rules(html: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut rules: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let Some(style_blocks) = STYLE_BLOCK.as_ref() else {
        return rules;
    };
    let Some(rule_re) = RULE.as_ref() else {
        return rules;
    };
    for block in style_blocks.captures_iter(html) {
        for rule in rule_re.captures_iter(&block[1]) {
            let declarations = parse_style(Some(trim(&rule[2])));
            for selector in trim(&rule[1]).split(',') {
                let key = trim(selector).to_lowercase();
                if !key.is_empty() {
                    rules.entry(key).or_default().extend(declarations.clone());
                }
            }
        }
    }
    rules
}

/// One slot in the parse arena. Children always have larger indices than their parent.
enum Kind {
    Root,
    Element {
        tag: String,
        attrs: BTreeMap<String, String>,
        style: BTreeMap<String, String>,
    },
    Text(String),
}

struct Slot {
    kind: Kind,
    children: Vec<usize>,
}

fn tag_at(slots: &[Slot], index: usize) -> Option<&str> {
    match slots.get(index).map(|slot| &slot.kind) {
        Some(Kind::Element { tag, .. }) => Some(tag.as_str()),
        _ => None,
    }
}

/// The most open elements the parser keeps nested. The converters recurse once per level on a 2 MiB thread stack.
const MAX_DEPTH: usize = 32;

/// Parses HTML the way the reference does: unclosed items and paragraphs close at the next block, void and
/// self-closing tags take no children, and a closing tag closes the nearest open element of its name.
pub fn parse_html(html: &str) -> Node {
    let css = extract_css_rules(html);
    let mut slots = vec![Slot {
        kind: Kind::Root,
        children: Vec::new(),
    }];
    let mut stack: Vec<usize> = vec![0];
    let Some(tag_re) = TAG.as_ref() else {
        return Node::Root {
            children: Vec::new(),
        };
    };

    for caps in tag_re.captures_iter(html) {
        let full = caps.get(0).map_or("", |m| m.as_str());
        if full.starts_with("<!--") {
            continue;
        }
        if let Some(text) = caps.get(5) {
            let decoded = decode_entities(Some(text.as_str()));
            let parent = stack.last().copied().unwrap_or(0);
            let parent_tag = tag_at(&slots, parent);
            let raw_parent = matches!(parent_tag, Some("style" | "head" | "script"));
            if !decoded.is_empty() && !raw_parent {
                push_child(&mut slots, parent, Kind::Text(decoded));
            }
            continue;
        }

        let tag = caps
            .get(2)
            .map_or_else(String::new, |m| m.as_str().to_ascii_lowercase());
        if tag.is_empty() {
            continue;
        }

        if caps.get(1).is_some() {
            for i in (1..stack.len()).rev() {
                if tag_at(&slots, stack[i]) == Some(tag.as_str()) {
                    stack.truncate(i);
                    break;
                }
            }
            continue;
        }

        close_for_block(&slots, &mut stack, &tag);
        let parent = stack.last().copied().unwrap_or(0);

        let mut attrs = BTreeMap::new();
        if let (Some(raw), Some(attr_re)) = (
            caps.get(3).map(|m| m.as_str()).filter(|s| !s.is_empty()),
            ATTR.as_ref(),
        ) {
            for am in attr_re.captures_iter(raw) {
                let value = am
                    .get(2)
                    .or(am.get(3))
                    .or(am.get(4))
                    .map_or("", |m| m.as_str());
                // TS quirk: the reference's plain objects drop a "__proto__" name; maps here keep it. Not replicated.
                attrs.insert(am[1].to_ascii_lowercase(), value.to_owned());
            }
        }

        let mut style = BTreeMap::new();
        if let Some(rules) = css.get(&tag) {
            style.extend(rules.clone());
        }
        if let Some(class) = attrs.get("class").filter(|c| !c.is_empty())
            && let Some(split_re) = WS_RUN.as_ref()
        {
            for name in split_re.split(trim(class)) {
                let lower = name.to_lowercase();
                if let Some(rules) = css.get(&format!(".{lower}")) {
                    style.extend(rules.clone());
                }
                if let Some(rules) = css.get(&format!("{tag}.{lower}")) {
                    style.extend(rules.clone());
                }
            }
        }
        if let Some(inline) = attrs.get("style").filter(|s| !s.is_empty()) {
            style.extend(parse_style(Some(inline)));
        }

        let index = push_child(
            &mut slots,
            parent,
            Kind::Element {
                tag: tag.clone(),
                attrs,
                style,
            },
        );
        let self_closing = caps.get(4).is_some();
        // Deeper than any real page nests: later tags land beside this one, so the walkers that recurse stay shallow.
        if !self_closing && !VOID_TAGS.contains(&tag.as_str()) && stack.len() < MAX_DEPTH {
            stack.push(index);
        }
    }

    build(slots)
}

/// Closes the open elements a new tag ends, before the tag itself is opened.
fn close_for_block(slots: &[Slot], stack: &mut Vec<usize>, tag: &str) {
    let top = |stack: &[usize]| stack.last().and_then(|&index| tag_at(slots, index));
    if tag == "li" {
        if top(stack) == Some("li") {
            stack.pop();
        }
    } else if HEADING_TAGS.contains(&tag) || matches!(tag, "hr" | "section" | "article") {
        while stack.len() > 1 && matches!(top(stack), Some("p" | "li" | "ul" | "ol" | "dl")) {
            stack.pop();
        }
    } else if tag == "table" {
        while stack.len() > 1 && matches!(top(stack), Some("p" | "li")) {
            stack.pop();
        }
    } else if AUTO_CLOSE_P.contains(&tag) && top(stack) == Some("p") {
        stack.pop();
    }
}

fn push_child(slots: &mut Vec<Slot>, parent: usize, kind: Kind) -> usize {
    let index = slots.len();
    slots.push(Slot {
        kind,
        children: Vec::new(),
    });
    if let Some(slot) = slots.get_mut(parent) {
        slot.children.push(index);
    }
    index
}

/// Turns the arena into a tree. Walking from the last slot back means every child is built before its parent.
fn build(mut slots: Vec<Slot>) -> Node {
    let mut built: Vec<Option<Node>> = (0..slots.len()).map(|_| None).collect();
    for index in (0..slots.len()).rev() {
        let children: Vec<Node> = slots[index]
            .children
            .iter()
            .filter_map(|&child| built[child].take())
            .collect();
        let kind = std::mem::replace(&mut slots[index].kind, Kind::Root);
        built[index] = Some(match kind {
            Kind::Root => Node::Root { children },
            Kind::Element { tag, attrs, style } => Node::Element(Element {
                tag,
                attrs,
                style,
                children,
            }),
            Kind::Text(text) => Node::Text { text },
        });
    }
    built
        .first_mut()
        .and_then(Option::take)
        .unwrap_or(Node::Root {
            children: Vec::new(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn element(node: &Node) -> &Element {
        match node {
            Node::Element(element) => element,
            other => panic!("expected an element, found {other:?}"),
        }
    }

    fn children(node: &Node) -> &[Node] {
        match node {
            Node::Root { children } => children,
            Node::Element(element) => &element.children,
            Node::Text { .. } => &[],
        }
    }

    #[test]
    fn detects_html_and_not_markdown_or_plain_text() {
        assert!(is_html(Some("<h1>Title</h1>")));
        assert!(is_html(Some("<p>Paragraph</p>")));
        assert!(is_html(Some("<table><tr><td>Cell</td></tr></table>")));
        assert!(is_html(Some(
            "<!DOCTYPE html><html><body>Hello</body></html>"
        )));
        assert!(!is_html(Some("# Markdown heading")));
        assert!(!is_html(Some("name,score\nAda,99")));
        assert!(!is_html(Some("Just some plain text")));
        assert!(!is_html(None));
    }

    #[test]
    fn parses_colours_across_formats() {
        assert_eq!(parse_color(Some("red")).as_deref(), Some("FF0000"));
        assert_eq!(parse_color(Some("#00ff00")).as_deref(), Some("00FF00"));
        assert_eq!(parse_color(Some("#abc")).as_deref(), Some("AABBCC"));
        assert_eq!(
            parse_color(Some("rgb(0, 0, 255)")).as_deref(),
            Some("0000FF")
        );
        assert_eq!(parse_color(Some("invalid")), None);
    }

    #[test]
    fn parses_font_sizes_into_points() {
        assert_eq!(parse_pt(Some("14pt"), 11.0), 14.0);
        assert_eq!(parse_pt(Some("16px"), 11.0), 12.0);
        assert_eq!(parse_pt(Some(""), 11.0), 11.0);
    }

    #[test]
    fn decodes_an_entity_once_rather_than_unescaping_its_own_output() {
        assert_eq!(
            decode_entities(Some("&amp;lt;script&amp;gt;")),
            "&lt;script&gt;"
        );
        assert_eq!(decode_entities(Some("&amp;amp;")), "&amp;");
    }

    #[test]
    fn still_decodes_every_entity_it_always_has() {
        assert_eq!(
            decode_entities(Some("&lt;b&gt; &amp; &quot;q&#39;s&quot; &#65;&#x42;")),
            "<b> & \"q's\" AB"
        );
    }

    #[test]
    fn parses_a_tag_with_no_closing_bracket_without_blowing_up() {
        // The reference used to take exponential time here; the regex engine is linear, so this finishes.
        for unit in ["!=\"\" ", " =! !", "!=! "] {
            let attack = format!("<a {}", unit.repeat(400));
            let root = parse_html(&attack);
            let kids = children(&root);
            assert_eq!(kids.len(), 1, "{unit:?}");
            assert!(matches!(kids[0], Node::Text { .. }));
        }
    }

    #[test]
    fn a_closing_tag_closes_the_nearest_open_element_of_its_name() {
        let root = parse_html("<div><span>x</span></div>y");
        let kids = children(&root);
        assert_eq!(kids.len(), 2);
        assert_eq!(element(&kids[0]).tag, "div");
        assert!(matches!(&kids[1], Node::Text { text } if text == "y"));
    }

    #[test]
    fn a_style_block_applies_to_tags_classes_and_the_inline_style_last() {
        let root =
            parse_html(r#"<style>p{color:red}</style><p class="x" style="color: blue">t</p>"#);
        let para = element(&children(&root)[1]).clone();
        assert_eq!(para.style.get("color").map(String::as_str), Some("blue"));
    }

    #[test]
    fn a_later_style_block_merges_into_an_earlier_one() {
        let root = parse_html(
            "<style>p{color:red}</style><style>p{color:blue;font-size:9pt}</style><p>x</p>",
        );
        let para = element(&children(&root)[2]).clone();
        assert_eq!(para.style.get("color").map(String::as_str), Some("blue"));
        assert_eq!(para.style.get("font-size").map(String::as_str), Some("9pt"));
    }

    #[test]
    fn an_unclosed_paragraph_closes_at_the_next_block() {
        let root = parse_html("<p>a<h2>b</h2>");
        let kids = children(&root);
        assert_eq!(kids.len(), 2);
        assert_eq!(element(&kids[0]).tag, "p");
        assert_eq!(element(&kids[1]).tag, "h2");
    }

    #[test]
    fn a_void_tag_takes_no_children() {
        let root = parse_html("<br>text<img src=x>");
        let kids = children(&root);
        assert_eq!(kids.len(), 3);
        assert!(element(&kids[0]).children.is_empty());
        assert_eq!(
            element(&kids[2]).attrs.get("src").map(String::as_str),
            Some("x")
        );
    }

    #[test]
    fn text_inside_style_and_script_is_not_kept() {
        let root = parse_html("<script>alert(1)</script>x");
        assert_eq!(node_text(&root), "x");
        assert!(element(&children(&root)[0]).children.is_empty());
    }

    #[test]
    fn a_comment_splits_the_text_around_it() {
        let root = parse_html("a<!-- hidden -->b");
        let kids = children(&root);
        assert_eq!(kids.len(), 2);
        assert_eq!(node_text(&root), "ab");
    }

    #[test]
    fn a_bare_less_than_sign_splits_the_text() {
        let root = parse_html("a < b");
        assert_eq!(children(&root).len(), 2);
    }

    #[test]
    fn a_duplicate_attribute_keeps_the_last_value() {
        let root = parse_html(r#"<p a=1 a="2">x</p>"#);
        assert_eq!(
            element(&children(&root)[0])
                .attrs
                .get("a")
                .map(String::as_str),
            Some("2")
        );
    }

    #[test]
    fn a_style_with_no_colon_or_no_value_is_dropped() {
        assert_eq!(parse_style(Some("bad; font-size: 9pt")).len(), 1);
        assert!(parse_style(Some(":x")).is_empty());
        assert!(parse_style(Some("x:")).is_empty());
    }

    #[test]
    fn widths_are_pixels_or_percent() {
        assert_eq!(parse_width(Some("100px")), Some(Width::Px { value: 100.0 }));
        assert_eq!(
            parse_width(Some("50%")),
            Some(Width::Percent { value: 50.0 })
        );
        assert_eq!(parse_width(Some("abc")), None);
        assert_eq!(parse_width(None), None);
    }

    #[test]
    fn a_surrogate_pair_written_as_two_references_is_one_character() {
        assert_eq!(decode_entities(Some("&#55357;&#56832;")), "\u{1F600}");
    }

    #[test]
    fn a_lone_surrogate_reference_becomes_the_replacement_character() {
        // The reference keeps the lone surrogate; a Rust string cannot hold one.
        assert_eq!(decode_entities(Some("&#55357;")), "\u{FFFD}");
    }

    #[test]
    fn hex_references_read_long_runs_of_leading_zeros() {
        assert_eq!(
            decode_entities(Some("&#x0000000000000000000000000000000000000041;")),
            "A"
        );
    }
}
