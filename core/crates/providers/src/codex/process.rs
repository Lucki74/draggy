//! The config a Codex app-server starts with: every built-in switched off, and no provider, address or key named.
//! The config is rewritten before each start, so a hand edit never brings a built-in back.

use std::collections::BTreeMap;

use serde_json::{Value, json};

pub const CATALOG_NAME: &str = "draggy-models.json";

pub const FEATURES_OFF: [&str; 26] = [
    "code_mode",
    "code_mode_only",
    "context_management",
    "current_time_reminder",
    "deferred_executor",
    "image_generation",
    "memories",
    "multi_agent",
    "multi_agent_v2",
    "plugins",
    "request_permissions_tool",
    "shell_snapshot",
    "shell_tool",
    "standalone_web_search",
    "token_budget",
    "tool_suggest",
    "unified_exec",
    "view_image",
    "goals",
    "apps",
    "browser_use",
    "computer_use",
    "in_app_browser",
    "skill_search",
    "sleep_tool",
    "hooks",
];

/// The start flags: strict config, Draggy's session source, and the protocol on stdio.
pub const ARGS: [&str; 5] = [
    "--strict-config",
    "--session-source",
    "draggy",
    "--listen",
    "stdio://",
];

/// The notification the client sends once the app-server has answered `initialize`.
pub const INITIALIZED: &str = "initialized";

/// The first request: Draggy's identity, and the two capabilities it asks for. Attestation stays off.
pub fn initialize_params(version: &str) -> Value {
    json!({
        "clientInfo": { "name": "draggy", "title": "Draggy", "version": version },
        "capabilities": { "experimentalApi": true, "requestAttestation": false },
    })
}

/// The config file's text. `top_level` and `tables` exist for the probe that points Codex at a mock; the app passes
/// neither. Top-level keys come first, before any table, where TOML reads them as top-level.
pub fn config_toml(catalog_path: &str, top_level: &[String], tables: &[String]) -> String {
    let mut lines: Vec<String> = vec![format!(
        "model_catalog_json = {}",
        json_string(catalog_path)
    )];
    lines.extend(top_level.iter().cloned());
    lines.extend(
        [
            "web_search = \"disabled\"",
            "forced_login_method = \"chatgpt\"",
            "cli_auth_credentials_store = \"file\"",
            "check_for_update_on_startup = false",
            "include_permissions_instructions = false",
            "include_environment_context = false",
            "include_apps_instructions = false",
            "include_collaboration_mode_instructions = false",
            "project_doc_max_bytes = 0",
            "[analytics]",
            "enabled = false",
            "[feedback]",
            "enabled = false",
            "[features]",
        ]
        .map(str::to_owned),
    );
    lines.extend(FEATURES_OFF.iter().map(|name| format!("{name} = false")));
    lines.extend(
        [
            "[skills]",
            "include_instructions = false",
            "[cloud.skills]",
            "enabled = false",
            "[tools.experimental_request_user_input]",
            "enabled = false",
            "[tools.update_plan]",
            "enabled = false",
        ]
        .map(str::to_owned),
    );
    lines.extend(tables.iter().cloned());
    lines.push(String::new());
    lines.join("\n")
}

/// A string as JSON writes it, which TOML reads the same way for a plain path.
fn json_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default()
}

/// Each model's context window from the catalog, since the model list leaves it out. Models without one are skipped.
pub fn context_windows(catalog: &Value) -> BTreeMap<String, u64> {
    catalog
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let window = model
                .get("context_window")
                .and_then(Value::as_u64)
                .filter(|window| *window > 0)?;
            let slug = model.get("slug").and_then(Value::as_str)?;
            Some((slug.to_owned(), window))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_handshake_names_draggy_and_asks_for_the_experimental_api_only() {
        assert_eq!(
            initialize_params("1.3.0"),
            json!({
                "clientInfo": { "name": "draggy", "title": "Draggy", "version": "1.3.0" },
                "capabilities": { "experimentalApi": true, "requestAttestation": false },
            })
        );
        assert_eq!(INITIALIZED, "initialized");
    }
}
