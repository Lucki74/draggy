//! Tool-call parsing from raw model output: a port of `src/toolParsing.ts`. The TypeScript reads tool names from its
//! registry; here the caller passes them in, and the fixtures pass them explicitly.

use serde_json::{Map, Value};

use crate::AgentError;
use crate::js::{
    CaseFold, Flags, JsRegex, escape_js_literal, match_js_ci, trim_js, trim_start_js, utf16_suffix,
};
use crate::json;

/// How many trailing UTF-16 units of a streamed chunk the caller re-scans, so a marker split at the boundary is seen.
pub const TOOL_MARKER_OVERLAP: usize = 16;

const TOOL_MARKERS: [&str; 9] = [
    "<tool",
    "<function",
    "<invoke",
    "<search_",
    "<read_",
    "<run_",
    "<browser_",
    "<create_",
    "\"name\"",
];

/// The tool name placeholder in the patterns below, replaced by the escaped registered names.
const NAMES: &str = "NAMES_HERE";

const TOOL_TAG: &str =
    r"<(?:tool|tool_call|function|invoke)>([\s\S]*?)<\/(?:tool|tool_call|function|invoke)>";
const MALFORMED_OPENER: &str = r"<(NAMES_HERE)\s*(\{[\s\S]*?\})";
const BARE_NAMED_JSON: &str = r#"\{\s*"name"\s*:\s*"(?:NAMES_HERE)"\s*,\s*"(?:args|arguments|parameters)"\s*:\s*\{[\s\S]*?\}\s*\}"#;
const REACT_ATTRIBUTE: &str = r"<tool\s+([a-zA-Z0-9_]+)\s*=\s*(\{[\s\S]*?\})\s*\/?>?";

/// The patterns `strip` removes, in the order the TypeScript applies them. Each one replaces every match.
const STRIP_PATTERNS: [&str; 9] = [
    r"<think>[\s\S]*?<\/think>",
    r"<think>[\s\S]*$",
    r"<\/think>",
    r"<(?:tool|tool_call|function|invoke|NAMES_HERE)>[\s\S]*?(<\/(?:tool|tool_call|function|invoke|NAMES_HERE)>|$)",
    r"<(?:NAMES_HERE)\s*\{[\s\S]*?\}\}?>?",
    r#"\{\s*"name"\s*:\s*"(?:NAMES_HERE)"[\s\S]*?\}\s*\}"#,
    r"<tool\s+[a-zA-Z0-9_]+\s*=\s*\{[\s\S]*?\}\s*\/?>?",
    r#"\{\s*"type"\s*:\s*"function"[\s\S]*?(?:\}\s*)+"#,
    r#"\{\s*"tool_calls"\s*:[\s\S]*?(?:\}\s*)+"#,
];

/// Lines holding only braces or brackets. Case-sensitive, unlike the patterns above.
const ORPHAN_BRACE_LINE: &str = r"(?:^|\n)[ \t]*[{}[\]]+[ \t]*(?=\n|$)";

/// Whether `text` holds a marker that a tool call is starting (`TOOL_MARKER_RE`). ASCII only, as in JavaScript.
pub fn has_tool_marker(text: &str) -> bool {
    TOOL_MARKERS.iter().any(|marker| {
        text.as_bytes()
            .windows(marker.len())
            .any(|w| w.eq_ignore_ascii_case(marker.as_bytes()))
    })
}

/// `TOOL_MARKER_RE` applied to the last `TOOL_MARKER_OVERLAP` UTF-16 units of a streamed chunk.
pub fn has_tool_marker_in_overlap(chunk: &str) -> bool {
    has_tool_marker(utf16_suffix(chunk, TOOL_MARKER_OVERLAP))
}

/// Whether a marker shows up once `added` joins the text streamed so far, as the agent loop checks it: the overlap of
/// `previous` followed by `added`.
pub fn has_tool_marker_across(previous: &str, added: &str) -> bool {
    has_tool_marker(&format!(
        "{}{added}",
        utf16_suffix(previous, TOOL_MARKER_OVERLAP)
    ))
}

/// A tool call as the TypeScript `parseToolCall` returns it. `name` is the JSON value as written, whatever its type;
/// a missing or `null` name reads as `None`, as it does in TypeScript.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedToolCall {
    pub name: Option<Value>,
    pub args: Option<Value>,
}

/// The file arguments of a streamed `create_file`-style call, read before the JSON is complete.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FileStreamingArgs {
    pub filename: Option<String>,
    pub content: Option<String>,
}

/// Finds tool calls in raw model output and removes their syntax from the visible reply.
#[derive(Debug)]
pub struct ToolParser {
    names: Vec<String>,
    tag: JsRegex,
    malformed: JsRegex,
    bare_named: JsRegex,
    react: JsRegex,
    strip_patterns: Vec<JsRegex>,
    orphan_lines: JsRegex,
}

