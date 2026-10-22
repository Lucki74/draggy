//! Skills: folders with a SKILL.md, the shared format. Only name and description sit in the prompt; the body loads on
//! request, so a hundred skills cost about one. Ports electron/skills.cjs; the roots are passed in, not found.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;

use crate::files::locale_cmp;
use crate::fs_guard::{is_denied_name, is_inside, lexical, relative_text};
use crate::js;

pub const SKILL_FILE: &str = "SKILL.md";
pub const CATALOGUE_FILE: &str = "library.json";
/// How much of a skill body is worth handing over in one go.
pub const MAX_BODY_CHARS: usize = 20_000;
/// The format's own limit. A longer description is a body in the wrong place.
pub const MAX_DESCRIPTION_CHARS: usize = 1_024;
/// A file that came with a skill, read on request.
pub const MAX_FILE_CHARS: usize = 20_000;
const MAX_LISTED_FILES: usize = 100;
const MAX_FILE_DEPTH: usize = 3;
/// A few words for the slash menu, where a whole description does not fit.
pub const MAX_SUMMARY_CHARS: usize = 48;

/// Where skills may come from. The project's skills sit in `<project>/.draggy/skills`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roots {
    pub library: Option<PathBuf>,
    pub user: Option<PathBuf>,
    pub project: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Library,
    User,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Chat,
    Code,
    Both,
}

impl Surface {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "chat" => Some(Self::Chat),
            "code" => Some(Self::Code),
            "both" => Some(Self::Both),
            _ => None,
        }
    }
}

/// One skill as the listing shows it: no body, which loads only on request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub summary: String,
    pub path: PathBuf,
    pub source: Source,
    pub category: Value,
    pub surface: Surface,
    pub default_on: bool,
    /// A library skill the user cannot switch off. Not part of the listing.
    #[serde(skip)]
    pub locked: bool,
    pub model_invocable: bool,
    pub enabled: bool,
}

/// What the front matter and body of a SKILL.md say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frontmatter {
    pub name: String,
    pub description: String,
    pub body: String,
    pub disable_model_invocation: bool,
}

/// A skill loaded on request: its listing entry, its body (empty when a file was asked for) and the files beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBody {
    #[serde(flatten)]
    pub skill: Skill,
    pub body: String,
    pub files: Vec<String>,
}

/// One file from a skill's folder, read on request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkillFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillRead {
    pub skill: SkillBody,
    pub file: Option<SkillFile>,
}

/// How a skill read is asked: the user's switches, whether only switched-on skills may be read, and a file to read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadOptions {
    pub overrides: BTreeMap<String, bool>,
    pub enabled_only: bool,
    pub file: Option<String>,
}

/// Why a skill could not be read. The messages are the ones the model reads.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SkillError {
    #[error("There is no skill called \"{0}\".")]
    NotFound(String),
    #[error("The {0} skill is switched off.")]
    Off(String),
    #[error("\"{name}\" is not a file in the {id} skill.")]
    OutsideSkill { name: String, id: String },
    #[error("The {id} skill has no file called \"{name}\".")]
    NoSuchFile { name: String, id: String },
    #[error("\"{0}\" is not a text file, so it cannot be read here.")]
    NotText(String),
    #[error("\"{0}\" holds credentials, so Draggy does not open it.")]
    Credentials(String),
    #[error("That skill could not be read.")]
    Unparsed,
    #[error("{0}")]
    Io(String),
}

/// The skill layer for one process. It remembers the last listing so installs and switches are logged once, not per call.
#[derive(Debug, Default)]
pub struct Skills {
    last: Mutex<Noted>,
}

#[derive(Debug, Default)]
struct Noted {
    user_ids: Option<BTreeSet<String>>,
    enabled: Option<String>,
}

