//! Import from Claude Code and Codex. `import:scan` lists what the two tools keep in the user's home folder and
//! `import:apply` copies the chosen items in. Secrets are never read into a reply or copied: see `looks_secret`.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use super::mcp::{read_mcp_config, write_mcp_config};
use super::storage::blocking;
use super::{IpcError, Registry};
use crate::AppState;
use crate::mcp::config::{is_safe_remote, valid_package};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "import:scan" => scan_command);
    register!(registry, "import:apply" => apply_command);
}

const MAX_MEMORY_BYTES: u64 = 64 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
const MAX_FILES: usize = 200;
const MAX_DEPTH: usize = 5;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Source {
    Claude,
    Codex,
}

impl Source {
    fn label(self) -> &'static str {
        match self {
            Source::Claude => "claude",
            Source::Codex => "codex",
        }
    }
}

enum Payload {
    Skill(PathBuf),
    Memory(String),
    Mcp(Value),
    None,
}

struct Item {
    source: Source,
    kind: &'static str,
    id: String,
    name: String,
    description: String,
    clash: bool,
    supported: bool,
    note: Option<&'static str>,
    needs_key: bool,
    payload: Payload,
}

impl Item {
    fn key(&self) -> String {
        format!("{}:{}:{}", self.source.label(), self.kind, self.id)
    }

    /// The preview row. It never carries file contents, env values or headers.
    fn preview(&self) -> Value {
        json!({
            "key": self.key(),
            "source": self.source.label(),
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "clash": self.clash,
            "supported": self.supported,
            "note": self.note,
            "needsKey": self.needs_key,
            "suggested": suggest(&self.id),
        })
    }
}

fn suggest(id: &str) -> String {
    let base: String = id.chars().take(56).collect();
    format!("{base}-imported")
}

/// Names that hold credentials: dropped from env, headers and arguments.
fn looks_secret(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    [
        "KEY",
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "AUTH",
        "BEARER",
        "CREDENTIAL",
    ]
    .iter()
    .any(|word| upper.contains(word))
}

/// Values that are credentials whatever their name is called.
fn value_looks_secret(value: &str) -> bool {
    let value = value.trim();
    [
        "sk-",
        "ghp_",
        "gho_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "AKIA",
        "Bearer ",
        "bearer ",
    ]
    .iter()
    .any(|prefix| value.starts_with(prefix))
}

/// Lowercase letters, digits and hyphens, at most 64 characters, or None when nothing is left.
fn slugify(text: &str) -> Option<String> {
    let mut out = String::new();
    for ch in text.chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            out.push(ch);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-');
    let out: String = out.chars().take(64).collect();
    let out = out.trim_end_matches('-').to_owned();
    (!out.is_empty()).then_some(out)
}

fn valid_slug(slug: &str) -> bool {
    let bytes = slug.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// What is already in Draggy, so a clash can be marked.
struct Taken {
    skills_root: PathBuf,
    mcp_ids: HashSet<String>,
}

fn read_text(path: &Path, cap: u64) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > cap {
        return None;
    }
    String::from_utf8(fs::read(path).ok()?).ok()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&read_text(path, 8 * 1024 * 1024)?).ok()
}

fn sorted_dirs(root: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
                && !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        })
        .collect();
    found.sort();
    found
}

fn scan_skills(
    root: &Path,
    source: Source,
    taken: &Taken,
    seen: &mut HashSet<String>,
    out: &mut Vec<Item>,
) {
    for dir in sorted_dirs(root) {
        let Some(text) = read_text(&dir.join("SKILL.md"), MAX_FILE_BYTES) else {
            continue;
        };
        let folder = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Some(id) = slugify(&folder) else { continue };
        let parsed = draggy_tools::skills::parse_skill(&text);
        let (name, description, supported) = match &parsed {
            Some(front) => (front.name.clone(), front.description.clone(), true),
            None => (folder.clone(), String::new(), false),
        };
        let clash = taken.skills_root.join(&id).exists() || !seen.insert(format!("skill:{id}"));
        out.push(Item {
            source,
            kind: "skill",
            id,
            name,
            description,
            clash,
            supported,
            note: (!supported).then_some("invalid"),
            needs_key: false,
            payload: Payload::Skill(dir),
        });
    }
}