impl ToolParser {
    /// Builds a parser for the given tool names. Empty names are ignored.
    pub fn new(names: &[&str]) -> Result<Self, AgentError> {
        let names: Vec<String> = names
            .iter()
            .filter(|name| !name.is_empty())
            .map(|name| (*name).to_string())
            .collect();
        let alternation = if names.is_empty() {
            "__no_tools__".to_string()
        } else {
            names
                .iter()
                .map(|name| escape_js_literal(name))
                .collect::<Vec<_>>()
                .join("|")
        };
        let with_names = |source: &str| source.replace(NAMES, &alternation);
        let ci = Flags {
            case: CaseFold::AsciiOnly,
            dot_all: false,
        };

        let strip_patterns = STRIP_PATTERNS
            .into_iter()
            .map(|source| JsRegex::new(&with_names(source), ci))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            names,
            tag: JsRegex::new(TOOL_TAG, ci)?,
            malformed: JsRegex::new(&with_names(MALFORMED_OPENER), ci)?,
            bare_named: JsRegex::new(&with_names(BARE_NAMED_JSON), ci)?,
            react: JsRegex::new(REACT_ATTRIBUTE, ci)?,
            strip_patterns,
            orphan_lines: JsRegex::new(
                ORPHAN_BRACE_LINE,
                Flags {
                    case: CaseFold::Off,
                    dot_all: false,
                },
            )?,
        })
    }

    /// The JSON text of the first tool call in `raw`, or `None`. The forms are tried in the TypeScript order.
    /// A tagged call returns its inner text as written; the other forms return a re-serialised `{name, args}`.
    pub fn detect(&self, raw: &str) -> Option<String> {
        if let Some(caps) = self.tag.captures(raw) {
            return Some(group(&caps, 1).to_string());
        }

        if let Some((name, inner)) = self.shorthand(raw) {
            let inner = trim_js(inner);
            let args = parse_object(inner).unwrap_or_else(|| primary_argument(name, inner));
            return Some(call_json(name, args));
        }

        if let Some(caps) = self.malformed.captures(raw) {
            let collapsed = collapse_trailing_braces(group(&caps, 2));
            if let Some(args) = parse_object(trim_js(strip_one_gt(&collapsed))) {
                return Some(call_json(group(&caps, 1), args));
            }
        }

        if let Some((start, end)) = self.bare_named.find(raw) {
            return Some(raw[start..end].to_string());
        }

        if let Some(caps) = self.react.captures(raw) {
            let collapsed = collapse_react_braces(group(&caps, 2));
            if let Some(args) = parse_object(trim_js(strip_one_gt(&collapsed))) {
                return Some(call_json(group(&caps, 1), args));
            }
        }

        None
    }

    /// The visible reply with tool syntax, think blocks and leaked envelopes removed. Code is left alone.
    pub fn strip(&self, raw: &str) -> String {
        let (masked, stored) = protect_code(raw);
        let mut text = masked;
        for pattern in &self.strip_patterns {
            text = pattern.replace_all(&text, "");
        }
        text = self.orphan_lines.replace_all(&text, "");
        trim_js(&restore_code(&text, &stored)).to_string()
    }

    /// `<name>body</name>` for a registered name, with the closing tag matching the name ignoring case. Returns the
    /// name as written and the body. A name that opens without a closing tag is tried against the next one.
    fn shorthand<'t>(&self, text: &'t str) -> Option<(&'t str, &'t str)> {
        for (open, _) in text.match_indices('<') {
            for name in &self.names {
                let Some(name_end) = match_js_ci(text, open + 1, name) else {
                    continue;
                };
                if !text[name_end..].starts_with('>') {
                    continue;
                }
                let written = &text[open + 1..name_end];
                let body_start = name_end + 1;
                if let Some(close) = find_closer(text, body_start, written) {
                    return Some((written, &text[body_start..close]));
                }
            }
        }
        None
    }
}

/// The first `</name>` at or after `from`, where `name` matches the written name ignoring case (`</\1>`).
fn find_closer(text: &str, from: usize, written: &str) -> Option<usize> {
    text[from..]
        .match_indices("</")
        .map(|(offset, _)| from + offset)
        .find(|&close| {
            match_js_ci(text, close + 2, written).is_some_and(|end| text[end..].starts_with('>'))
        })
}

fn group<'t>(caps: &[Option<&'t str>], index: usize) -> &'t str {
    caps.get(index).copied().flatten().unwrap_or("")
}

/// `JSON.stringify({ name, args })`: keys in this order, compact.
fn call_json(name: &str, args: Value) -> String {
    let mut call = Map::new();
    call.insert("name".to_string(), Value::String(name.to_string()));
    call.insert("args".to_string(), args);
    json::stringify(&Value::Object(call))
}