/// Front matter read from the text, or None when the file has no usable name and description.
pub fn parse_skill(text: &str) -> Option<Frontmatter> {
    let source = text.strip_prefix('\u{feff}').unwrap_or(text);
    let (block, body) = split_front_matter(source)?;
    let fields = read_fields(block);

    let name = fields.get("name").filter(|value| !value.is_empty())?;
    let description = fields
        .get("description")
        .filter(|value| !value.is_empty())?;
    Some(Frontmatter {
        name: name.clone(),
        description: js::take_units(description, MAX_DESCRIPTION_CHARS),
        body: js::trim(body).to_owned(),
        disable_model_invocation: fields
            .get("disable-model-invocation")
            .is_some_and(|value| value == "true"),
    })
}

/// The block between the `---` lines and the body after it. The closing line is the first "---" after a line break.
fn split_front_matter(source: &str) -> Option<(&str, &str)> {
    let rest = source.strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;

    let close = rest.find("\n---")?;
    let block_end = if close > 0 && rest.as_bytes()[close - 1] == b'\r' {
        close - 1
    } else {
        close
    };
    let after = &rest[close + 4..];
    let body = after
        .strip_prefix("\r\n")
        .or_else(|| after.strip_prefix(['\r', '\n']))
        .unwrap_or(after);
    Some((&rest[..block_end], body))
}

/// Flat `key: value` lines and block values, read without a YAML parser. Nested keys are skipped.
fn read_fields(block: &str) -> HashMap<String, String> {
    let lines: Vec<&str> = block
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    let mut fields = HashMap::new();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];
        let Some(at) = line.find(':') else {
            index += 1;
            continue;
        };
        if line.starts_with(js::is_space) {
            index += 1;
            continue;
        }

        let key = js::trim(&line[..at]).to_lowercase();
        let raw = js::trim(&line[at + 1..]);
        if matches!(raw, ">" | "|" | ">-" | ">+" | "|-" | "|+") {
            let (value, next) = read_block(&lines, index + 1, raw);
            if !key.is_empty() {
                fields.insert(key, value);
            }
            index = next;
            continue;
        }

        if !key.is_empty() {
            fields.insert(key, strip_quotes(raw).to_owned());
        }
        index += 1;
    }
    fields
}

/// A `>` value folds its indented lines into one line; a `|` value keeps the breaks. Returns the value and the next line.
fn read_block(lines: &[&str], start: usize, style: &str) -> (String, usize) {
    let mut taken: Vec<&str> = Vec::new();
    let mut index = start;
    while let Some(line) = lines.get(index) {
        if !(js::trim(line).is_empty() || line.starts_with(js::is_space)) {
            break;
        }
        taken.push(js::trim(line));
        index += 1;
    }

    let value = if style.starts_with('>') {
        collapse_spaces(&taken.join(" "))
    } else {
        taken.join("\n")
    };
    (js::trim(&value).to_owned(), index)
}

/// `replace(/\s+/g, " ")`: every run of JavaScript whitespace becomes one space.
fn collapse_spaces(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for c in text.chars() {
        if js::is_space(c) {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            out.push(c);
            in_run = false;
        }
    }
    out
}

/// One leading and one trailing quote character, as the JS replace removes them.
fn strip_quotes(raw: &str) -> &str {
    let is_quote = |c: char| c == '"' || c == '\'';
    let inner = raw.strip_prefix(is_quote).unwrap_or(raw);
    inner.strip_suffix(is_quote).unwrap_or(inner)
}

/// A few words for a skill written without a summary: the first phrase of its description, cut at a word.
pub fn summarize(description: &str) -> String {
    let phrase = first_phrase(description);
    let phrase = js::trim(phrase.strip_suffix('.').unwrap_or(phrase));
    if js::utf16_len(phrase) <= MAX_SUMMARY_CHARS {
        return phrase.to_owned();
    }

    let cut = js::take_units(phrase, MAX_SUMMARY_CHARS - 1);
    // A cut inside the first twenty units would leave too little, so it keeps the hard cut instead.
    let kept = match cut.rfind(' ') {
        Some(space) if js::utf16_len(&cut[..space]) > 20 => &cut[..space],
        _ => cut.as_str(),
    };
    format!(
        "{}…",
        kept.trim_end_matches(|c: char| c == ',' || js::is_space(c))
    )
}

