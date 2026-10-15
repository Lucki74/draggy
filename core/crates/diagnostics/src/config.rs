//! Levels, scopes and the settings the writer starts with. The environment rules follow logger.cjs.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::format::{js_string, js_truthy};
use crate::text::js_trim;

/// Four levels, in the order logger.cjs numbers them: a line is written when its level is at or above a threshold.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    /// The word written into every line.
    pub fn name(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }

    /// Case-insensitive. Any other word is `None`, and the caller picks the fallback.
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_uppercase().as_str() {
            "DEBUG" => Some(Self::Debug),
            "INFO" => Some(Self::Info),
            "WARN" => Some(Self::Warn),
            "ERROR" => Some(Self::Error),
            _ => None,
        }
    }
}

/// Each file rotates once it would pass this many bytes: 5 MiB, as logger.cjs.
pub const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Everything the writer needs to start. `from_env` reads the same variables logger.cjs reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub app_level: Level,
    pub debug_level: Level,
    pub scopes: Vec<String>,
    pub session_id: String,
    pub pid: u32,
    pub max_bytes: u64,
}

impl Config {
    /// `lookup` reads one environment variable. `LOG_LEVEL` sets both levels, the two specific variables override one each.
    /// `packaged` and `env_file` decide `DRAGGY_DEBUG` as `debug_setting` does, so development reads `.env.local`.
    pub fn from_env(
        lookup: impl Fn(&str) -> Option<String>,
        session_id: impl Into<String>,
        pid: u32,
        packaged: bool,
        env_file: Option<&str>,
    ) -> Self {
        let global = non_empty(lookup("LOG_LEVEL"));
        let app = non_empty(lookup("APP_LOG_LEVEL")).or_else(|| global.clone());
        let debug = non_empty(lookup("DEBUG_LOG_LEVEL")).or(global);
        let raised = debug_setting(lookup("DRAGGY_DEBUG").as_deref(), packaged, env_file);
        Self {
            app_level: resolve(app.as_deref(), Level::Info),
            debug_level: resolve(debug.as_deref(), Level::Debug),
            scopes: parse_scopes(&raised.unwrap_or_default()),
            session_id: session_id.into(),
            pid,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

/// The scopes `Diagnostics::set_level` raises: logger.cjs takes one comma-separated string, or an array of names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scopes<'a> {
    /// Split on commas, each part trimmed, blank parts dropped.
    Text(&'a str),
    /// Each item trimmed and kept whole, so an item with a comma stays one scope; blank items are dropped.
    List(&'a [&'a str]),
}

/// The scope names a `Scopes` value raises, before the caller applies its caps.
pub(crate) fn scope_names(scopes: Scopes<'_>) -> Vec<String> {
    match scopes {
        Scopes::Text(text) => parse_scopes(text),
        Scopes::List(items) => items
            .iter()
            .map(|item| js_trim(item))
            .filter(|item| !item.is_empty())
            .map(str::to_owned)
            .collect(),
    }
}

/// What `Diagnostics::level_state` reports: the app level, the scopes raised to DEBUG, keep, and when a timed level ends.
#[derive(Clone, Debug, PartialEq)]
pub struct LevelState {
    pub level: Level,
    pub scopes: Vec<String>,
    pub keep: bool,
    /// Unix milliseconds at which a timed level reverts, or `None` when it does not.
    pub until: Option<f64>,
}

/// An empty variable counts as unset, as `||` does in the JavaScript.
fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

/// An unknown word falls back to the default and does not try the other variable.
fn resolve(raw: Option<&str>, fallback: Level) -> Level {
    raw.and_then(Level::parse).unwrap_or(fallback)
}

/// Comma-separated scopes. Blank entries are dropped, and each entry is trimmed as JavaScript trims it.
pub(crate) fn parse_scopes(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(js_trim)
        .filter(|scope| !scope.is_empty())
        .map(str::to_owned)
        .collect()
}

/// `parseScopes` for a value read from JSON: an array takes each item as text, anything else is split as a string.
pub(crate) fn parse_scopes_value(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| js_trim(&js_string(item)).to_owned())
            .filter(|scope| !scope.is_empty())
            .collect(),
        other => {
            let text = other
                .filter(|value| js_truthy(value))
                .map(js_string)
                .unwrap_or_default();
            parse_scopes(&text)
        }
    }
}

/// True for a raised scope and its children: `ipc` covers `ipc.files` and `ipc:files`. `*` and `all` cover everything.
pub(crate) fn scope_raised(raised: &[String], scope: &str) -> bool {
    raised.iter().any(|prefix| {
        let prefix = prefix.as_str();
        prefix == "*"
            || prefix == "all"
            || scope == prefix
            || scope
                .strip_prefix(prefix)
                .and_then(|rest| rest.chars().next())
                .is_some_and(|next| next == '.' || next == ':')
    })
}

/// The `DRAGGY_DEBUG` value logger.cjs uses. In development the environment wins, and `.env.local` stands in when it is empty.
/// `env_file` is the text of `.env.local` if the shell read it; packaged builds never use the file.
pub fn debug_setting(
    env_value: Option<&str>,
    packaged: bool,
    env_file: Option<&str>,
) -> Option<String> {
    if env_value.is_some_and(|value| !value.is_empty()) || packaged {
        return env_value.map(str::to_owned);
    }
    env_file.and_then(debug_from_env_file)
}