fn scan_memory(path: &Path, source: Source, out: &mut Vec<Item>) {
    let Some(text) = read_text(path, MAX_MEMORY_BYTES) else {
        return;
    };
    if text.trim().is_empty() {
        return;
    }
    let first = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    out.push(Item {
        source,
        kind: "memory",
        id: "global".to_owned(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        description: first
            .trim_start_matches('#')
            .trim()
            .chars()
            .take(120)
            .collect(),
        clash: false,
        supported: true,
        note: None,
        needs_key: false,
        payload: Payload::Memory(text.trim().to_owned()),
    });
}

/// Commands and agents: Draggy keeps them per project, with no user-level folder to copy them into.
fn scan_markdown_folder(root: &Path, kind: &'static str, source: Source, out: &mut Vec<Item>) {
    let mut files: Vec<PathBuf> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "md") && path.is_file())
        .collect();
    files.sort();
    for file in files {
        let stem = file
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Some(id) = slugify(&stem) else { continue };
        out.push(Item {
            source,
            kind,
            id,
            name: stem,
            description: String::new(),
            clash: false,
            supported: false,
            note: Some("noCommandFolder"),
            needs_key: false,
            payload: Payload::None,
        });
    }
}

/// The server's command line made into an npm package and its arguments, when it is one.
fn npm_package(command: &str, args: &[String]) -> Option<(String, Vec<String>)> {
    let base = command
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(command)
        .to_ascii_lowercase();
    let mut rest: Vec<String> = args.to_vec();
    let mut tool = base
        .trim_end_matches(".cmd")
        .trim_end_matches(".exe")
        .to_owned();
    if tool == "cmd"
        && rest
            .first()
            .is_some_and(|arg| arg.eq_ignore_ascii_case("/c"))
    {
        rest.remove(0);
        let next = rest.first()?.to_ascii_lowercase();
        rest.remove(0);
        tool = next.trim_end_matches(".cmd").to_owned();
    }
    if tool != "npx" {
        return None;
    }
    let position = rest.iter().position(|arg| !arg.starts_with('-'))?;
    let spec = rest[position].clone();
    let name = match spec.rfind('@') {
        Some(at) if at > 0 => spec[..at].to_owned(),
        _ => spec,
    };
    valid_package(&name).then(|| (name, rest[position + 1..].to_vec()))
}

/// Arguments with credential flags and `--key=value` pairs removed. True when something was dropped.
fn clean_args(args: Vec<String>) -> (Vec<String>, bool) {
    let mut out = Vec::new();
    let mut dropped = false;
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            dropped = true;
            continue;
        }
        if arg.starts_with('-') {
            let (flag, value) = match arg.split_once('=') {
                Some((flag, value)) => (flag, Some(value)),
                None => (arg.as_str(), None),
            };
            if looks_secret(flag) {
                dropped = true;
                skip_next = value.is_none();
                continue;
            }
        }
        if value_looks_secret(&arg) {
            dropped = true;
            continue;
        }
        out.push(arg);
    }
    (out, dropped)
}

