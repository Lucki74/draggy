//! The servers Draggy offers, each checked by hand, and the lookups over them.

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::js::{text, truthy};

/// Generated from electron/mcpCatalogue.cjs as `JSON.stringify(CATALOGUE, null, 2)`, so both sides load the same servers.
const DATA: &str = include_str!("../data/catalogue.json");

const NPM_PAGE: &str = "https://www.npmjs.com/package/";

/// A server the user can start: from the catalogue, or from the registry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Entry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<Argument>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<Vec<EnvVar>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
}

/// A value the user types in to start a server, such as a folder or a connection string.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Argument {
    #[serde(default)]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
}

/// A credential or setting passed to the server as an environment variable. A secret is masked and never logged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct EnvVar {
    #[serde(default)]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<bool>,
}

/// What the user has entered so far: environment values and argument values, as JSON.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Config {
    pub env: Map<String, Value>,
    pub arguments: Map<String, Value>,
}

/// The arguments and environment a server is started with.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandSpec {
    pub args: Vec<String>,
    pub env: Map<String, Value>,
}

static CATALOGUE: LazyLock<Vec<Entry>> = LazyLock::new(|| match serde_json::from_str(DATA) {
    Ok(entries) => entries,
    Err(error) => {
        tracing::error!(target: "mcp.catalogue", error = %error, "catalogue data unreadable");
        Vec::new()
    }
});

/// Every catalogue entry, as shipped. Lookups below add the docs link to what they return.
pub fn catalogue() -> &'static [Entry] {
    &CATALOGUE
}

/// The npm page for an entry's package, derived so the link cannot drift from the package name.
// TS quirk: an entry with no package links to `.../undefined`, which the reference does too.
pub fn docs_url(entry: &Entry) -> String {
    format!(
        "{NPM_PAGE}{}",
        entry.package.as_deref().unwrap_or("undefined")
    )
}

/// Every catalogue entry with its docs link filled in.
pub fn list_catalogue() -> Vec<Entry> {
    catalogue().iter().map(with_docs).collect()
}

/// The catalogue entry with this exact id, with its docs link filled in.
pub fn find_entry(id: &str) -> Option<Entry> {
    catalogue()
        .iter()
        .find(|entry| entry.id == id)
        .map(with_docs)
}

/// Entries whose id, name or description contains the term, ignoring case. A blank term lists everything.
pub fn search_catalogue(term: &str) -> Vec<Entry> {
    let wanted = term.trim().to_lowercase();
    if wanted.is_empty() {
        return list_catalogue();
    }

    list_catalogue()
        .into_iter()
        .filter(|entry| {
            [
                Some(entry.id.as_str()),
                entry.name.as_deref(),
                Some(entry.description.as_str()),
            ]
            .into_iter()
            .flatten()
            .any(|field| field.to_lowercase().contains(&wanted))
        })
        .collect()
}

/// What is still missing before a server can start, by label. Returned rather than failed, so the interface can ask for it.
pub fn missing_requirements(entry: Option<&Entry>, config: &Config) -> Vec<String> {
    let Some(entry) = entry else {
        return vec!["unknown server".to_owned()];
    };

    let mut missing = Vec::new();

    for variable in entry.env.iter().flatten() {
        let value = config.env.get(&variable.key);
        if variable.required == Some(true) && text(value).trim().is_empty() {
            missing.push(label_or_key(variable.label.as_deref(), &variable.key));
        }
    }

    for argument in entry.arguments.iter().flatten() {
        let value = config.arguments.get(&argument.key);
        let empty = if argument.multiple == Some(true) {
            match value {
                Some(Value::Array(items)) => items.iter().all(|item| !truthy(Some(item))),
                _ => true,
            }
        } else {
            text(value).trim().is_empty()
        };

        if argument.required == Some(true) && empty {
            missing.push(label_or_key(argument.label.as_deref(), &argument.key));
        }
    }

    missing
}

/// The arguments the server is started with: its own, then the user's. The package itself is run directly, never through npx.
pub fn command_for(entry: Option<&Entry>, config: &Config) -> Option<CommandSpec> {
    let entry = entry?;
    let mut args = entry.args.clone().unwrap_or_default();

    for argument in entry.arguments.iter().flatten() {
        let value = config.arguments.get(&argument.key);
        if argument.multiple == Some(true) {
            for item in value.and_then(Value::as_array).into_iter().flatten() {
                let piece = text(Some(item));
                if !piece.trim().is_empty() {
                    args.push(piece);
                }
            }
        } else {
            let piece = text(value);
            if !piece.trim().is_empty() {
                args.push(piece);
            }
        }
    }

    Some(CommandSpec {
        args,
        env: config.env.clone(),
    })
}

/// Whether a field is a credential. A declared one says so; otherwise only its name is evidence.
pub fn is_secret_field(id: &str, field: &str) -> bool {
    let declared = catalogue()
        .iter()
        .find(|entry| entry.id == id)
        .and_then(|entry| {
            entry
                .env
                .iter()
                .flatten()
                .find(|variable| variable.key == field)
        });

    if let Some(variable) = declared {
        return variable.secret == Some(true);
    }

    // ASCII-only, as the reference's case-insensitive match is for these ASCII words.
    let lowered = field.to_ascii_lowercase();
    ["token", "key", "secret", "password", "credential"]
        .iter()
        .any(|word| lowered.contains(word))
}

fn with_docs(entry: &Entry) -> Entry {
    let mut out = entry.clone();
    out.docs = Some(docs_url(entry));
    out
}

fn label_or_key(label: Option<&str>, key: &str) -> String {
    label
        .filter(|label| !label.is_empty())
        .unwrap_or(key)
        .to_owned()
}