/// The text before the first phrase break: a sentence end then space, a colon or semicolon then space, or a space before "(".
fn first_phrase(text: &str) -> &str {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut previous: Option<char> = None;
    for (position, &(byte, c)) in chars.iter().enumerate() {
        let next = chars.get(position + 1).map(|&(_, next)| next);
        let breaks = (js::is_space(c) && (previous == Some('.') || next == Some('(')))
            || ((c == ':' || c == ';') && next.is_some_and(js::is_space));
        if breaks {
            return &text[..byte];
        }
        previous = Some(c);
    }
    text
}

#[derive(Debug, Clone)]
struct CatalogueEntry {
    summary: Option<String>,
    category: Value,
    surface: Surface,
    on: bool,
    locked: bool,
}

/// `Boolean(value)` for a JSON value: null, false, zero and empty text are false; everything else is true.
fn js_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// The library's catalogue by skill id. Unreadable or malformed catalogues give an empty map, with a WARN.
fn read_catalogue(library: Option<&Path>) -> HashMap<String, CatalogueEntry> {
    let Some(root) = library else {
        return HashMap::new();
    };
    let bytes = match fs::read(root.join(CATALOGUE_FILE)) {
        Ok(bytes) => bytes,
        Err(error) => {
            if error.kind() != ErrorKind::NotFound {
                tracing::warn!(target: "skills", code = node_code(&error), "library catalogue unreadable");
            }
            return HashMap::new();
        }
    };
    let parsed: Value = match serde_json::from_str(&String::from_utf8_lossy(&bytes)) {
        Ok(parsed) => parsed,
        Err(_) => {
            tracing::warn!(target: "skills", "library catalogue unreadable");
            return HashMap::new();
        }
    };

    let entries = parsed
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // A null entry fails the whole catalogue, as the JS code does when it reads an entry's id.
    if entries.iter().any(Value::is_null) {
        tracing::warn!(target: "skills", "library catalogue unreadable");
        return HashMap::new();
    }

    let mut catalogue = HashMap::new();
    for entry in &entries {
        let Some(id) = entry.get("id").and_then(Value::as_str) else {
            continue;
        };
        let text = |key: &str| entry.get(key).and_then(Value::as_str);
        catalogue.insert(
            id.to_owned(),
            CatalogueEntry {
                summary: text("summary")
                    .filter(|summary| !summary.is_empty())
                    .map(str::to_owned),
                // The reference keeps whatever JSON value the catalogue holds, and null where it holds none.
                category: entry.get("category").cloned().unwrap_or(Value::Null),
                surface: text("surface")
                    .and_then(Surface::parse)
                    .unwrap_or(Surface::Both),
                on: js_truthy(entry.get("on")),
                locked: entry.get("locked").and_then(Value::as_bool) == Some(true),
            },
        );
    }
    catalogue
}

/// The bytes of a skill's SKILL.md, read through its real path. `Ok(None)` when a link takes it out of the skill folder,
/// or to a credentials-named file, which `read_skill_file` refuses too.
fn read_skill_text(folder: &Path) -> io::Result<Option<Vec<u8>>> {
    let real_folder = fs::canonicalize(folder)?;
    let real_file = fs::canonicalize(folder.join(SKILL_FILE))?;
    if !is_inside(&real_folder, &real_file) {
        return Ok(None);
    }
    if relative_text(&real_folder, &real_file)
        .split(['/', '\\'])
        .any(is_denied_name)
    {
        return Ok(None);
    }
    fs::read(real_file).map(Some)
}

