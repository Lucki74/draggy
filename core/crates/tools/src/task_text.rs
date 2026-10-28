//! The text rules for background tasks: what the model reads from a task's output, and how a command's final
//! folder and environment are carried to the next one. Pure functions, pinned by
//! `shared/fixtures/tools/task-*.json`, which the Electron reference (`win/electron/taskText.cjs`) also passes.
//! Offsets and lengths count characters, as the reference counts UTF-16 units; they only differ for text
//! outside the basic plane.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};

pub const MAX_OUTPUT_CHARS: usize = 30_000;
pub const HEAD_CHARS: usize = 8_000;

/// Variables the shell itself rewrites on every run; carrying them over would only be noise.
const VOLATILE_ENV: [&str; 11] = [
    "_",
    "PWD",
    "OLDPWD",
    "SHLVL",
    "PS1",
    "PS2",
    "PROMPT_COMMAND",
    "COLUMNS",
    "LINES",
    "RANDOM",
    "SECONDS",
];

// CSI sequences (colors, cursor moves), OSC sequences (titles, hyperlinks), and lone two-byte escapes.
static ANSI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
        .expect("valid ANSI pattern")
});

fn is_control(c: char) -> bool {
    matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}')
}

/// Output as a person would see it at the end: no color codes, progress bars reduced to their last frame,
/// and runs of identical lines folded into `line (x37)`.
pub fn clean_output(text: &str) -> String {
    let plain = ANSI.replace_all(text, "").replace("\r\n", "\n");
    let lines: Vec<String> = plain
        .split('\n')
        .map(|line| {
            let frames: Vec<&str> = line.split('\r').collect();
            // A trailing carriage return leaves an empty last frame; the one before it is the line.
            let mut last = frames.len() - 1;
            while last > 0 && frames[last].is_empty() {
                last -= 1;
            }
            frames[last].chars().filter(|c| !is_control(*c)).collect()
        })
        .collect();

    let mut folded: Vec<String> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let mut j = i + 1;
        while j < lines.len() && lines[j] == lines[i] {
            j += 1;
        }
        let count = j - i;
        if count > 2 && !lines[i].trim().is_empty() {
            folded.push(format!("{} (x{count})", lines[i]));
        } else {
            folded.push(lines[i..j].join("\n"));
        }
        i = j;
    }
    folded.join("\n")
}

/// A cut text and whether it was cut.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clipped {
    pub text: String,
    pub truncated: bool,
}

fn char_slice(text: &str, from: usize, to: usize) -> String {
    text.chars().skip(from).take(to.saturating_sub(from)).collect()
}

/// The start and the end of a long output, then where the rest lives.
pub fn clip_with_pointer(text: &str, task_id: Option<&str>) -> Clipped {
    let total = text.chars().count();
    if total <= MAX_OUTPUT_CHARS {
        return Clipped {
            text: text.to_string(),
            truncated: false,
        };
    }
    let tail = MAX_OUTPUT_CHARS - HEAD_CHARS;
    let cut = total - HEAD_CHARS - tail;
    let mut body = format!(
        "{}\n\n[... {cut} characters cut ...]\n\n{}",
        char_slice(text, 0, HEAD_CHARS),
        char_slice(text, total - tail, total)
    );
    if let Some(id) = task_id.filter(|id| !id.is_empty()) {
        body.push_str(&format!("\n\nFull log: task {id}, read it with task_output."));
    }
    Clipped {
        text: body,
        truncated: true,
    }
}

/// The part of `raw` a reader has not seen, and the offset to pass next time. `since` is the character
/// offset it last read to; anything missing or out of range reads from the start or the end.
pub fn slice_since(raw: &str, since: Option<f64>) -> (String, usize) {
    let total = raw.chars().count();
    let from = match since {
        Some(value) if value.is_finite() => (value.floor().max(0.0) as usize).min(total),
        _ => 0,
    };
    (char_slice(raw, from, total), total)
}

/// The last `count` lines of a text.
pub fn tail_lines(text: &str, count: f64) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let n = count.floor().max(1.0) as usize;
    if lines.len() <= n {
        text.to_string()
    } else {
        lines[lines.len() - n..].join("\n")
    }
}

/// The lines of a text matching a pattern, case-insensitively, each with its line number.
pub struct Grep {
    pub text: String,
    pub matches: usize,
}

pub fn grep_lines(text: &str, pattern: &str, limit: usize) -> Result<Grep, String> {
    let regex = RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .map_err(|_| "That pattern is not a valid regular expression.".to_string())?;
    let mut hits: Vec<String> = Vec::new();
    for (i, line) in text.split('\n').enumerate() {
        if hits.len() >= limit {
            break;
        }
        if regex.is_match(line) {
            hits.push(format!("{}: {line}", i + 1));
        }
    }
    Ok(Grep {
        matches: hits.len(),
        text: hits.join("\n"),
    })
}

/// Shells whose final state can be captured; cmd cannot report its exit code and state together.
pub fn supports_state(shell: &str) -> bool {
    matches!(shell, "bash" | "sh" | "zsh" | "pwsh" | "powershell")
}

