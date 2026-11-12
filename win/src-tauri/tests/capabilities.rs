//! Keeps the browser pane out of the main capability. Tauri grants a capability to every webview of
//! a window listed in `windows`, so the pane webviews must be reached by label only.

use std::path::Path;

use serde_json::Value;

fn capabilities() -> Vec<(String, Value)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut found: Vec<_> = std::fs::read_dir(&dir)
        .expect("capabilities dir is readable")
        .map(|entry| entry.expect("capability entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).expect("capability is readable");
            (
                name,
                serde_json::from_str(&text).expect("capability is JSON"),
            )
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

fn strings(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn by_name<'a>(all: &'a [(String, Value)], name: &str) -> &'a Value {
    &all.iter()
        .find(|(file, _)| file == name)
        .expect("capability file exists")
        .1
}

#[test]
fn main_capability_applies_to_the_main_webview_only() {
    let all = capabilities();
    let main = by_name(&all, "main.json");
    assert_eq!(strings(main, "webviews"), ["main"]);
    assert!(
        strings(main, "windows").is_empty(),
        "windows would extend it to the pane"
    );
    let permissions = strings(main, "permissions");
    assert!(permissions.iter().any(|p| p == "allow-ipc-invoke"));
    assert!(permissions.iter().any(|p| p == "allow-ipc-send"));
    assert!(permissions.iter().any(|p| p == "allow-gateway-info"));
}

#[test]
fn no_capability_reaches_the_pane_through_its_window() {
    for (file, value) in capabilities() {
        assert!(
            !strings(&value, "windows")
                .iter()
                .any(|w| w == "main" || w == "*"),
            "{file} lists the main window, which every pane webview inherits"
        );
        assert!(
            !strings(&value, "webviews").iter().any(|w| w == "*"),
            "{file} matches every webview"
        );
    }
}

#[test]
fn pane_capability_grants_nothing() {
    let all = capabilities();
    let pane = by_name(&all, "browser-pane.json");
    assert_eq!(strings(pane, "webviews"), ["browser-pane*"]);
    assert!(strings(pane, "windows").is_empty());
    assert!(strings(pane, "permissions").is_empty());
}

#[test]
fn only_the_main_and_pane_capabilities_name_a_webview() {
    let all = capabilities();
    let named: Vec<_> = all
        .iter()
        .filter(|(_, value)| !strings(value, "webviews").is_empty())
        .map(|(file, _)| file.as_str())
        .collect();
    assert_eq!(named, ["browser-pane.json", "main.json"]);
}
