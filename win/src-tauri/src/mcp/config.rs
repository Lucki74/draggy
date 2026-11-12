//! Pure rules behind the MCP channels: the enabled list, the save checks, the credential split and the
//! catalogue's custom entries. Ports of the checks in main.cjs and secrets.cjs `adopt`.

use serde_json::{Map, Value, json};

/// The workspace key the enabled list is kept under. Chat and every project share it.
pub const DEFAULT_WORKSPACE: &str = "default";

/// The npm registry page a custom package links to when it names no docs.
const NPM_PAGE: &str = "https://www.npmjs.com/package/";

/// JavaScript truthiness for a stored JSON value.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// The value as `String(value)` reads it. Absent and null read as empty.
pub fn text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

/// The first truthy candidate as text, else the fallback. Mirrors `a || b || fallback`.
fn pick(candidates: &[Option<&Value>], fallback: &str) -> String {
    candidates
        .iter()
        .find(|candidate| truthy(**candidate))
        .map(|candidate| text(*candidate))
        .unwrap_or_else(|| fallback.to_owned())
}

/// The ids switched on. The default workspace's list wins; without one, the per-server flags count.
pub fn enabled_ids(record: &Value, config: &Map<String, Value>) -> Vec<String> {
    if let Some(ids) = record.get(DEFAULT_WORKSPACE).and_then(Value::as_array) {
        return ids.iter().map(|id| text(Some(id))).collect();
    }
    config
        .iter()
        .filter(|(_, entry)| truthy(entry.get("enabled")))
        .map(|(id, _)| id.clone())
        .collect()
}

/// The list with `id` added or removed. An id already in the list keeps its place.
pub fn with_enabled(mut ids: Vec<String>, id: &str, enabled: bool) -> Vec<String> {
    if !enabled {
        ids.retain(|known| known != id);
    } else if !ids.iter().any(|known| known == id) {
        ids.push(id.to_owned());
    }
    ids
}

/// Whether an address is https, or plain http to this computer. The check is a prefix match, as the reference's.
pub fn is_safe_remote(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("https://")
        || lower.starts_with("http://localhost")
        || lower.starts_with("http://127.0.0.1")
}

/// An npm package name: an optional `@scope/` then a name, letters, digits and `-._~`.
pub fn valid_package(name: &str) -> bool {
    let (scope, bare) = match name.strip_prefix('@') {
        Some(rest) => match rest.split_once('/') {
            Some((scope, bare)) => (Some(scope), bare),
            None => return false,
        },
        None => (None, name),
    };
    let segment = |part: &str| {
        let mut chars = part.chars();
        chars
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric() || "-~".contains(first))
            && chars.all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c))
    };
    scope.is_none_or(segment) && segment(bare)
}

/// What `mcp:save` writes: the server's config entry, and the secret fields to move into the keystore.
pub struct Save {
    pub entry: Value,
    /// Present when the entry had secret fields, even empty ones. Empty values are not stored.
    pub secrets: Option<Map<String, Value>>,
}

/// Checks a save and builds the entry. `existing` is the stored entry; `known` says the catalogue lists the id.
pub fn plan_save(
    id: &str,
    entry: &Value,
    existing: Option<&Value>,
    known: bool,
    is_secret: impl Fn(&str) -> bool,
) -> Result<Save, String> {
    let url = match entry.get("url") {
        Some(Value::String(url)) => url.trim().to_owned(),
        _ => String::new(),
    };
    let package = match (
        entry.get("package"),
        existing.and_then(|old| old.get("package")),
    ) {
        (Some(Value::String(pkg)), _) => pkg.trim().to_owned(),
        (_, Some(Value::String(pkg))) => pkg.trim().to_owned(),
        _ => String::new(),
    };
    if !known && url.is_empty() && package.is_empty() {
        return Err(format!("There is no server called \"{id}\"."));
    }
    if !url.is_empty() && !is_safe_remote(&url) {
        return Err("A remote server has to be an https address, or a local one.".to_owned());
    }
    if !package.is_empty() && !valid_package(&package) {
        return Err("That is not a valid npm package name.".to_owned());
    }

    let env_in = entry
        .get("env")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let secret_fields: Map<String, Value> = if url.is_empty() {
        env_in
            .iter()
            .filter(|(field, _)| is_secret(field))
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect()
    } else {
        Map::new()
    };
    let secrets = (!secret_fields.is_empty()).then(|| secret_fields.clone());
    let env: Map<String, Value> = env_in
        .into_iter()
        .filter(|(field, _)| !secret_fields.contains_key(field))
        .collect();

    let old = |field: &str| existing.and_then(|old| old.get(field));
    let mut out = Map::new();
    out.insert("enabled".into(), json!(truthy(entry.get("enabled"))));
    out.insert("env".into(), Value::Object(env));
    out.insert(
        "arguments".into(),
        match entry.get("arguments") {
            Some(Value::Object(args)) => Value::Object(args.clone()),
            _ => json!({}),
        },
    );
    if !url.is_empty() {
        out.insert("url".into(), json!(url));
        out.insert("name".into(), json!(pick(&[entry.get("name")], id)));
    }
    if !known && !package.is_empty() {
        out.insert("package".into(), json!(package));
        out.insert(
            "name".into(),
            json!(pick(&[entry.get("name"), old("name")], id)),
        );
        out.insert(
            "description".into(),
            json!(pick(&[entry.get("description"), old("description")], "")),
        );
        out.insert(
            "docs".into(),
            json!(pick(&[entry.get("docs"), old("docs")], "")),
        );
        out.insert("source".into(), json!("registry"));
    }
    Ok(Save {
        entry: Value::Object(out),
        secrets,
    })
}

