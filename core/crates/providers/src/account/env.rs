//! The environment an account runtime starts with, built from an allowlist. A stray key or proxy in the user's shell
//! would turn a plan turn into a billed or proxied one, so nothing else is inherited.

use std::collections::BTreeMap;
use std::path::Path;

use thiserror::Error;
use tracing::{debug, warn};

/// The variables a runtime may inherit from the shell, matched without regard to case.
const INHERITED: [&str; 6] = ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG"];

/// Named so a test can prove none gets through; the allowlist alone already keeps them out.
pub const NEVER: [&str; 15] = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
];

/// The variable each runtime reads for its own home folder.
pub fn home_variable(runtime: &str) -> Option<&'static str> {
    match runtime {
        "codex" => Some("CODEX_HOME"),
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "gemini" => Some("GEMINI_CLI_HOME"),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EnvError {
    #[error("Unknown account runtime: {0}")]
    UnknownRuntime(String),
    #[error("An instance id names one folder, nothing more")]
    BadInstanceId,
    #[error("{0} never reaches an account runtime")]
    Forbidden(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountEnv {
    pub env: BTreeMap<String, String>,
    pub home: String,
}

fn forbidden(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    NEVER.contains(&upper.as_str()) || upper.contains("PROXY")
}

/// The private folder for one runtime's one instance: `appData/<runtime>/<instance>`, never anything else.
pub fn private_home(app_data: &str, runtime: &str, instance_id: &str) -> Result<String, EnvError> {
    if home_variable(runtime).is_none() {
        return Err(EnvError::UnknownRuntime(runtime.to_owned()));
    }
    let valid = !instance_id.is_empty()
        && instance_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid {
        return Err(EnvError::BadInstanceId);
    }
    Ok(Path::new(app_data)
        .join(runtime)
        .join(instance_id)
        .to_string_lossy()
        .into_owned())
}

/// Windows keeps variable names case-insensitive, so `Path` and `PATH` are the same one.
fn lookup<'a>(parent: &'a [(String, String)], name: &str) -> Option<&'a str> {
    parent
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

/// The environment a runtime starts with: the inherited allowlist, the extras it names, and its home in every
/// variable that points a tool at one folder. Extras that could bill, proxy or redirect a turn are refused.
pub fn account_env(
    runtime: &str,
    app_data: &str,
    instance_id: &str,
    parent: &[(String, String)],
    extra: &[(String, String)],
) -> Result<AccountEnv, EnvError> {
    let home = private_home(app_data, runtime, instance_id)?;
    let mut env = BTreeMap::new();
    let mut inherited = 0;
    for name in INHERITED {
        if let Some(value) = lookup(parent, name) {
            env.insert(name.to_owned(), value.to_owned());
            inherited += 1;
        }
    }
    for (name, value) in extra {
        if forbidden(name) {
            warn!(target: "providers.account", runtime, name = %name, "blocked forbidden variable");
            return Err(EnvError::Forbidden(name.clone()));
        }
        env.insert(name.clone(), value.clone());
    }
    env.insert("HOME".to_owned(), home.clone());
    env.insert("USERPROFILE".to_owned(), home.clone());
    if let Some(variable) = home_variable(runtime) {
        env.insert(variable.to_owned(), home.clone());
    }
    debug!(target: "providers.account", runtime, inherited, extra = extra.len(), "env built");
    Ok(AccountEnv { env, home })
}
