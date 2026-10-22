//! Skills on disk: one folder per skill under the skills directory, each with a `SKILL.md` whose front matter names
//! it. The folder name is the id. `use_skill` loads the instructions, or one other file from the folder.

use std::fs;
use std::path::{Path, PathBuf};

use draggy_agent::agent_loop::ToolContext;
use draggy_agent::skills::{
    InstalledSkill, LoadedSkill, SkillFile, SkillLookup, SkillReader, SkillSource, use_skill,
};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use serde_json::{Value, json};

use crate::error::CoreError;

const MANIFEST: &str = "SKILL.md";
/// The most bytes read from a skill file.
const FILE_LIMIT: u64 = 256 * 1024;

/// The `use_skill` definition a session offers when it has skills.
pub fn definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: "use_skill".to_owned(),
            description: "Load the instructions of an installed skill, or one of its files.".to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The skill id."},
                    "file": {"type": "string", "description": "A file that came with the skill, to read instead of its instructions."}
                },
                "required": ["id"]
            }),
        },
    }]
}

pub fn owns(name: &str) -> bool {
    name == "use_skill"
}

/// The skills folder, read fresh on every call so an install shows up at once.
#[derive(Debug, Clone)]
pub struct SkillStore {
    dir: PathBuf,
}

impl SkillStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Every skill on the shelf, by id.
    pub fn list(&self) -> Vec<InstalledSkill> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut skills: Vec<InstalledSkill> = entries
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| {
                let id = entry.file_name().to_string_lossy().into_owned();
                let text = fs::read_to_string(entry.path().join(MANIFEST)).ok()?;
                let (meta, _) = split(&text);
                Some(InstalledSkill {
                    name: meta.name.unwrap_or_else(|| id.clone()),
                    description: meta.description.unwrap_or_default(),
                    id,
                    ..InstalledSkill::default()
                })
            })
            .collect();
        skills.sort_by(|a, b| a.id.cmp(&b.id));
        skills
    }

    fn folder(&self, id: &str) -> Option<PathBuf> {
        // An id is a folder name, never a path.
        if id.is_empty() || id.contains(['/', '\\']) || id.starts_with('.') {
            return None;
        }
        let folder = self.dir.join(id);
        folder.is_dir().then_some(folder)
    }

    fn load(&self, id: &str) -> Option<LoadedSkill> {
        let folder = self.folder(id)?;
        let text = fs::read_to_string(folder.join(MANIFEST)).ok()?;
        let (meta, body) = split(&text);
        let mut files = Vec::new();
        collect(&folder, &folder, &mut files);
        files.retain(|name| name != MANIFEST);
        files.sort();
        Some(LoadedSkill {
            id: id.to_owned(),
            name: meta.name.unwrap_or_else(|| id.to_owned()),
            body: body.to_owned(),
            files,
        })
    }
}

impl SkillReader for SkillStore {
    fn read(&mut self, _workspace_id: &str, id: &str) -> Option<LoadedSkill> {
        self.load(id)
    }
}

impl SkillSource for SkillStore {
    fn lookup(&mut self, _workspace_id: &str, id: &str, file: Option<&str>) -> SkillLookup {
        let Some(skill) = self.load(id) else {
            return SkillLookup::Missing {
                error: Some(format!("There is no skill called {id}.")),
            };
        };
        let Some(name) = file else {
            return SkillLookup::Found { skill, file: None };
        };
        if !skill.files.iter().any(|known| known == name) {
            return SkillLookup::Missing {
                error: Some(format!("The skill {id} has no file {name}.")),
            };
        }
        let path = self.dir.join(id).join(name);
        match read_limited(&path) {
            Some(content) => SkillLookup::Found {
                skill,
                file: Some(SkillFile {
                    name: name.to_owned(),
                    content,
                }),
            },
            None => SkillLookup::Missing {
                error: Some(format!("The file {name} could not be read.")),
            },
        }
    }
}

/// Runs a `use_skill` call.
pub fn run(store: &mut SkillStore, args: &Value, ctx: &mut ToolContext<'_>) -> String {
    let id = args.get("id").and_then(Value::as_str).unwrap_or("");
    let file = args.get("file").and_then(Value::as_str);
    use_skill(ctx, store, "default", id, file, &|key| match key {
        "usingSkill" => "Using skill".to_owned(),
        "usedSkill" => "Used skill".to_owned(),
        other => other.to_owned(),
    })
}

