//! How a shell command is read for permissions: command boundaries and what "always allow" remembers.
//! A command that cannot be read safely is never covered by a grant. Port of `src/agent/commandRules.ts`.

use std::sync::OnceLock;

use crate::js::{CaseFold, Flags, JsRegex, cached, is_js_space, trim_js};

/// The three grammars a command can be written in. Each reads quoting, grouping and redirects its own way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Bash,
    Pwsh,
    Cmd,
}

/// The grammar for a shell name; an unknown or missing name reads as the strictest one.
pub fn dialect_for(shell: Option<&str>) -> Dialect {
    match shell.unwrap_or("").to_lowercase().as_str() {
        "bash" | "sh" | "zsh" => Dialect::Bash,
        "cmd" => Dialect::Cmd,
        _ => Dialect::Pwsh,
    }
}

/// Words kept by "always allow", so "gh pr list" is remembered rather than "gh", which would allow merging.
const PREFIX_WORDS: usize = 3;

static BASH_REDIRECTS: OnceLock<Option<JsRegex>> = OnceLock::new();
static PWSH_REDIRECTS: OnceLock<Option<JsRegex>> = OnceLock::new();
static CMD_REDIRECTS: OnceLock<Option<JsRegex>> = OnceLock::new();
static UNQUOTED: OnceLock<Option<JsRegex>> = OnceLock::new();

// Writing output to nowhere, or folding errors into output, changes nothing on disk. In PowerShell "/dev/null" is a
// real path on the current drive, and in bash "$null" is an empty variable.
const BASH_REDIRECTS_SOURCE: &str = r"\s*(?:\d|&)?>\s*(?:&\d|\/dev\/null)(?=\s|$)";
const PWSH_REDIRECTS_SOURCE: &str = r"\s*(?:\d|\*)?>\s*(?:&\d|\$null|nul)(?=\s|$)";
const CMD_REDIRECTS_SOURCE: &str = r"\s*\d?>\s*(?:&\d|nul)(?=\s|$)";
const UNQUOTED_SOURCE: &str = r#""(?:\\.|[^"\\])*"|'[^']*'"#;

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
    "wsl",
    "npx",
    "uvx",
    "sudo",
    "env",
    "eval",
    "exec",
    "source",
    "xargs",
    "nohup",
    "timeout",
    "iex",
    "invoke-expression",
    "invoke-command",
    "icm",
    "invoke-item",
    "ii",
    "start-process",
    "saps",
    "start",
    "start-job",
    "sajb",
];

/// Global git options that take a value before the subcommand, as in "git -C dir push".
const GIT_VALUE_OPTIONS: &[&str] = &[
    "-c",
    "-C",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
];
const GIT_FLAG_OPTIONS: &[&str] = &[
    "--no-pager",
    "-P",
    "--paginate",
    "-p",
    "--bare",
    "--no-optional-locks",
];

/// Collapses whitespace runs to one space and trims both ends, as `trim().replace(/\s+/g, " ")` does.
fn normalise(text: &str) -> String {
    text.split(is_js_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The text with the inside of quotes blanked, for checks on syntax that quoting makes plain text.
fn unquoted(text: &str) -> Option<String> {
    let regex = cached(
        &UNQUOTED,
        UNQUOTED_SOURCE,
        Flags {
            case: CaseFold::Off,
            dot_all: false,
        },
    )?;
    Some(regex.replace_all(text, "\"\"").to_string())
}

/// Whether the line holds something no reader of the text can follow in this grammar.
fn opaque(text: &str, dialect: Dialect) -> bool {
    // Substitutions and process substitutions run a command the text never shows.
    if text.contains("$(") || text.contains('`') || text.contains("<(") || text.contains(">(") {
        return true;
    }
    let Some(bare) = unquoted(text) else {
        return true;
    };
    let grouping = bare.contains(['(', ')', '{', '}']);
    match dialect {
        // Subshells, groups and here documents hide or defer commands; "${" expands arbitrarily.
        Dialect::Bash => {
            grouping || bare.contains("<<") || bare.contains("${") || text.contains("${")
        }
        // Script blocks, sub-expressions, array and hash literals, block comments, the call operator, dot sourcing and
        // the stop-parsing token all run text the splitter cannot see.
        Dialect::Pwsh => {
            grouping || bare.contains("<#") || bare.contains("#>") || bare.contains("--%")
        }
        // cmd expands %VAR% and ^ escapes before it parses, so neither can be read from the text.
        Dialect::Cmd => text.contains(['%', '^']) || grouping,
    }
}

/// The separate commands in a command line, or `None` when it runs something no reader can see: a substitution, a
/// quote left open, a redirect that writes a file or a construct of the dialect.
pub fn command_segments(command: Option<&str>, dialect: Dialect) -> Option<Vec<String>> {
    let (cell, source, case) = match dialect {
        Dialect::Bash => (&BASH_REDIRECTS, BASH_REDIRECTS_SOURCE, CaseFold::Off),
        Dialect::Pwsh => (&PWSH_REDIRECTS, PWSH_REDIRECTS_SOURCE, CaseFold::AsciiOnly),
        Dialect::Cmd => (&CMD_REDIRECTS, CMD_REDIRECTS_SOURCE, CaseFold::AsciiOnly),
    };
    let redirects = cached(
        cell,
        source,
        Flags {
            case,
            dot_all: false,
        },
    )?;
    let stripped = redirects.replace_all(command.unwrap_or(""), " ");
    let text = trim_js(&stripped);
    if text.is_empty() || opaque(text, dialect) {
        return None;
    }

    let chars: Vec<char> = text.chars().collect();
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        index += 1;
        if let Some(open) = quote {
            current.push(c);
            // Bash lets a backslash protect a quote inside double quotes.
            if open == '"' && dialect == Dialect::Bash && c == '\\' && index < chars.len() {
                current.push(chars[index]);
                index += 1;
                continue;
            }
            if c == open {
                quote = None;
            }
            continue;
        }
        if dialect == Dialect::Bash && c == '\\' {
            // A protected character is text, not syntax; a trailing backslash joins lines, so it is unreadable.
            if index >= chars.len() {
                return None;
            }
            current.push('\\');
            current.push(chars[index]);
            index += 1;
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                current.push(c);
            }
            '<' | '>' => return None,
            '&' => {
                // "&&" chains in every shell. A lone "&" backgrounds in bash; in PowerShell it is the call operator
                // and in cmd it runs a command, so neither can be read.
                if chars.get(index) == Some(&'&') {
                    index += 1;
                } else if dialect != Dialect::Bash {
                    return None;
                }
                push_segment(&mut segments, &mut current);
            }
            ';' | '|' | '\n' | '\r' => push_segment(&mut segments, &mut current),
            _ => current.push(c),
        }
    }
    if quote.is_some() {
        return None;
    }
    push_segment(&mut segments, &mut current);
    if segments.is_empty() {
        return None;
    }

    for segment in &segments {
        let first = segment.split(' ').next().unwrap_or("");
        // A command named by a variable or a dot-sourced script is unknown until it runs.
        if first.starts_with('$') || first.starts_with("\\$") {
            return None;
        }
        if dialect != Dialect::Cmd && first == "." {
            return None;
        }
        if dialect == Dialect::Bash && first == "!" {
            return None;
        }
    }
    Some(segments)
}

