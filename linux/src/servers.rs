//! Text and settings for the MCP servers page, kept apart from the widgets so they can be tested without a display.

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;

use draggy_core::{McpInputRecord, McpServerConfigRecord};

/// The line under a server's name: what it does, then the warning when it has one.
pub fn subtitle(description: &str, caution: Option<&str>) -> String {
    match caution {
        Some(text) if !text.trim().is_empty() => format!("{description}\nCaution: {text}"),
        _ => description.to_owned(),
    }
}

/// The text of a server's button.
pub fn action_label(running: bool) -> &'static str {
    if running { "Stop" } else { "Start" }
}

/// The keyring name of one secret input of a server.
pub fn secret_name(server: &str, key: &str) -> String {
    format!("mcp:{server}:{key}")
}

/// The first required input with no value, by its label.
pub fn missing_required<'a>(
    inputs: &'a [McpInputRecord],
    values: &HashMap<String, String>,
) -> Option<&'a str> {
    inputs
        .iter()
        .find(|input| input.required && blank(values.get(&input.key)))
        .map(|input| input.label.as_str())
}

fn blank(value: Option<&String>) -> bool {
    value.is_none_or(|text| text.trim().is_empty())
}

/// The settings to start a server with, or `None` when nothing was filled in so the defaults apply.
pub fn build_config(
    inputs: &[McpInputRecord],
    values: &HashMap<String, String>,
) -> Option<McpServerConfigRecord> {
    let mut config = McpServerConfigRecord::default();
    for input in inputs {
        let Some(value) = values
            .get(&input.key)
            .filter(|text| !text.trim().is_empty())
        else {
            continue;
        };
        let target = if input.is_env {
            &mut config.env
        } else {
            &mut config.arguments
        };
        target.insert(input.key.clone(), value.trim().to_owned());
    }
    (!config.env.is_empty() || !config.arguments.is_empty()).then_some(config)
}

/// The values of inputs that are not secret, kept in one JSON file per user. Secrets go to the keyring instead.
pub struct PlainValues {
    path: PathBuf,
}

type Saved = HashMap<String, HashMap<String, String>>;

impl PlainValues {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// The file under `$XDG_CONFIG_HOME/draggy`, falling back to `~/.config`.
    pub fn in_config_dir() -> Option<Self> {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
        Some(Self::new(base.join("draggy").join("servers.json")))
    }

    /// What was saved for a server. A missing or unreadable file holds nothing.
    pub fn load(&self, server: &str) -> HashMap<String, String> {
        self.read().remove(server).unwrap_or_default()
    }

    pub fn save(&self, server: &str, values: HashMap<String, String>) -> io::Result<()> {
        let mut saved = self.read();
        if values.is_empty() {
            saved.remove(server);
        } else {
            saved.insert(server.to_owned(), values);
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(&saved).map_err(io::Error::other)?;
        std::fs::write(&self.path, text)
    }

    fn read(&self) -> Saved {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(key: &str, required: bool, is_env: bool) -> McpInputRecord {
        McpInputRecord {
            key: key.to_owned(),
            label: format!("{key} label"),
            required,
            secret: false,
            is_env,
        }
    }

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn env_and_arguments_land_in_their_own_maps() {
        let inputs = [input("TOKEN", true, true), input("root", false, false)];
        let config =
            build_config(&inputs, &values(&[("TOKEN", " t "), ("root", "/srv")])).expect("config");
        assert_eq!(config.env.get("TOKEN").map(String::as_str), Some("t"));
        assert_eq!(
            config.arguments.get("root").map(String::as_str),
            Some("/srv")
        );
    }

    #[test]
    fn blank_values_give_no_config() {
        let inputs = [input("TOKEN", false, true)];
        assert_eq!(build_config(&inputs, &values(&[("TOKEN", "  ")])), None);
        assert_eq!(build_config(&inputs, &HashMap::new()), None);
    }

    #[test]
    fn a_missing_required_input_is_named_by_label() {
        let inputs = [input("A", false, true), input("B", true, true)];
        assert_eq!(
            missing_required(&inputs, &values(&[("A", "x")])),
            Some("B label")
        );
        assert_eq!(missing_required(&inputs, &values(&[("B", "y")])), None);
    }

    #[test]
    fn secret_names_are_scoped_to_the_server() {
        assert_eq!(secret_name("github", "TOKEN"), "mcp:github:TOKEN");
    }

    #[test]
    fn plain_values_round_trip_per_server() {
        let dir = std::env::temp_dir().join(format!("draggy-plain-{}", std::process::id()));
        let store = PlainValues::new(dir.join("servers.json"));
        assert!(store.load("a").is_empty());
        store.save("a", values(&[("k", "1")])).expect("save a");
        store.save("b", values(&[("k", "2")])).expect("save b");
        assert_eq!(store.load("a"), values(&[("k", "1")]));
        store.save("a", HashMap::new()).expect("clear a");
        assert!(store.load("a").is_empty());
        assert_eq!(store.load("b"), values(&[("k", "2")]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_caution_follows_the_description() {
        assert_eq!(
            subtitle("Files", Some("Reads disk")),
            "Files\nCaution: Reads disk"
        );
    }

    #[test]
    fn a_blank_caution_is_dropped() {
        assert_eq!(subtitle("Files", Some("  ")), "Files");
        assert_eq!(subtitle("Files", None), "Files");
    }

    #[test]
    fn the_button_names_the_next_step() {
        assert_eq!(action_label(false), "Start");
        assert_eq!(action_label(true), "Stop");
    }
}