/// Text appended to the model's command so the shell reports where it ended up. The marker is random per
/// run, so output that merely looks like it cannot pass for the report. The command's exit code is kept.
pub fn state_epilogue(shell: &str, marker: &str) -> Option<String> {
    if matches!(shell, "pwsh" | "powershell") {
        return Some(
            [
                String::new(),
                "$__dgOk = $?; $__dgRc = $LASTEXITCODE".to_string(),
                format!("Write-Output \"{marker}:cwd:$((Get-Location).Path)\""),
                format!(
                    "Get-ChildItem Env: | ForEach-Object {{ Write-Output \"{marker}:env:$($_.Name)=$($_.Value)\" }}"
                ),
                format!("Write-Output \"{marker}:end\""),
                "if ($__dgRc) { exit $__dgRc } elseif (-not $__dgOk) { exit 1 }".to_string(),
            ]
            .join("\n"),
        );
    }
    if supports_state(shell) {
        return Some(
            [
                String::new(),
                "__dg_rc=$?".to_string(),
                format!("printf '\\n%s\\n' \"{marker}:cwd:$(pwd -W 2>/dev/null || pwd)\""),
                format!("env | sed \"s/^/{marker}:env:/\""),
                format!("printf '%s\\n' \"{marker}:end\""),
                "exit $__dg_rc".to_string(),
            ]
            .join("\n"),
        );
    }
    None
}

/// The folder and environment a shell reported at the end of a command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellState {
    pub cwd: String,
    pub env: BTreeMap<String, String>,
}

/// Splits a finished command's output into what the model reads and the state the shell reported. The state
/// is `None` when the command never reached the epilogue (it exited early or was killed).
pub fn parse_state(output: &str, marker: &str) -> (String, Option<ShellState>) {
    let end_tag = format!("{marker}:end");
    let cwd_tag = format!("{marker}:cwd:");
    let env_tag = format!("{marker}:env:");
    let (Some(end_at), Some(first_report)) = (output.rfind(&end_tag), output.find(&cwd_tag)) else {
        return (output.to_string(), None);
    };
    if first_report > end_at {
        return (output.to_string(), None);
    }

    // The report starts on its own line; a newline the epilogue added before it is not the command's.
    let mut cut = first_report;
    if output[..cut].ends_with('\n') {
        cut -= 1;
    }
    if output[..cut].ends_with('\r') {
        cut -= 1;
    }
    let before = output[..cut].to_string();

    let mut cwd: Option<String> = None;
    let mut env = BTreeMap::new();
    for line in output[first_report..end_at].split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(rest) = line.strip_prefix(&cwd_tag) {
            cwd = Some(rest.to_string());
        } else if let Some(entry) = line.strip_prefix(&env_tag)
            && let Some(eq) = entry.find('=')
            && eq > 0
        {
            env.insert(entry[..eq].to_string(), entry[eq + 1..].to_string());
        }
    }
    let state = cwd.filter(|c| !c.is_empty()).map(|cwd| ShellState { cwd, env });
    (before, state)
}

/// Hides the state report from output that is still arriving in pieces. `push` returns the text that is safe
/// to show; a marker split across two pieces is held back until it can be told from ordinary text.
pub struct StateFilter {
    tag: String,
    held: String,
    hidden: bool,
}

impl StateFilter {
    pub fn new(marker: &str) -> Self {
        Self {
            tag: format!("{marker}:cwd:"),
            held: String::new(),
            hidden: false,
        }
    }

    pub fn push(&mut self, chunk: &str) -> String {
        if self.hidden {
            return String::new();
        }
        self.held.push_str(chunk);
        if let Some(at) = self.held.find(&self.tag) {
            self.hidden = true;
            let mut shown = self.held[..at].to_string();
            if shown.ends_with('\n') {
                shown.pop();
                if shown.ends_with('\r') {
                    shown.pop();
                }
            }
            self.held.clear();
            return shown;
        }
        let keep = self.tag.chars().count() - 1;
        let total = self.held.chars().count();
        let split = if total > keep {
            self.held
                .char_indices()
                .nth(total - keep)
                .map_or(self.held.len(), |(i, _)| i)
        } else {
            0
        };
        let shown = self.held[..split].to_string();
        self.held.drain(..split);
        shown
    }

    pub fn end(&mut self) -> String {
        let rest = if self.hidden {
            String::new()
        } else {
            std::mem::take(&mut self.held)
        };
        self.held.clear();
        rest
    }
}

/// What changed in the environment, as variables to set and variables to remove.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnvDiff {
    pub set: BTreeMap<String, String>,
    pub unset: Vec<String>,
}

fn skipped(key: &str) -> bool {
    VOLATILE_ENV.contains(&key) || key.starts_with("__dg")
}

pub fn env_diff(before: &BTreeMap<String, String>, after: &BTreeMap<String, String>) -> EnvDiff {
    let set = after
        .iter()
        .filter(|(key, value)| !skipped(key) && before.get(*key) != Some(*value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let unset: BTreeSet<String> = before
        .keys()
        .filter(|key| !skipped(key) && !after.contains_key(*key))
        .cloned()
        .collect();
    EnvDiff {
        set,
        unset: unset.into_iter().collect(),
    }
}

/// The environment a diff produces on top of a base.
pub fn apply_env_diff(base: &BTreeMap<String, String>, diff: &EnvDiff) -> BTreeMap<String, String> {
    let mut env = base.clone();
    env.extend(diff.set.clone());
    for key in &diff.unset {
        env.remove(key);
    }
    env
}