/// One skill folder, or None when its SKILL.md is unreadable or has no usable front matter. A broken skill is skipped.
fn read_skill_folder(
    folder: &Path,
    source: Source,
    catalogue: &HashMap<String, CatalogueEntry>,
) -> Option<Skill> {
    let id = folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    let bytes = match read_skill_text(folder) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            tracing::warn!(target: "skills", skill = %id, source = ?source, "skill file refused");
            return None;
        }
        Err(error) => {
            tracing::warn!(target: "skills", skill = %id, source = ?source, code = node_code(&error), "skill file unreadable");
            return None;
        }
    };
    let Some(parsed) = parse_skill(&String::from_utf8_lossy(&bytes)) else {
        tracing::warn!(target: "skills", skill = %id, source = ?source, "skill has no usable front matter");
        return None;
    };

    let entry = if source == Source::Library {
        catalogue.get(&id)
    } else {
        None
    };
    Some(Skill {
        summary: entry
            .and_then(|entry| entry.summary.clone())
            .unwrap_or_else(|| summarize(&parsed.description)),
        description: parsed.description,
        name: parsed.name,
        path: folder.to_path_buf(),
        source,
        category: entry.map_or(Value::Null, |entry| entry.category.clone()),
        surface: entry.map_or(Surface::Both, |entry| entry.surface),
        // What the user writes is meant to be used; the library waits to be asked, bar its defaults.
        default_on: if source == Source::Library {
            entry.is_some_and(|entry| entry.on)
        } else {
            true
        },
        locked: source == Source::Library && entry.is_some_and(|entry| entry.locked),
        model_invocable: !parsed.disable_model_invocation,
        id,
        enabled: false,
    })
}

/// Every skill folder under `root`, in name order. A missing or unreadable root gives none.
fn list_in(
    root: Option<&Path>,
    source: Source,
    catalogue: &HashMap<String, CatalogueEntry>,
) -> Vec<Skill> {
    let Some(root) = root.filter(|root| root.exists()) else {
        return Vec::new();
    };
    let read = match fs::read_dir(root) {
        Ok(read) => read,
        Err(error) => {
            tracing::warn!(target: "skills", source = ?source, code = node_code(&error), "skill folder unreadable");
            return Vec::new();
        }
    };

    let mut folders: Vec<PathBuf> = read
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    folders.sort();
    folders
        .iter()
        .filter_map(|folder| read_skill_folder(folder, source, catalogue))
        .collect()
}

/// What else sits in a skill's folder, as paths relative to it. Hidden files and SKILL.md itself are left out.
fn list_files(folder: &Path) -> Vec<String> {
    let mut found = Vec::new();
    collect_files(folder, "", 0, &mut found);
    found
}

fn collect_files(directory: &Path, prefix: &str, depth: usize, found: &mut Vec<String>) {
    if depth > MAX_FILE_DEPTH || found.len() >= MAX_LISTED_FILES {
        return;
    }
    let Ok(read) = fs::read_dir(directory) else {
        return;
    };

    let mut entries: Vec<_> = read.flatten().collect();
    // Byte order first, as Node's readdir gives it, so names that collate alike keep the same order.
    entries.sort_by_key(|entry| entry.file_name());
    entries.sort_by(|a, b| {
        locale_cmp(
            &a.file_name().to_string_lossy(),
            &b.file_name().to_string_lossy(),
        )
    });
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || found.len() >= MAX_LISTED_FILES {
            continue;
        }
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_files(&entry.path(), &relative, depth + 1, found);
        } else if kind.is_file() && relative != SKILL_FILE {
            found.push(relative);
        }
    }
}

/// The code Node gives a failed file call, such as ENOENT, when the error has one it names.
fn node_code(error: &io::Error) -> Option<&'static str> {
    match error.kind() {
        ErrorKind::NotFound => Some("ENOENT"),
        ErrorKind::PermissionDenied => Some("EACCES"),
        ErrorKind::IsADirectory => Some("EISDIR"),
        ErrorKind::NotADirectory => Some("ENOTDIR"),
        _ => None,
    }
}