fn str_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// One MCP server as a preview row plus the entry Draggy would store. `spec` is the common shape both tools
/// are read into: command, args, env, url, headers, and the names of env variables that hold a bearer token.
fn mcp_item(
    source: Source,
    raw_name: &str,
    spec: &Value,
    taken: &Taken,
    seen: &mut HashSet<String>,
) -> Option<Item> {
    let id = slugify(raw_name)?;
    let mut needs_key = false;

    let mut env = Map::new();
    let mut declared: Vec<Value> = Vec::new();
    if let Some(vars) = spec.get("env").and_then(Value::as_object) {
        for (name, value) in vars {
            let text = value.as_str().unwrap_or_default();
            if looks_secret(name) || value_looks_secret(text) {
                needs_key = true;
                declared
                    .push(json!({ "key": name, "label": name, "required": true, "secret": true }));
            } else {
                env.insert(name.clone(), json!(text));
            }
        }
    }
    if let Some(headers) = spec.get("headers").and_then(Value::as_object) {
        needs_key |= headers.iter().any(|(name, value)| {
            looks_secret(name) || value_looks_secret(value.as_str().unwrap_or_default())
        });
    }
    if spec.get("bearerEnv").is_some_and(|value| !value.is_null()) {
        needs_key = true;
    }

    let url = spec
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let command = spec
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let mut note = None;
    let mut entry = Map::new();
    entry.insert("enabled".into(), json!(false));
    entry.insert("arguments".into(), json!({}));
    entry.insert("name".into(), json!(raw_name));

    if !url.is_empty() {
        if is_safe_remote(&url) {
            entry.insert("url".into(), json!(url));
            entry.insert("env".into(), json!({}));
        } else {
            note = Some("unsupportedServer");
        }
    } else if let Some((package, args)) = npm_package(&command, &str_list(spec.get("args"))) {
        let (args, dropped) = clean_args(args);
        needs_key |= dropped;
        entry.insert("package".into(), json!(package));
        entry.insert("args".into(), json!(args));
        entry.insert("env".into(), Value::Object(env));
        entry.insert("envDeclarations".into(), Value::Array(declared));
        entry.insert("description".into(), json!(""));
        entry.insert("docs".into(), json!(""));
        entry.insert("source".into(), json!("registry"));
    } else {
        note = Some("unsupportedServer");
    }
    if needs_key {
        entry.insert("needsKey".into(), json!(true));
    }

    let clash = taken.mcp_ids.contains(&id) || !seen.insert(format!("mcp:{id}"));
    let description = if !url.is_empty() {
        url.chars().take(120).collect()
    } else {
        command.chars().take(60).collect()
    };
    Some(Item {
        source,
        kind: "mcp",
        id,
        name: raw_name.to_owned(),
        description,
        clash,
        supported: note.is_none(),
        note: note.or(needs_key.then_some("needsKey")),
        needs_key,
        payload: Payload::Mcp(Value::Object(entry)),
    })
}

/// Claude Code's `mcpServers` object into the common shape.
fn claude_spec(raw: &Value) -> Value {
    json!({
        "command": raw.get("command"),
        "args": raw.get("args"),
        "env": raw.get("env"),
        "url": raw.get("url"),
        "headers": raw.get("headers"),
    })
}

fn scan_claude_mcp(home: &Path, taken: &Taken, seen: &mut HashSet<String>, out: &mut Vec<Item>) {
    let files = [
        home.join(".claude.json"),
        home.join(".claude").join("settings.json"),
        home.join(".claude").join("settings.local.json"),
    ];
    for file in files {
        let Some(servers) = read_json(&file)
            .and_then(|json| json.get("mcpServers").and_then(Value::as_object).cloned())
        else {
            continue;
        };
        for (name, raw) in servers {
            if let Some(item) = mcp_item(Source::Claude, &name, &claude_spec(&raw), taken, seen) {
                out.push(item);
            }
        }
    }
}

fn scan_codex_mcp(home: &Path, taken: &Taken, seen: &mut HashSet<String>, out: &mut Vec<Item>) {
    let Some(text) = read_text(&home.join(".codex").join("config.toml"), 2 * 1024 * 1024) else {
        return;
    };
    let Some(servers) = toml_lite::parse(&text)
        .get("mcp_servers")
        .and_then(Value::as_object)
        .cloned()
    else {
        return;
    };
    for (name, raw) in servers {
        let spec = json!({
            "command": raw.get("command"),
            "args": raw.get("args"),
            "env": raw.get("env"),
            "url": raw.get("url"),
            "headers": raw.get("http_headers"),
            "bearerEnv": raw.get("bearer_token_env_var").or_else(|| raw.get("env_http_headers")),
        });
        if let Some(item) = mcp_item(Source::Codex, &name, &spec, taken, seen) {
            out.push(item);
        }
    }
}

fn scan(home: &Path, taken: &Taken) -> Vec<Item> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let claude = home.join(".claude");
    let codex = home.join(".codex");
    scan_memory(&claude.join("CLAUDE.md"), Source::Claude, &mut out);
    scan_skills(
        &claude.join("skills"),
        Source::Claude,
        taken,
        &mut seen,
        &mut out,
    );
    scan_markdown_folder(
        &claude.join("commands"),
        "command",
        Source::Claude,
        &mut out,
    );
    scan_markdown_folder(&claude.join("agents"), "agent", Source::Claude, &mut out);
    scan_claude_mcp(home, taken, &mut seen, &mut out);
    scan_memory(&codex.join("AGENTS.md"), Source::Codex, &mut out);
    scan_skills(
        &codex.join("skills"),
        Source::Codex,
        taken,
        &mut seen,
        &mut out,
    );
    scan_codex_mcp(home, taken, &mut seen, &mut out);
    out
}

