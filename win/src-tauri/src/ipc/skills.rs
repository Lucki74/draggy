//! Handlers for the skill channels. The listing and reads come from draggy_tools::skills; this file finds the roots
//! and keeps the user's switches in the key-value store, as electron/main.cjs 4030-4066 does.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use draggy_storage::Storage;
use draggy_tools::skills::{ReadOptions, Roots, Skill, SkillError, SkillRead, Skills};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::storage::{blocking, closed, js_string, truthy, with_storage, workspace_root};
use super::{IpcError, Registry};
use crate::AppState;

const SKILLS_ENABLED_KEY: &str = "skillsEnabled";
const LIBRARY_DIR: &str = "skills-library";

/// One process-wide layer: it remembers the last listing so installs and switches are logged once.
static SKILLS: LazyLock<Skills> = LazyLock::new(Skills::default);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "skills:list" => list);
    register!(registry, "skills:read" => read);
    register!(registry, "skills:set-enabled" => set_enabled);
    register!(registry, "skills:open" => open);
}

/// The shipped skills: the resource folder in a packaged build, the source folder in a debug one.
fn library_root(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = app
        .path()
        .resource_dir()
        .map(|dir| dir.join(LIBRARY_DIR))
        .into_iter()
        .collect();
    if cfg!(debug_assertions) {
        candidates.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("electron")
                .join(LIBRARY_DIR),
        );
    }
    candidates.into_iter().find(|dir| dir.is_dir())
}

fn roots(app: &AppHandle, project: Option<PathBuf>) -> Roots {
    let data_dir = app.state::<AppState>().storage.data_dir().to_path_buf();
    Roots {
        library: library_root(app),
        user: Some(data_dir.join("skills")),
        project,
    }
}

/// The switches the user has flipped, by skill id. Anything missing or unreadable keeps its default.
fn overrides_from(raw: Option<&str>) -> Map<String, Value> {
    match raw.map(serde_json::from_str::<Value>) {
        Some(Ok(Value::Object(map))) => map,
        _ => Map::new(),
    }
}

fn bool_overrides(map: &Map<String, Value>) -> BTreeMap<String, bool> {
    map.iter()
        .filter_map(|(id, value)| value.as_bool().map(|flag| (id.clone(), flag)))
        .collect()
}

fn stored_overrides(storage: Option<&Storage>) -> Map<String, Value> {
    let raw = storage.and_then(|db| db.get_value(SKILLS_ENABLED_KEY).ok().flatten());
    overrides_from(raw.as_deref())
}

fn listing_reply(skills: &[Skill]) -> Value {
    json!({ "success": true, "skills": skills })
}

/// The reply for a read. A file read carries the file and an empty body, as the Electron build does.
fn read_reply(result: Result<SkillRead, SkillError>) -> Value {
    match result {
        Ok(read) => {
            let mut reply = json!({ "success": true, "skill": read.skill });
            if let Some(file) = read.file {
                reply["file"] = json!(file);
            }
            reply
        }
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    }
}

/// The overrides with one switch set, as the JSON the store keeps.
fn with_switch(mut overrides: Map<String, Value>, id: String, enabled: bool) -> String {
    overrides.insert(id, Value::Bool(enabled));
    Value::Object(overrides).to_string()
}

async fn list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = js_string(args.first());
    let project = workspace_root(&app, &workspace).await;
    let roots = roots(&app, project);
    let storage = app.state::<AppState>().storage.handle();
    blocking(move || {
        let overrides = bool_overrides(&stored_overrides(storage.as_deref()));
        listing_reply(&SKILLS.list(&roots, &overrides))
    })
    .await
}