/// The entries the user added from the registry: they have a package and no shipped catalogue id.
pub fn custom_entries(config: &Map<String, Value>, shipped: &[String]) -> Vec<Value> {
    config
        .iter()
        .filter_map(|(id, entry)| {
            let package = entry.get("package").and_then(Value::as_str)?;
            if package.is_empty() || shipped.contains(id) {
                return None;
            }
            let list = |field: &str| match entry.get(field) {
                Some(Value::Array(items)) => Value::Array(items.clone()),
                _ => json!([]),
            };
            Some(json!({
                "id": id,
                "name": pick(&[entry.get("name")], id),
                "description": pick(&[entry.get("description")], ""),
                "package": package,
                "docs": pick(&[entry.get("docs")], &format!("{NPM_PAGE}{package}")),
                "args": list("args"),
                "arguments": list("argumentsList"),
                "env": list("envDeclarations"),
                "source": "registry",
            }))
        })
        .collect()
}

/// The entry with its env merged over the secrets kept for its server. The stored secrets win.
pub fn with_secrets(entry: &Value, owner: &Map<String, Value>) -> Value {
    let mut out = entry.clone();
    if let Some(object) = out.as_object_mut() {
        let mut env = entry
            .get("env")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        env.extend(owner.clone());
        object.insert("env".into(), Value::Object(env));
    }
    out
}

/// The trimmed config and each server's moved secret fields.
pub type Adopted = (Map<String, Value>, Vec<(String, Map<String, Value>)>);

/// Moves secret env fields out of the config. Returns the trimmed config and each server's moved fields.
pub fn adopt(config: &Map<String, Value>, is_secret: impl Fn(&str, &str) -> bool) -> Adopted {
    let mut records = Map::new();
    let mut moved = Vec::new();
    for (id, entry) in config {
        let mut entry = entry.clone();
        let mut taken = Map::new();
        if let Some(env) = entry.get_mut("env").and_then(Value::as_object_mut) {
            let fields: Vec<String> = env
                .iter()
                .filter(|(field, value)| is_secret(id, field) && !text(Some(value)).is_empty())
                .map(|(field, _)| field.clone())
                .collect();
            for field in fields {
                if let Some(value) = env.remove(&field) {
                    taken.insert(field, value);
                }
            }
        }
        if !taken.is_empty() {
            moved.push((id.clone(), taken));
        }
        records.insert(id.clone(), entry);
    }
    (records, moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_falls_back_to_the_per_server_flags() {
        let config = json!({"a": {"enabled": true}, "b": {"enabled": false}});
        let config = config.as_object().unwrap();
        assert_eq!(enabled_ids(&json!({}), config), vec!["a".to_owned()]);
        let record = json!({"default": ["b"]});
        assert_eq!(enabled_ids(&record, config), vec!["b".to_owned()]);
    }

    #[test]
    fn enabling_keeps_the_order_and_disabling_removes() {
        let ids = with_enabled(vec!["a".into()], "b", true);
        let ids = with_enabled(ids, "a", true);
        assert_eq!(ids, vec!["a".to_owned(), "b".to_owned()]);
        assert_eq!(with_enabled(ids, "a", false), vec!["b".to_owned()]);
    }

    #[test]
    fn remote_addresses_must_be_https_or_local() {
        assert!(is_safe_remote("https://example.com/mcp"));
        assert!(is_safe_remote("HTTP://127.0.0.1:8080"));
        assert!(!is_safe_remote("http://example.com"));
    }

    #[test]
    fn package_names_follow_the_npm_shape() {
        assert!(valid_package("left-pad"));
        assert!(valid_package("@scope/tool.name"));
        assert!(!valid_package("@scope"));
        assert!(!valid_package("bad name"));
        assert!(!valid_package("-/x"));
    }

    #[test]
    fn a_save_moves_secrets_out_of_the_entry() {
        let entry = json!({"enabled": true, "env": {"TOKEN": "t", "MODE": "x"}});
        let plan = plan_save("github", &entry, None, true, |f| f == "TOKEN").unwrap();
        assert_eq!(plan.entry["env"], json!({"MODE": "x"}));
        assert_eq!(plan.secrets.unwrap()["TOKEN"], json!("t"));
    }

    #[test]
    fn an_unknown_id_without_package_or_url_is_refused() {
        let error = plan_save("nope", &json!({}), None, false, |_| false).err();
        assert_eq!(
            error.as_deref(),
            Some("There is no server called \"nope\".")
        );
    }

    #[test]
    fn adopt_moves_only_secret_text() {
        let config = json!({"s": {"env": {"KEY": "k", "EMPTY": "", "PLAIN": "p"}}});
        let (records, moved) = adopt(config.as_object().unwrap(), |_, f| f != "PLAIN");
        assert_eq!(records["s"]["env"], json!({"EMPTY": "", "PLAIN": "p"}));
        assert_eq!(moved[0].1["KEY"], json!("k"));
    }

    #[test]
    fn custom_entries_skip_shipped_ids() {
        let config = json!({"mine": {"package": "pkg-a"}, "shipped": {"package": "x"}});
        let out = custom_entries(config.as_object().unwrap(), &["shipped".to_owned()]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["docs"], json!("https://www.npmjs.com/package/pkg-a"));
    }
}
