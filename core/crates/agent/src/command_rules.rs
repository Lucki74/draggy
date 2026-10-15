//! How a shell command is read for permissions: command boundaries and what "always allow" remembers.
//! A command that cannot be read safely is never covered by a grant. Port of `src/agent/commandRules.ts`.

use std::sync::OnceLock;

use crate::js::{CaseFold, Flags, JsRegex, cached, is_js_space, trim_js};

/// Words kept by "always allow", so "gh pr list" is remembered rather than "gh", which would allow merging.
const PREFIX_WORDS: usize = 3;

static HARMLESS_REDIRECTS: OnceLock<Option<JsRegex>> = OnceLock::new();
/// Writing output to nowhere, or folding errors into output, changes nothing on disk.
const HARMLESS_REDIRECTS_SOURCE: &str = r"\s*\d?>\s*(&\d|\/dev\/null|\$null|nul)(?=\s|$)";

/// Programs whose first word says nothing about what they will do: a grant for "python" would allow any script, so
/// a grant for one of these names the whole command instead.
const INTERPRETERS: &[&str] = &[
    "python",
    "python3",
    "py",
    "node",
    "bun",
    "deno",
    "ruby",
    "perl",
    "php",
    "pwsh",
    "powershell",
    "cmd",
    "bash",
    "sh",
    "zsh",
    "npx",
    "uvx",
    "sudo",
    "env",
    "iex",
    "invoke-expression",
];

/// Collapses whitespace runs to one space and trims both ends, as `trim().replace(/\s+/g, " ")` does.
fn normalise(text: &str) -> String {
    text.split(is_js_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The separate commands in a command line, or `None` when it runs something no reader can see: a substitution, a
/// quote left open, or a redirect that writes a file.
pub fn command_segments(command: Option<&str>) -> Option<Vec<String>> {
    let redirects = cached(
        &HARMLESS_REDIRECTS,
        HARMLESS_REDIRECTS_SOURCE,
        Flags {
            case: CaseFold::AsciiOnly,
            dot_all: false,
        },
    )?;
    let stripped = redirects.replace_all(command.unwrap_or(""), " ");
    let text = trim_js(&stripped);
    if text.is_empty() {
        return None;
    }
    if text.contains("$(") || text.contains('`') || text.contains("<(") || text.contains(">(") {
        return None;
    }

    let mut segments = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in text.chars() {
        if let Some(open) = quote {
            current.push(c);
            if c == open {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                current.push(c);
            }
            '<' | '>' => return None,
            ';' | '&' | '|' | '\n' | '\r' => push_segment(&mut segments, &mut current),
            _ => current.push(c),
        }
    }
    if quote.is_some() {
        return None;
    }
    push_segment(&mut segments, &mut current);

    (!segments.is_empty()).then_some(segments)
}

fn push_segment(segments: &mut Vec<String>, current: &mut String) {
    let segment = normalise(current);
    if !segment.is_empty() {
        segments.push(segment);
    }
    current.clear();
}

/// What "always allow" keeps of one command: its leading words up to the first flag, or the whole command when it
/// starts with an interpreter.
pub fn command_prefix(segment: &str) -> String {
    let normalised = normalise(segment);
    let first = normalised.split(' ').next().unwrap_or("").to_lowercase();
    if INTERPRETERS.contains(&first.as_str()) {
        return normalised;
    }

    let mut kept: Vec<&str> = Vec::new();
    for word in normalised.split(' ') {
        if word.starts_with('-') || (word.starts_with('/') && !kept.is_empty()) {
            break;
        }
        kept.push(word);
        if kept.len() == PREFIX_WORDS {
            break;
        }
    }
    kept.join(" ")
}

/// The prefixes "always allow" would store for a command line, one per command, each once. Empty when the line
/// cannot be read safely, so nothing about it is remembered.
pub fn command_grant_targets(command: Option<&str>) -> Vec<String> {
    let Some(segments) = command_segments(command) else {
        return Vec::new();
    };
    let mut targets: Vec<String> = Vec::new();
    for prefix in segments.iter().map(|segment| command_prefix(segment)) {
        if !targets.contains(&prefix) {
            targets.push(prefix);
        }
    }
    targets
}

/// Whether every command in a line is one the user has already allowed.
pub fn command_covered(allowed: &[String], command: Option<&str>) -> bool {
    let Some(segments) = command_segments(command) else {
        return false;
    };
    let prefixes: Vec<String> = allowed
        .iter()
        .map(|prefix| normalise(prefix))
        .filter(|p| !p.is_empty())
        .collect();
    segments
        .iter()
        .all(|segment| prefixes.iter().any(|prefix| covers(segment, prefix)))
}

/// Whether `segment` is `prefix`, or starts with `prefix` and a space, ignoring case.
fn covers(segment: &str, prefix: &str) -> bool {
    let segment = segment.to_lowercase();
    let prefix = prefix.to_lowercase();
    segment == prefix || segment.starts_with(&format!("{prefix} "))
}