/// The message Node gives a failed read, such as "ENOENT: no such file or directory, open '<path>'". A folder fails at the read.
fn node_message(error: &io::Error, file: &Path) -> String {
    let Some(code) = node_code(error) else {
        return error.to_string();
    };
    let description = match error.kind() {
        ErrorKind::NotFound => "no such file or directory",
        ErrorKind::PermissionDenied => "permission denied",
        ErrorKind::IsADirectory => {
            return "EISDIR: illegal operation on a directory, read".to_owned();
        }
        _ => "not a directory",
    };
    format!("{code}: {description}, open '{}'", file.display())
}

/// One file from a skill's folder, which it may not climb out of by name.
fn read_skill_file(skill: &Skill, name: &str) -> Result<SkillFile, SkillError> {
    let target = lexical(&skill.path.join(name));
    let relative = relative_text(&skill.path, &target);
    let outside = || SkillError::OutsideSkill {
        name: name.to_owned(),
        id: skill.id.clone(),
    };
    // TS quirk: a file whose name starts with two dots is refused as outside the skill, as readSkillFile does.
    if relative.is_empty() || relative.starts_with("..") {
        return Err(outside());
    }

    let no_file = || SkillError::NoSuchFile {
        name: name.to_owned(),
        id: skill.id.clone(),
    };
    // The real paths decide, so a link inside the skill cannot reach a file outside it or a denied name.
    let (Ok(real_folder), Ok(real_target)) =
        (fs::canonicalize(&skill.path), fs::canonicalize(&target))
    else {
        return Err(no_file());
    };
    if !is_inside(&real_folder, &real_target) {
        tracing::warn!(target: "skills", skill = %skill.id, rule = "outside", "skill file refused");
        return Err(outside());
    }
    if relative_text(&real_folder, &real_target)
        .split(['/', '\\'])
        .any(is_denied_name)
    {
        tracing::warn!(target: "skills", skill = %skill.id, rule = "credentials", "skill file refused");
        return Err(SkillError::Credentials(name.to_owned()));
    }

    if !fs::metadata(&real_target).is_ok_and(|meta| meta.is_file()) {
        return Err(no_file());
    }
    let bytes = fs::read(&real_target).map_err(|_| no_file())?;
    if bytes.contains(&0) {
        return Err(SkillError::NotText(name.to_owned()));
    }

    Ok(SkillFile {
        name: relative,
        content: js::take_units(&String::from_utf8_lossy(&bytes), MAX_FILE_CHARS),
    })
}

impl Skills {
    /// Every skill a workspace can reach. Each root wins over the one before when ids match, and the user's switches win
    /// over the defaults. Sorted by name.
    pub fn list(&self, roots: &Roots, overrides: &BTreeMap<String, bool>) -> Vec<Skill> {
        let catalogue = read_catalogue(roots.library.as_deref());
        let library = list_in(roots.library.as_deref(), Source::Library, &catalogue);
        let mine = list_in(roots.user.as_deref(), Source::User, &catalogue);
        self.note_installs(&mine);
        let project_skills = roots
            .project
            .as_ref()
            .map(|project| project.join(".draggy").join("skills"));
        let theirs = list_in(project_skills.as_deref(), Source::Project, &catalogue);

        let mut order: Vec<Skill> = Vec::new();
        let mut position: HashMap<String, usize> = HashMap::new();
        for skill in library.into_iter().chain(mine).chain(theirs) {
            match position.get(&skill.id) {
                Some(&index) => order[index] = skill,
                None => {
                    position.insert(skill.id.clone(), order.len());
                    order.push(skill);
                }
            }
        }

        let mut skills: Vec<Skill> = order
            .into_iter()
            .map(|mut skill| {
                skill.enabled = skill.locked
                    || overrides
                        .get(&skill.id)
                        .copied()
                        .unwrap_or(skill.default_on);
                skill
            })
            .collect();
        skills.sort_by(|a, b| locale_cmp(&a.name, &b.name));
        self.note_state(&skills);
        skills
    }