/// One chosen item: its key from the scan, and the id to import it under when the user renamed it.
struct Request {
    key: String,
    rename: Option<String>,
}

struct Outcome {
    key: String,
    status: &'static str,
    reason: Option<&'static str>,
    needs_key: bool,
}

#[derive(Default)]
struct Applied {
    outcomes: Vec<Outcome>,
    memory: Vec<String>,
}

fn copy_tree(
    from: &Path,
    to: &Path,
    depth: usize,
    files: &mut usize,
    bytes: &mut u64,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("too deep".to_owned());
    }
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            copy_tree(&path, &to.join(&name), depth + 1, files, bytes)?;
        } else if meta.is_file() {
            *files += 1;
            *bytes += meta.len();
            if meta.len() > MAX_FILE_BYTES || *files > MAX_FILES || *bytes > MAX_TOTAL_BYTES {
                return Err("too large".to_owned());
            }
            fs::copy(&path, to.join(&name)).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn import_skill(from: &Path, root: &Path, id: &str) -> Result<(), &'static str> {
    if !valid_slug(id) {
        return Err("badName");
    }
    let target = root.join(id);
    if target.exists() {
        return Err("exists");
    }
    let (mut files, mut bytes) = (0, 0);
    if copy_tree(from, &target, 0, &mut files, &mut bytes).is_err() {
        let _ = fs::remove_dir_all(&target);
        return Err("copyFailed");
    }
    Ok(())
}

fn apply(
    items: &[Item],
    requests: &[Request],
    skills_root: &Path,
    mcp: &mut Map<String, Value>,
) -> Applied {
    let mut done = Applied::default();
    for request in requests {
        let Some(item) = items.iter().find(|item| item.key() == request.key) else {
            done.outcomes.push(Outcome {
                key: request.key.clone(),
                status: "skipped",
                reason: Some("gone"),
                needs_key: false,
            });
            continue;
        };
        let id = request
            .rename
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| item.id.clone());
        let result: Result<(), &'static str> = if !item.supported {
            Err(item.note.unwrap_or("unsupported"))
        } else {
            match &item.payload {
                Payload::Skill(dir) => import_skill(dir, skills_root, &id),
                Payload::Memory(text) => {
                    done.memory.push(text.clone());
                    Ok(())
                }
                Payload::Mcp(entry) => {
                    if !valid_slug(&id) {
                        Err("badName")
                    } else if mcp.contains_key(&id)
                        || draggy_mcp::catalogue::find_entry(&id).is_some()
                    {
                        Err("exists")
                    } else {
                        mcp.insert(id.clone(), entry.clone());
                        Ok(())
                    }
                }
                Payload::None => Err("noCommandFolder"),
            }
        };
        done.outcomes.push(match result {
            Ok(()) => Outcome {
                key: request.key.clone(),
                status: "imported",
                reason: None,
                needs_key: item.needs_key,
            },
            Err(reason) => Outcome {
                key: request.key.clone(),
                status: "skipped",
                reason: Some(reason),
                needs_key: false,
            },
        });
    }
    done
}

fn home_dir() -> Option<PathBuf> {
    std::env::home_dir()
}

async fn taken(app: &AppHandle) -> Taken {
    let skills_root = app.state::<AppState>().storage.data_dir().join("skills");
    let mut mcp_ids: HashSet<String> = read_mcp_config(app).await.keys().cloned().collect();
    mcp_ids.extend(
        draggy_mcp::catalogue::list_catalogue()
            .into_iter()
            .map(|entry| entry.id),
    );
    Taken {
        skills_root,
        mcp_ids,
    }
}

async fn scan_command(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(home) = home_dir() else {
        return Ok(json!({ "success": true, "items": [] }));
    };
    let taken = taken(&app).await;
    blocking(move || {
        let items = scan(&home, &taken);
        json!({ "success": true, "items": items.iter().map(Item::preview).collect::<Vec<_>>() })
    })
    .await
}