async fn read(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = js_string(args.first());
    let id = js_string(args.get(1));
    let options = args.get(2);
    let enabled_only = options
        .and_then(|value| value.get("enabledOnly"))
        .is_some_and(truthy);
    let file = options
        .and_then(|value| value.get("file"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);
    let project = workspace_root(&app, &workspace).await;
    let roots = roots(&app, project);
    let storage = app.state::<AppState>().storage.handle();
    blocking(move || {
        let overrides = stored_overrides(storage.as_deref());
        let options = ReadOptions {
            overrides: bool_overrides(&overrides),
            enabled_only,
            file,
        };
        read_reply(SKILLS.read(&roots, &id, &options))
    })
    .await
}

async fn set_enabled(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let enabled = args.get(1).is_some_and(truthy);
    with_storage(&app, "skills", closed(), move |storage| {
        let overrides = stored_overrides(Some(storage));
        storage.set_value(SKILLS_ENABLED_KEY, &with_switch(overrides, id, enabled))?;
        Ok(json!({ "success": true }))
    })
    .await
}

/// Opens the user's skill folder. A folder that cannot be made is refused; otherwise the answer is the opener's
/// message, empty on success, as shell.openPath gives.
async fn open(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let folder = app.state::<AppState>().storage.data_dir().join("skills");
    let made = folder.clone();
    if let Err(error) = blocking(move || std::fs::create_dir_all(made)).await? {
        return Ok(json!({ "success": false, "error": error.to_string() }));
    }
    let answer = match app
        .opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
    {
        Ok(()) => String::new(),
        Err(error) => error.to_string(),
    };
    Ok(Value::String(answer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_tools::skills::Source;

    #[test]
    fn a_missing_or_broken_store_gives_no_switches() {
        assert!(overrides_from(None).is_empty());
        assert!(overrides_from(Some("not json")).is_empty());
        assert!(overrides_from(Some("[true]")).is_empty());
        let map = overrides_from(Some(r#"{"a":true,"b":"yes"}"#));
        assert_eq!(bool_overrides(&map).get("a"), Some(&true));
        assert!(!bool_overrides(&map).contains_key("b"));
    }

    #[test]
    fn a_switch_is_written_over_the_others() {
        let map = overrides_from(Some(r#"{"a":true}"#));
        let saved = with_switch(map, "b".to_owned(), false);
        let back = overrides_from(Some(&saved));
        assert_eq!(back["a"], json!(true));
        assert_eq!(back["b"], json!(false));
    }

    #[test]
    fn an_unknown_skill_is_refused_in_the_shape_the_model_reads() {
        let reply = read_reply(Err(SkillError::NotFound("nope".to_owned())));
        assert_eq!(reply["success"], json!(false));
        assert_eq!(reply["error"], json!("There is no skill called \"nope\"."));
        let off = read_reply(Err(SkillError::Off("pdf".to_owned())));
        assert_eq!(off["error"], json!("The pdf skill is switched off."));
    }

    #[test]
    fn a_listing_names_each_skill_and_its_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let user = dir.path().join("skills");
        std::fs::create_dir_all(user.join("invoices")).expect("mkdir");
        std::fs::write(
            user.join("invoices").join("SKILL.md"),
            "---\nname: Invoices\ndescription: How we write an invoice.\n---\n\nBody.\n",
        )
        .expect("write");
        let roots = Roots {
            library: None,
            user: Some(user),
            project: None,
        };
        let skills = SKILLS.list(&roots, &BTreeMap::new());
        let reply = listing_reply(&skills);
        assert_eq!(reply["success"], json!(true));
        assert_eq!(reply["skills"][0]["id"], json!("invoices"));
        assert_eq!(reply["skills"][0]["source"], json!("user"));
        assert_eq!(reply["skills"][0]["enabled"], json!(true));
        assert_eq!(skills[0].source, Source::User);
    }

    #[test]
    fn a_file_read_carries_the_file_and_no_body() {
        let skill = Skill {
            id: "x".to_owned(),
            name: "X".to_owned(),
            description: "d".to_owned(),
            summary: "d".to_owned(),
            path: PathBuf::from("x"),
            source: Source::User,
            category: Value::Null,
            surface: draggy_tools::skills::Surface::Both,
            default_on: true,
            locked: false,
            model_invocable: true,
            enabled: true,
        };
        let read = SkillRead {
            skill: draggy_tools::skills::SkillBody {
                skill,
                body: String::new(),
                files: vec!["t.md".to_owned()],
            },
            file: Some(draggy_tools::skills::SkillFile {
                name: "t.md".to_owned(),
                content: "hi".to_owned(),
            }),
        };
        let reply = read_reply(Ok(read));
        assert_eq!(reply["skill"]["body"], json!(""));
        assert_eq!(reply["file"], json!({ "name": "t.md", "content": "hi" }));
    }
}