    /// The whole skill, or one of its files, read only once the model asks. A switched-off skill is refused when
    /// `enabled_only` says the model is the one asking.
    pub fn read(
        &self,
        roots: &Roots,
        id: &str,
        options: &ReadOptions,
    ) -> Result<SkillRead, SkillError> {
        let skill = self
            .list(roots, &options.overrides)
            .into_iter()
            .find(|one| one.id == id)
            .ok_or_else(|| SkillError::NotFound(id.to_owned()))?;
        if options.enabled_only && !skill.enabled {
            return Err(SkillError::Off(id.to_owned()));
        }

        let files = list_files(&skill.path);
        if let Some(name) = options.file.as_deref().filter(|name| !name.is_empty()) {
            let file = read_skill_file(&skill, name)?;
            return Ok(SkillRead {
                skill: SkillBody {
                    skill,
                    body: String::new(),
                    files,
                },
                file: Some(file),
            });
        }

        let file = skill.path.join(SKILL_FILE);
        let bytes = read_skill_text(&skill.path)
            .map_err(|error| {
                tracing::warn!(target: "skills", skill = %id, code = node_code(&error), "skill read failed");
                SkillError::Io(node_message(&error, &file))
            })?
            .ok_or(SkillError::Unparsed)?;
        let parsed = parse_skill(&String::from_utf8_lossy(&bytes)).ok_or(SkillError::Unparsed)?;
        Ok(SkillRead {
            skill: SkillBody {
                body: js::take_units(&parsed.body, MAX_BODY_CHARS),
                skill,
                files,
            },
            file: None,
        })
    }

    /// One INFO line per user skill that appears or leaves between listings. The first listing sets the baseline.
    fn note_installs(&self, mine: &[Skill]) {
        let ids: BTreeSet<String> = mine.iter().map(|skill| skill.id.clone()).collect();
        let mut noted = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(previous) = &noted.user_ids {
            for id in ids.difference(previous) {
                tracing::info!(target: "skills", id = %id, "skill installed");
            }
            for id in previous.difference(&ids) {
                tracing::info!(target: "skills", id = %id, "skill removed");
            }
        }
        noted.user_ids = Some(ids);
    }