fn requests_from(args: &[Value]) -> Vec<Request> {
    args.first()
        .and_then(|value| value.get("items"))
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| {
                    Some(Request {
                        key: entry.get("key")?.as_str()?.to_owned(),
                        rename: entry
                            .get("rename")
                            .and_then(Value::as_str)
                            .map(|name| name.trim().to_owned()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn apply_command(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(home) = home_dir() else {
        return Ok(json!({ "success": false, "error": "No home folder." }));
    };
    let requests = requests_from(&args);
    let taken = taken(&app).await;
    let skills_root = taken.skills_root.clone();
    let mut stored = read_mcp_config(&app).await;
    let before = stored.len();
    let (done, stored) = blocking(move || {
        let items = scan(&home, &taken);
        let done = apply(&items, &requests, &skills_root, &mut stored);
        (done, stored)
    })
    .await?;
    if stored.len() != before && !write_mcp_config(&app, &stored).await {
        return Ok(json!({ "success": false, "error": "Draggy could not save the MCP settings." }));
    }
    let results: Vec<Value> = done
        .outcomes
        .iter()
        .map(|outcome| json!({ "key": outcome.key, "status": outcome.status, "reason": outcome.reason, "needsKey": outcome.needs_key }))
        .collect();
    Ok(json!({ "success": true, "results": results, "memory": done.memory }))
}

/// A small reader for the TOML Codex writes: tables, dotted and quoted keys, strings, numbers, booleans,
/// arrays and inline tables. It exists so the import needs no new dependency.
mod toml_lite {
    use serde_json::{Map, Value};

    pub fn parse(text: &str) -> Value {
        let mut root = Map::new();
        let mut path: Vec<String> = Vec::new();
        let mut pending = String::new();
        for raw in text.lines() {
            let line = strip_comment(raw);
            if !pending.is_empty() {
                pending.push(' ');
                pending.push_str(line.trim());
                if !balanced(&pending) {
                    continue;
                }
                let joined = std::mem::take(&mut pending);
                assign(&mut root, &path, &joined);
                continue;
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(header) = line.strip_prefix('[') {
                if header.starts_with('[') {
                    path = vec!["\u{0}array".to_owned()];
                } else if let Some(inner) = header.strip_suffix(']') {
                    path = split_key(inner);
                }
                continue;
            }
            if !balanced(line) {
                pending = line.to_owned();
                continue;
            }
            assign(&mut root, &path, line);
        }
        Value::Object(root)
    }

    fn assign(root: &mut Map<String, Value>, path: &[String], line: &str) {
        if path.first().is_some_and(|first| first == "\u{0}array") {
            return;
        }
        let Some((key, value)) = line
            .split_once('=')
            .map(|(key, value)| (key.trim(), value.trim()))
        else {
            return;
        };
        let mut keys: Vec<String> = path.to_vec();
        keys.extend(split_key(key));
        let chars: Vec<char> = value.chars().collect();
        let mut at = 0;
        let parsed = value_at(&chars, &mut at);
        insert(root, &keys, parsed);
    }

    fn insert(map: &mut Map<String, Value>, keys: &[String], value: Value) {
        let Some((first, rest)) = keys.split_first() else {
            return;
        };
        if rest.is_empty() {
            map.insert(first.clone(), value);
            return;
        }
        let child = map
            .entry(first.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if !child.is_object() {
            *child = Value::Object(Map::new());
        }
        if let Some(inner) = child.as_object_mut() {
            insert(inner, rest, value);
        }
    }

    fn strip_comment(line: &str) -> &str {
        let mut quote: Option<char> = None;
        let mut escaped = false;
        for (index, ch) in line.char_indices() {
            match quote {
                Some(open) => {
                    if escaped {
                        escaped = false;
                    } else if ch == '\\' && open == '"' {
                        escaped = true;
                    } else if ch == open {
                        quote = None;
                    }
                }
                None if ch == '"' || ch == '\'' => quote = Some(ch),
                None if ch == '#' => return &line[..index],
                None => {}
            }
        }
        line
    }

    fn balanced(text: &str) -> bool {
        let (mut depth, mut quote, mut escaped) = (0i32, None::<char>, false);
        for ch in text.chars() {
            match quote {
                Some(open) => {
                    if escaped {
                        escaped = false;
                    } else if ch == '\\' && open == '"' {
                        escaped = true;
                    } else if ch == open {
                        quote = None;
                    }
                }
                None => match ch {
                    '"' | '\'' => quote = Some(ch),
                    '[' | '{' => depth += 1,
                    ']' | '}' => depth -= 1,
                    _ => {}
                },
            }
        }
        depth <= 0 && quote.is_none()
    }

    fn split_key(text: &str) -> Vec<String> {
        let mut parts = Vec::new();
        let mut current = String::new();
        let mut quote: Option<char> = None;
        for ch in text.chars() {
            match quote {
                Some(open) if ch == open => quote = None,
                Some(_) => current.push(ch),
                None if ch == '"' || ch == '\'' => quote = Some(ch),
                None if ch == '.' => parts.push(std::mem::take(&mut current).trim().to_owned()),
                None => current.push(ch),
            }
        }
        parts.push(current.trim().to_owned());
        parts
    }

    fn skip_space(chars: &[char], at: &mut usize) {
        while chars.get(*at).is_some_and(|ch| ch.is_whitespace()) {
            *at += 1;
        }
    }

    fn value_at(chars: &[char], at: &mut usize) -> Value {
        skip_space(chars, at);
        match chars.get(*at) {
            Some('"') => {
                *at += 1;
                let mut out = String::new();
                while let Some(&ch) = chars.get(*at) {
                    *at += 1;
                    match ch {
                        '"' => break,
                        '\\' => {
                            let next = chars.get(*at).copied().unwrap_or('\\');
                            *at += 1;
                            out.push(match next {
                                'n' => '\n',
                                't' => '\t',
                                'r' => '\r',
                                other => other,
                            });
                        }
                        other => out.push(other),
                    }
                }
                Value::String(out)
            }
            Some('\'') => {
                *at += 1;
                let mut out = String::new();
                while let Some(&ch) = chars.get(*at) {
                    *at += 1;
                    if ch == '\'' {
                        break;
                    }
                    out.push(ch);
                }
                Value::String(out)
            }
            Some('[') => {
                *at += 1;
                let mut items = Vec::new();
                loop {
                    skip_space(chars, at);
                    match chars.get(*at) {
                        None => break,
                        Some(']') => {
                            *at += 1;
                            break;
                        }
                        Some(',') => *at += 1,
                        Some(_) => items.push(value_at(chars, at)),
                    }
                }
                Value::Array(items)
            }
            Some('{') => {
                *at += 1;
                let mut table = Map::new();
                loop {
                    skip_space(chars, at);
                    match chars.get(*at) {
                        None => break,
                        Some('}') => {
                            *at += 1;
                            break;
                        }
                        Some(',') => *at += 1,
                        Some(_) => {
                            let start = *at;
                            let mut quote: Option<char> = None;
                            while let Some(&ch) = chars.get(*at) {
                                match quote {
                                    Some(open) if ch == open => quote = None,
                                    Some(_) => {}
                                    None if ch == '"' || ch == '\'' => quote = Some(ch),
                                    None if ch == '=' => break,
                                    None => {}
                                }
                                *at += 1;
                            }
                            let key: String = chars[start..*at].iter().collect();
                            *at += 1;
                            let value = value_at(chars, at);
                            insert(&mut table, &split_key(key.trim()), value);
                        }
                    }
                }
                Value::Object(table)
            }
            Some(_) => {
                let start = *at;
                while chars
                    .get(*at)
                    .is_some_and(|ch| !matches!(ch, ',' | ']' | '}'))
                {
                    *at += 1;
                }
                let word: String = chars[start..*at].iter().collect();
                let word = word.trim();
                match word {
                    "true" => Value::Bool(true),
                    "false" => Value::Bool(false),
                    other => other
                        .parse::<i64>()
                        .map(Value::from)
                        .or_else(|_| other.parse::<f64>().map(Value::from))
                        .unwrap_or_else(|_| Value::String(other.to_owned())),
                }
            }
            None => Value::Null,
        }
    }
}

#[cfg(test)]
#[path = "import_tests.rs"]
mod tests;