fn push_segment(segments: &mut Vec<String>, current: &mut String) {
    let segment = normalise(current);
    if !segment.is_empty() {
        segments.push(segment);
    }
    current.clear();
}

/// The index where a git command's subcommand starts, after global options such as "-C dir".
fn git_subcommand_start(words: &[&str]) -> usize {
    let mut start = 1;
    while start < words.len() {
        let word = words[start];
        let name = word.split('=').next().unwrap_or("");
        if GIT_FLAG_OPTIONS.contains(&word) {
            start += 1;
        } else if GIT_VALUE_OPTIONS.contains(&word) {
            start += 2;
        } else if word.contains('=') && GIT_VALUE_OPTIONS.contains(&name) {
            start += 1;
        } else {
            break;
        }
    }
    start
}

/// A command with git's global options removed, so a grant for "git push" covers "git -C dir push".
fn canonical(segment: &str) -> String {
    let words: Vec<&str> = segment.split(' ').collect();
    if words[0].to_lowercase() != "git" {
        return segment.to_string();
    }
    let start = git_subcommand_start(&words);
    if start >= words.len() {
        return segment.to_string();
    }
    let mut kept = vec!["git"];
    kept.extend_from_slice(&words[start..]);
    kept.join(" ")
}

/// What "always allow" keeps of one command: its leading words up to the first flag, or the whole command when it
/// starts with an interpreter.
pub fn command_prefix(segment: &str) -> String {
    let normalised = normalise(segment);
    let words: Vec<&str> = normalised.split(' ').collect();
    if INTERPRETERS.contains(&words[0].to_lowercase().as_str()) {
        return normalised;
    }

    let mut start = 0;
    if words[0].to_lowercase() == "git" {
        // "git -C dir push --force" is a push; a grant must not become one for every git command.
        start = git_subcommand_start(&words);
        if start >= words.len() {
            return normalised;
        }
    }

    let mut kept: Vec<&str> = vec![words[0]];
    for word in &words[if start == 0 { 1 } else { start }..] {
        if word.starts_with('-') || word.starts_with('/') {
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
pub fn command_grant_targets(command: Option<&str>, dialect: Dialect) -> Vec<String> {
    let Some(segments) = command_segments(command, dialect) else {
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
pub fn command_covered(allowed: &[String], command: Option<&str>, dialect: Dialect) -> bool {
    let Some(segments) = command_segments(command, dialect) else {
        return false;
    };
    let prefixes: Vec<String> = allowed
        .iter()
        .map(|prefix| normalise(prefix))
        .filter(|p| !p.is_empty())
        .collect();
    segments.iter().all(|segment| {
        let segment = canonical(segment);
        prefixes.iter().any(|prefix| covers(&segment, prefix))
    })
}

/// Whether `segment` is `prefix`, or starts with `prefix` and a space, ignoring case.
fn covers(segment: &str, prefix: &str) -> bool {
    let segment = segment.to_lowercase();
    let prefix = prefix.to_lowercase();
    segment == prefix || segment.starts_with(&format!("{prefix} "))
}