    /// One INFO line when the set of switched-on skills changes, not one per listing.
    fn note_state(&self, skills: &[Skill]) {
        let enabled: Vec<&str> = skills
            .iter()
            .filter(|skill| skill.enabled)
            .map(|skill| skill.id.as_str())
            .collect();
        let key = {
            let mut sorted = enabled.clone();
            sorted.sort_unstable();
            sorted.join(",")
        };
        let mut noted = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        if noted.enabled.as_deref() == Some(key.as_str()) {
            return;
        }
        noted.enabled = Some(key);
        tracing::info!(target: "skills", total = skills.len(), enabled = enabled.len(), "enabled skills changed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_gives_name_description_and_body() {
        let parsed = parse_skill("---\nname: Invoices\ndescription: How we write an invoice.\n---\n\nAlways put the date first.\n")
            .expect("parses");
        assert_eq!(parsed.name, "Invoices");
        assert_eq!(parsed.description, "How we write an invoice.");
        assert_eq!(parsed.body, "Always put the date first.");
    }

    #[test]
    fn quotes_and_windows_line_endings_are_read() {
        let parsed = parse_skill(
            "---\r\nname: \"Invoices\"\r\ndescription: 'How we do it.'\r\n---\r\n\r\nBody.\r\n",
        )
        .expect("parses");
        assert_eq!(parsed.name, "Invoices");
        assert_eq!(parsed.description, "How we do it.");
    }

    #[test]
    fn a_folded_description_joins_its_lines() {
        let parsed = parse_skill("---\nname: pdf\ndescription: >\n  Fills in PDF forms\n  and merges files.\nlicense: MIT\n---\n\nBody.")
            .expect("parses");
        assert_eq!(parsed.description, "Fills in PDF forms and merges files.");
    }

    #[test]
    fn a_missing_description_or_front_matter_is_refused() {
        assert!(parse_skill("---\nname: Invoices\n---\n\nBody.").is_none());
        assert!(parse_skill("# Just a document").is_none());
        assert!(parse_skill("").is_none());
    }

    #[test]
    fn a_closing_line_of_dashes_ends_the_block_even_without_a_newline_after_it() {
        let parsed = parse_skill("---\nname: a\ndescription: b\n---").expect("parses");
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn a_long_description_is_cut_at_the_format_limit() {
        let text = format!("---\nname: long\ndescription: {}\n---\n", "x".repeat(3_000));
        assert_eq!(
            parse_skill(&text)
                .expect("parses")
                .description
                .chars()
                .count(),
            MAX_DESCRIPTION_CHARS
        );
    }

    #[test]
    fn summaries_stop_at_a_sentence_or_a_colon() {
        assert_eq!(
            summarize("Writes our invoices: numbered lines. Use when billing."),
            "Writes our invoices"
        );
        assert_eq!(
            summarize("Reviews pull requests. Use when asked."),
            "Reviews pull requests"
        );
    }

    #[test]
    fn a_long_summary_is_cut_at_a_word_with_an_ellipsis() {
        let summary = summarize(
            "Turns every single spreadsheet export from the accounting system into a monthly board pack",
        );
        assert!(summary.chars().count() <= MAX_SUMMARY_CHARS);
        assert!(summary.ends_with('…'));
        assert!(!summary.contains(" …"));
    }

    #[test]
    fn a_summary_keeps_the_hard_cut_when_no_space_comes_late_enough() {
        let text = "Ab cdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 tail";
        let expected: String = text.chars().take(MAX_SUMMARY_CHARS - 1).collect::<String>() + "…";
        assert_eq!(summarize(text), expected);
    }

    #[test]
    fn a_folder_is_read_as_a_skill_only_when_its_front_matter_is_usable() {
        let dir = tempfile::tempdir().expect("temp dir");
        let folder = dir.path().join("reports");
        fs::create_dir_all(&folder).expect("folder");
        fs::write(
            folder.join(SKILL_FILE),
            "---\nname: reports\ndescription: Writes reports.\n---\nBody.\n",
        )
        .expect("skill");

        let skill = read_skill_folder(&folder, Source::User, &HashMap::new()).expect("reads");
        assert_eq!(
            (skill.id.as_str(), skill.enabled, skill.surface),
            ("reports", false, Surface::Both)
        );
        assert!(skill.model_invocable);
    }

    #[test]
    fn a_skill_file_name_outside_the_folder_is_refused() {
        let skill = Skill {
            id: "reports".into(),
            name: "reports".into(),
            description: "Writes reports.".into(),
            summary: "Writes reports".into(),
            path: PathBuf::from("/skills/reports"),
            source: Source::User,
            category: Value::Null,
            surface: Surface::Both,
            default_on: true,
            locked: false,
            model_invocable: true,
            enabled: true,
        };
        assert!(matches!(
            read_skill_file(&skill, "../secret/SKILL.md"),
            Err(SkillError::OutsideSkill { .. })
        ));
        assert!(matches!(
            read_skill_file(&skill, "/etc/passwd"),
            Err(SkillError::OutsideSkill { .. })
        ));
    }

    #[test]
    fn js_truthiness_matches_the_values_a_catalogue_can_hold() {
        assert!(!js_truthy(None));
        assert!(!js_truthy(Some(&Value::Null)));
        assert!(!js_truthy(Some(&Value::String(String::new()))));
        assert!(js_truthy(Some(&Value::String("no".into()))));
        assert!(js_truthy(Some(&serde_json::json!(1))));
        assert!(!js_truthy(Some(&serde_json::json!(0))));
    }
}