static ENV_LINE: LazyLock<Option<Regex>> =
    // TS quirk: logger.cjs lost the backslashes, so this matches literal `s` characters, and a scope ending in s loses it.
    LazyLock::new(|| Regex::new(r"^s*DRAGGY_DEBUGs*=s*(.*?)s*$").ok());

/// The first `DRAGGY_DEBUG=` line of `.env.local`, its quotes stripped. Each JavaScript line terminator starts a new line.
pub fn debug_from_env_file(text: &str) -> Option<String> {
    let pattern = ENV_LINE.as_ref()?;
    text.split(['\n', '\r', '\u{2028}', '\u{2029}'])
        .find_map(|line| pattern.captures(line))
        .and_then(|found| found.get(1))
        .map(|value| strip_quotes(value.as_str()))
}

/// `replace(/^["']|["']$/g, "")`: one quote leaves the start, one leaves the end.
fn strip_quotes(value: &str) -> String {
    let is_quote = |c: char| c == '"' || c == '\'';
    let without_start = value.strip_prefix(is_quote).unwrap_or(value);
    without_start
        .strip_suffix(is_quote)
        .unwrap_or(without_start)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        Config, Level, Scopes, debug_from_env_file, debug_setting, parse_scopes,
        parse_scopes_value, scope_names, scope_raised,
    };

    /// A lookup over a fixed list, standing in for the process environment.
    fn env(pairs: &[(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |key| {
            owned
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.clone())
        }
    }

    #[test]
    fn global_level_sets_both_and_specific_variables_override_one_each() {
        let config = Config::from_env(
            env(&[("LOG_LEVEL", "error"), ("APP_LOG_LEVEL", "info")]),
            "s",
            1,
            true,
            None,
        );
        assert_eq!(
            (config.app_level, config.debug_level),
            (Level::Info, Level::Error)
        );
    }

    #[test]
    fn empty_and_unknown_values_fall_back() {
        let config = Config::from_env(
            env(&[
                ("APP_LOG_LEVEL", ""),
                ("LOG_LEVEL", "WARN"),
                ("DEBUG_LOG_LEVEL", "loud"),
            ]),
            "s",
            1,
            true,
            None,
        );
        assert_eq!(
            (config.app_level, config.debug_level),
            (Level::Warn, Level::Debug)
        );
    }

    #[test]
    fn from_env_reads_the_env_file_in_development_only() {
        let config = Config::from_env(env(&[]), "s", 1, false, Some("DRAGGY_DEBUG=beta"));
        assert_eq!(config.scopes, ["beta"]);
        let packaged = Config::from_env(env(&[]), "s", 1, true, Some("DRAGGY_DEBUG=beta"));
        assert!(packaged.scopes.is_empty());
    }

    #[test]
    fn scope_lists_keep_items_whole_and_trim_them() {
        assert_eq!(
            scope_names(Scopes::List(&[" alpha ", "", "a,b"])),
            ["alpha", "a,b"]
        );
        assert_eq!(scope_names(Scopes::Text(" a, ,b")), ["a", "b"]);
    }

    #[test]
    fn scopes_match_exactly_or_as_children_only() {
        let raised = parse_scopes(" providers, mcp.github ");
        assert!(scope_raised(&raised, "providers.openai"));
        assert!(scope_raised(&raised, "providers:retry"));
        assert!(scope_raised(&raised, "mcp.github"));
        assert!(!scope_raised(&raised, "providersx"));
        assert!(!scope_raised(&raised, "mcp.gitlab"));
        assert!(scope_raised(&["all".to_owned()], "anything"));
    }

    #[test]
    fn a_scope_list_from_json_takes_array_items_as_text() {
        assert_eq!(
            parse_scopes_value(Some(&json!([" ipc ", "", 5]))),
            ["ipc", "5"]
        );
        assert_eq!(parse_scopes_value(Some(&json!("a,b"))), ["a", "b"]);
        assert!(parse_scopes_value(Some(&json!(false))).is_empty());
    }

    #[test]
    fn the_env_file_line_keeps_a_trailing_s_off_the_scope_as_logger_cjs_does() {
        assert_eq!(
            debug_from_env_file("DRAGGY_DEBUG=providers\n").as_deref(),
            Some("provider")
        );
        assert_eq!(
            debug_from_env_file("DRAGGY_DEBUG=\"beta\"").as_deref(),
            Some("beta")
        );
        assert_eq!(
            debug_from_env_file("A=1\r\nDRAGGY_DEBUG=beta\r\n").as_deref(),
            Some("beta")
        );
        assert_eq!(debug_from_env_file("DRAGGY_DEBUG = beta"), None);
    }

    #[test]
    fn packaged_builds_and_set_variables_skip_the_env_file() {
        assert_eq!(
            debug_setting(Some("alpha"), false, Some("DRAGGY_DEBUG=beta")).as_deref(),
            Some("alpha")
        );
        assert_eq!(
            debug_setting(Some(""), false, Some("DRAGGY_DEBUG=beta")).as_deref(),
            Some("beta")
        );
        assert_eq!(debug_setting(None, true, Some("DRAGGY_DEBUG=beta")), None);
    }
}