fn read_limited(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > FILE_LIMIT {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Files under a skill folder, as paths relative to it with forward slashes.
fn collect(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
        } else if let Ok(relative) = path.strip_prefix(root) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// An installed skill, as a settings page lists it.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// The skills in `dir`, by id. An empty or missing folder gives none.
#[uniffi::export]
pub fn list_skills(dir: String) -> Vec<SkillRecord> {
    SkillStore::new(dir)
        .list()
        .into_iter()
        .map(|skill| SkillRecord {
            id: skill.id,
            name: skill.name,
            description: skill.description,
        })
        .collect()
}

/// Copies a skill folder, which must hold a `SKILL.md`, into `dir`. Returns its id. A skill with that id is replaced.
#[uniffi::export]
pub fn install_skill(dir: String, source: String) -> Result<String, CoreError> {
    let source = PathBuf::from(source);
    if !source.join(MANIFEST).is_file() {
        return Err(CoreError::Invalid {
            message: "The folder has no SKILL.md.".to_owned(),
        });
    }
    let id = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .ok_or_else(|| CoreError::Invalid {
            message: "The folder has no usable name.".to_owned(),
        })?;
    let target = PathBuf::from(&dir).join(&id);
    if target == source {
        return Ok(id);
    }
    let failed = |error: std::io::Error| CoreError::Internal {
        message: error.to_string(),
    };
    if target.exists() {
        fs::remove_dir_all(&target).map_err(failed)?;
    }
    copy_tree(&source, &target).map_err(failed)?;
    Ok(id)
}

/// Deletes the skill folder `id` from `dir`.
#[uniffi::export]
pub fn remove_skill(dir: String, id: String) -> Result<(), CoreError> {
    let store = SkillStore::new(dir);
    let folder = store.folder(&id).ok_or_else(|| CoreError::Invalid {
        message: format!("There is no skill called {id}."),
    })?;
    fs::remove_dir_all(folder).map_err(|error| CoreError::Internal {
        message: error.to_string(),
    })
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[derive(Default)]
struct Meta {
    name: Option<String>,
    description: Option<String>,
}

/// Splits a `SKILL.md` into its front matter and the instructions after it.
fn split(text: &str) -> (Meta, &str) {
    let text = text.trim_start_matches('\u{feff}');
    let mut meta = Meta::default();
    let Some(rest) = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))
    else {
        return (meta, text);
    };
    let mut consumed = 0;
    for line in rest.split_inclusive('\n') {
        consumed += line.len();
        let line = line.trim_end();
        if line == "---" {
            return (meta, rest[consumed..].trim_start_matches(['\r', '\n']));
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().trim_matches(['"', '\'']).to_owned();
            match key.trim() {
                "name" if !value.is_empty() => meta.name = Some(value),
                "description" if !value.is_empty() => meta.description = Some(value),
                _ => {}
            }
        }
    }
    (Meta::default(), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shelf() -> (tempfile::TempDir, SkillStore) {
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join("pdf-notes");
        fs::create_dir_all(skill.join("ref")).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: PDF notes\ndescription: \"Summarise a PDF\"\n---\nRead it first.\n",
        )
        .unwrap();
        fs::write(skill.join("ref/tips.md"), "tip").unwrap();
        let store = SkillStore::new(dir.path());
        (dir, store)
    }

    #[test]
    fn the_shelf_lists_skills_by_front_matter() {
        let (_dir, store) = shelf();
        let skills = store.list();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "pdf-notes");
        assert_eq!(skills[0].name, "PDF notes");
        assert_eq!(skills[0].description, "Summarise a PDF");
    }

    #[test]
    fn a_skill_loads_its_body_and_files() {
        let (_dir, mut store) = shelf();
        let skill = store.read("default", "pdf-notes").unwrap();
        assert_eq!(skill.body, "Read it first.\n");
        assert_eq!(skill.files, vec!["ref/tips.md".to_owned()]);
        match store.lookup("default", "pdf-notes", Some("ref/tips.md")) {
            SkillLookup::Found { file, .. } => assert_eq!(file.unwrap().content, "tip"),
            SkillLookup::Missing { error } => panic!("{error:?}"),
        }
    }

    #[test]
    fn a_skill_installs_and_goes_away() {
        let (_dir, store) = shelf();
        let target = tempfile::tempdir().unwrap();
        let source = store.dir.join("pdf-notes");
        let dir = target.path().to_string_lossy().into_owned();
        let id = install_skill(dir.clone(), source.to_string_lossy().into_owned()).unwrap();
        assert_eq!(id, "pdf-notes");
        assert_eq!(list_skills(dir.clone()).len(), 1);
        assert!(target.path().join("pdf-notes/ref/tips.md").is_file());
        remove_skill(dir.clone(), id).unwrap();
        assert!(list_skills(dir).is_empty());
        assert!(install_skill("x".into(), target.path().to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn ids_cannot_leave_the_shelf() {
        let (_dir, mut store) = shelf();
        assert!(store.read("default", "../x").is_none());
        assert!(matches!(
            store.lookup("default", "pdf-notes", Some("../SKILL.md")),
            SkillLookup::Missing { .. }
        ));
    }
}