/// The argument a bare shorthand body becomes when it is not JSON. Names not listed default to `query`.
fn primary_argument(name: &str, value: &str) -> Value {
    let key = match name {
        "read_url" | "browser_navigate" => "url",
        "browser_press_key" => "key",
        _ => "query",
    };
    let mut args = Map::new();
    args.insert(key.to_string(), Value::String(value.to_string()));
    Value::Object(args)
}

/// `safeJsonParse` for the object forms: the text must be a JSON object.
fn parse_object(text: &str) -> Option<Value> {
    json::parse(text).filter(Value::is_object)
}

fn trailing_braces(text: &str) -> usize {
    text.bytes().rev().take_while(|&b| b == b'}').count()
}

/// `replace(/\}\}+$/, "}")`: two or more closing braces at the end become one.
fn collapse_trailing_braces(text: &str) -> String {
    let run = trailing_braces(text);
    if run >= 2 {
        format!("{}}}", &text[..text.len() - run])
    } else {
        text.to_string()
    }
}

/// `replace(/\}\}+>?$/, "}")`: the same, with an optional `>` after the braces.
fn collapse_react_braces(text: &str) -> String {
    let body = text.strip_suffix('>').unwrap_or(text);
    let run = trailing_braces(body);
    if run >= 2 {
        format!("{}}}", &body[..body.len() - run])
    } else {
        text.to_string()
    }
}

/// `replace(/>$/, "")`.
fn strip_one_gt(text: &str) -> &str {
    text.strip_suffix('>').unwrap_or(text)
}

/// Replaces fenced blocks, then inline code spans, with placeholders, so the patterns cannot see inside them.
fn protect_code(text: &str) -> (String, Vec<String>) {
    let mut stored = Vec::new();
    let fenced = mask_fenced(text, &mut stored);
    let masked = mask_inline(&fenced, &mut stored);
    (masked, stored)
}

fn placeholder(index: usize) -> String {
    format!("__DRAGGY_CODE_{index}__")
}

/// `` /```[\s\S]*?(?:```|$)/g ``: from an opening fence to the next fence, or to the end of the text.
fn mask_fenced(text: &str, stored: &mut Vec<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(relative) = text[pos..].find("```") {
        let start = pos + relative;
        let end = match text[start + 3..].find("```") {
            Some(close) => start + 3 + close + 3,
            None => text.len(),
        };
        out.push_str(&text[pos..start]);
        stored.push(text[start..end].to_string());
        out.push_str(&placeholder(stored.len() - 1));
        pos = end;
    }
    out.push_str(&text[pos..]);
    out
}

/// `` /`[^`\n]*`/g ``: a backtick, then up to the next backtick on the same line.
fn mask_inline(text: &str, stored: &mut Vec<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(relative) = text[pos..].find('`') {
        let start = pos + relative;
        let rest = &text[start + 1..];
        match rest.find(['`', '\n']) {
            Some(offset) if rest[offset..].starts_with('`') => {
                let end = start + 1 + offset + 1;
                out.push_str(&text[pos..start]);
                stored.push(text[start..end].to_string());
                out.push_str(&placeholder(stored.len() - 1));
                pos = end;
            }
            _ => {
                out.push_str(&text[pos..=start]);
                pos = start + 1;
            }
        }
    }
    out.push_str(&text[pos..]);
    out
}

/// `replace(/__DRAGGY_CODE_(\d+)__/g, …)`: a placeholder becomes its stored code, or stays if there is none.
fn restore_code(text: &str, stored: &[String]) -> String {
    const PREFIX: &str = "__DRAGGY_CODE_";
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(relative) = text[pos..].find(PREFIX) {
        let start = pos + relative;
        let digits_start = start + PREFIX.len();
        let digits = text[digits_start..]
            .bytes()
            .take_while(u8::is_ascii_digit)
            .count();
        let digits_end = digits_start + digits;
        if digits > 0 && text[digits_end..].starts_with("__") {
            let end = digits_end + 2;
            out.push_str(&text[pos..start]);
            let code = text[digits_start..digits_end]
                .parse::<usize>()
                .ok()
                .and_then(|index| stored.get(index));
            // TS quirk: the model may write a placeholder itself, and it is restored the same way.
            match code {
                Some(code) => out.push_str(code),
                None => out.push_str(&text[start..end]),
            }
            pos = end;
        } else {
            out.push_str(&text[pos..=start]);
            pos = start + 1;
        }
    }
    out.push_str(&text[pos..]);
    out
}

/// `extractThought`: the text of the first `<think>` block, closed or still open while streaming.
pub fn extract_thought(raw: &str) -> Option<&str> {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";
    let open = find_ascii_ci(raw, OPEN)?;
    let body_start = open + OPEN.len();
    match find_ascii_ci(&raw[body_start..], CLOSE) {
        Some(close) => Some(&raw[body_start..body_start + close]),
        None => Some(&raw[body_start..]),
    }
}

fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// `parseToolCall`: strips a code fence, reads the first `{` to the last `}`, and picks out the name and arguments.
pub fn parse_tool_call(raw: &str) -> ParsedToolCall {
    let mut clean = trim_js(raw);
    if let Some(rest) = clean.strip_prefix("```json") {
        clean = rest.strip_prefix('\n').unwrap_or(rest);
    } else if let Some(rest) = clean.strip_prefix("```") {
        clean = rest.strip_prefix('\n').unwrap_or(rest);
    }
    if let Some(rest) = clean.strip_suffix("```") {
        clean = rest.strip_suffix('\n').unwrap_or(rest);
    }

    let (Some(first), Some(last)) = (clean.find('{'), clean.rfind('}')) else {
        return ParsedToolCall::default();
    };
    if last < first {
        return ParsedToolCall::default();
    }
    let Some(parsed) = parse_object(&clean[first..=last]) else {
        return ParsedToolCall::default();
    };

    let name = parsed.get("name").filter(|value| !value.is_null()).cloned();
    let args = ["args", "arguments", "parameters"]
        .iter()
        .find_map(|key| parsed.get(*key).filter(|value| !value.is_null()).cloned());
    ParsedToolCall { name, args }
}

/// `extractFileStreamingArgs`: the filename and the unescaped content of a call whose JSON is still arriving.
pub fn extract_file_streaming_args(args_or_json: &str) -> FileStreamingArgs {
    let filename = string_value(args_or_json, &["filename", "path"]).map(|raw| {
        json::parse(&format!("\"{raw}\""))
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| raw.to_string())
    });
    let content = string_value(args_or_json, &["content"]).map(unescape_content);
    FileStreamingArgs { filename, content }
}

/// The body after `"key" :` for the first key that matches, read up to its closing quote.
fn string_value<'t>(text: &'t str, keys: &[&str]) -> Option<&'t str> {
    for (quote, _) in text.match_indices('"') {
        let after_quote = &text[quote + 1..];
        for key in keys {
            let Some(rest) = after_quote
                .strip_prefix(*key)
                .and_then(|rest| rest.strip_prefix('"'))
            else {
                continue;
            };
            let Some(rest) = trim_start_js(rest).strip_prefix(':') else {
                continue;
            };
            if let Some(value) = trim_start_js(rest).strip_prefix('"') {
                return Some(raw_string_body(value));
            }
        }
    }
    None
}

/// The characters of a JSON string body: up to an unescaped quote, a backslash before a line break, or the end.
fn raw_string_body(value: &str) -> &str {
    let mut chars = value.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        match c {
            '"' => return &value[..index],
            '\\' => match chars.peek() {
                Some((_, next)) if !matches!(*next, '\n' | '\r' | '\u{2028}' | '\u{2029}') => {
                    chars.next();
                }
                _ => return &value[..index],
            },
            _ => {}
        }
    }
    value
}

/// Decodes `\n \r \t \" \\ \/ \uXXXX` as the TypeScript does. `\b` and `\f` come out as the letters: TS quirk, kept.
/// Escapes build UTF-16 units, so a surrogate pair becomes one character. A lone surrogate becomes U+FFFD, because a
/// Rust string cannot hold one; TypeScript keeps the unit, and a file written from either reads the same bytes.
fn unescape_content(body: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let mut units: Vec<u16> = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        if c != '\\' {
            push_char(&mut units, c);
            continue;
        }
        match chars.get(i).copied() {
            Some(escape @ ('n' | 'r' | 't' | 'b' | 'f' | '"' | '\\' | '/')) => {
                i += 1;
                // TS quirk: `\b` and `\f` decode to the letters, not to control characters.
                let decoded = match escape {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    other => other,
                };
                push_char(&mut units, decoded);
            }
            Some('u') => match hex_unit(chars.get(i + 1..i + 5).unwrap_or_default()) {
                Some(unit) => {
                    i += 5;
                    units.push(unit);
                }
                None => units.push(u16::from(b'\\')),
            },
            _ => units.push(u16::from(b'\\')),
        }
    }
    String::from_utf16_lossy(&units)
}

fn push_char(units: &mut Vec<u16>, c: char) {
    let mut buffer = [0u16; 2];
    units.extend_from_slice(c.encode_utf16(&mut buffer));
}

fn hex_unit(digits: &[char]) -> Option<u16> {
    if digits.len() != 4 || !digits.iter().all(char::is_ascii_hexdigit) {
        return None;
    }
    let text: String = digits.iter().collect();
    u16::from_str_radix(&text, 16).ok()
}
