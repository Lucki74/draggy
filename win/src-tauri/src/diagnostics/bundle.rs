//! The diagnostics zip a person sends with a bug report.
//! Text goes through the secret and path scrubbers. Chats and keys never reach it: the settings are an allowlist.

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use draggy_diagnostics::{Diagnostics, ErrorInfo, Level, TimeOptions, scrub_paths, scrub_secrets};
use serde_json::{Map, Value, json};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const EVENTS_LIMIT_BYTES: usize = 20 * 1024 * 1024;
const ROTATIONS: u32 = 3;
const DUMP_LIMIT: usize = 3;
const SCOPE: &str = "diagnostics.bundle";

/// Settings that say nothing about the person. Anything not listed stays out until someone decides it is harmless.
const SETTINGS_ALLOWLIST: &[&str] = &[
    "theme",
    "accent",
    "fontSize",
    "language",
    "modelName",
    "effort",
    "allowMaxInChat",
    "slowModelThinking",
    "colibriLossy",
    "webMode",
    "browserActions",
    "voiceEngine",
    "voiceRate",
    "voiceSounds",
    "interfaceSounds",
    "searchProvider",
    "codeModel",
    "codeEffort",
    "codeWebMode",
    "codePermissionMode",
    "libraryEnabled",
    "embedModel",
    "showMetrics",
    "compactLimit",
    "fixedContextSize",
    "imageModel",
];

/// What the caller gathers from the process before a build. Nothing here is read from a chat or a key store.
pub struct Sources {
    pub log_dir: PathBuf,
    pub crash_dumps: Vec<PathBuf>,
    pub home_dir: String,
    pub user_name: String,
    pub app_version: String,
    pub created_at: String,
    /// Extra fields for system.json, after createdAt and appVersion.
    pub system: Map<String, Value>,
    pub settings: Value,
    pub providers: Vec<Value>,
    pub mcp_servers: Vec<Value>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Choices {
    pub include_debug: bool,
    pub include_dumps: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Saved {
    pub bytes: usize,
    pub files: usize,
}

/// Collects the entries without writing anything. The preview lists them and `save` zips them.
pub fn build(sources: &Sources, choices: Choices, diag: Option<&Diagnostics>) -> Vec<Entry> {
    let mut entries = Vec::new();
    let home = sources.home_dir.as_str();
    let user = sources.user_name.as_str();
    let mut text = |name: &str, body: &str| {
        let scrubbed = scrub_paths(&scrub_secrets(body), Some(home), Some(user));
        entries.push(Entry {
            name: name.to_owned(),
            data: scrubbed.into_bytes(),
        });
    };

    for (file, label) in rotations_of(&sources.log_dir, "app.log") {
        if let Some(raw) = read_text(&file, diag) {
            let body = if choices.include_debug {
                raw
            } else {
                without_debug_text(&raw)
            };
            text(&label, &body);
        }
    }
    if choices.include_debug {
        for (file, label) in rotations_of(&sources.log_dir, "debug.log") {
            if let Some(raw) = read_text(&file, diag) {
                text(&label, &raw);
            }
        }
    }
    let events: String = rotations_of(&sources.log_dir, "events.jsonl")
        .iter()
        .filter_map(|(file, _)| read_text(file, diag))
        .collect();
    if !events.is_empty() {
        let kept = if choices.include_debug {
            events
        } else {
            without_debug_jsonl(&events, diag)
        };
        text("events.jsonl", &tail_lines(kept, EVENTS_LIMIT_BYTES));
    }

    let (kept, removed) = pick_settings(&sources.settings);
    let mut system = Map::new();
    system.insert("createdAt".to_owned(), json!(sources.created_at));
    system.insert("appVersion".to_owned(), json!(sources.app_version));
    system.extend(sources.system.clone());
    text("system.json", &json_text(&Value::Object(system)));
    text("settings.json", &json_text(&Value::Object(kept)));
    text(
        "providers.json",
        &json_text(&json!({"providers": sources.providers, "mcpServers": sources.mcp_servers})),
    );

    let mut dumps = Vec::new();
    if choices.include_dumps {
        for file in sources.crash_dumps.iter().take(DUMP_LIMIT) {
            if let Ok(raw) = std::fs::read(file) {
                let name = file
                    .file_name()
                    .map(|base| base.to_string_lossy().into_owned())
                    .unwrap_or_default();
                dumps.push(Entry {
                    name: format!("crashes/{name}"),
                    data: raw,
                });
            }
        }
    }
    entries.extend(dumps);
    if let Some(diag) = diag {
        diag.debug(
            SCOPE,
            "bundle collected",
            Some(json!({
                "files": entries.len(),
                "removedSettings": removed.len(),
                "includeDebug": choices.include_debug,
                "includeDumps": choices.include_dumps,
            })),
        );
    }

    let names: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
    let body = readme(sources, choices, &names, removed.len());
    entries.insert(
        0,
        Entry {
            name: "README.txt".to_owned(),
            data: body.into_bytes(),
        },
    );
    entries
}

/// The name and size of each file the zip will hold, in zip order.
pub fn preview(sources: &Sources, choices: Choices, diag: Option<&Diagnostics>) -> Value {
    let entries = build(sources, choices, diag);
    Value::Array(
        entries
            .iter()
            .map(|entry| json!({"name": entry.name, "size": entry.data.len()}))
            .collect(),
    )
}

/// Writes the zip to the path the person picked.
pub fn save(
    sources: &Sources,
    choices: Choices,
    target: &Path,
    diag: Option<&Diagnostics>,
) -> Result<Saved, String> {
    let mut timer = diag.map(|d| {
        d.time(
            SCOPE,
            "bundle saved",
            None,
            TimeOptions {
                warn_ms: None,
                level: Level::Info,
            },
        )
    });
    let entries = build(sources, choices, diag);
    let written = zip_entries(&entries)
        .map_err(|error| error.to_string())
        .and_then(|zip| {
            std::fs::write(target, &zip)
                .map(|()| zip.len())
                .map_err(|error| error.to_string())
        });
    let target_name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match written {
        Ok(bytes) => {
            if let Some(timer) = timer.as_mut() {
                timer.end(Some(json!({
                    "bytes": bytes,
                    "files": entries.len(),
                    "includeDebug": choices.include_debug,
                    "includeDumps": choices.include_dumps,
                })));
            }
            Ok(Saved {
                bytes,
                files: entries.len(),
            })
        }
        Err(error) => {
            if let Some(timer) = timer.as_mut() {
                timer.fail(
                    &ErrorInfo::new("Error", error.clone()),
                    Some(json!({ "target": target_name })),
                );
            }
            Err(error)
        }
    }
}

/// `draggy-diagnostics-YYYY-MM-DD.zip`, from the bundle's creation stamp.
pub fn default_name(created_at: &str) -> String {
    let date = created_at.get(..10).unwrap_or("unknown");
    format!("draggy-diagnostics-{date}.zip")
}

fn zip_entries(entries: &[Entry]) -> zip::result::ZipResult<Vec<u8>> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for entry in entries {
        writer.start_file(entry.name.as_str(), options)?;
        writer.write_all(&entry.data)?;
    }
    Ok(writer.finish()?.into_inner())
}

/// A bundle input that cannot be read is left out. A missing file is normal; anything else gets a WARN line.
fn read_text(file: &Path, diag: Option<&Diagnostics>) -> Option<String> {
    match std::fs::read(file) {
        Ok(raw) => Some(String::from_utf8_lossy(&raw).into_owned()),
        Err(error) => {
            if let Some(diag) = diag {
                if error.kind() == std::io::ErrorKind::NotFound {
                    diag.swallow(SCOPE, None, "file not present");
                } else {
                    let name = file
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    diag.warn(
                        SCOPE,
                        "could not read a bundle input",
                        Some(json!({ "code": format!("{:?}", error.kind()), "name": name })),
                    );
                }
            }
            None
        }
    }
}

/// The rotations of one log, oldest first: `name.3`, `name.2`, `name.1`, `name`. Only the ones that exist.
fn rotations_of(dir: &Path, name: &str) -> Vec<(PathBuf, String)> {
    let mut files: Vec<(PathBuf, String)> = (1..=ROTATIONS)
        .rev()
        .map(|index| {
            (
                dir.join(format!("{name}.{index}")),
                format!("{name}.{index}"),
            )
        })
        .collect();
    files.push((dir.join(name), name.to_owned()));
    files.retain(|(file, _)| file.exists());
    files
}

/// The last `limit` bytes, starting after a line break when there is one.
fn tail_lines(text: String, limit: usize) -> String {
    if text.len() <= limit {
        return text;
    }
    let cut = String::from_utf8_lossy(&text.as_bytes()[text.len() - limit..]).into_owned();
    match cut.find('\n') {
        Some(newline) => cut[newline + 1..].to_owned(),
        None => cut,
    }
}

/// Matches `^\S+ DEBUG ` in the text log: the first whitespace must be the space before DEBUG.
fn is_debug_line(line: &str) -> bool {
    match line.find(char::is_whitespace) {
        Some(index) if index > 0 => line[index..].starts_with(" DEBUG "),
        _ => false,
    }
}

fn without_debug_text(text: &str) -> String {
    text.split('\n')
        .filter(|line| line.is_empty() || !is_debug_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A line that is not JSON stays in.
fn without_debug_jsonl(text: &str, diag: Option<&Diagnostics>) -> String {
    text.split('\n')
        .filter(|line| {
            if line.is_empty() {
                return true;
            }
            match serde_json::from_str::<Value>(line) {
                Ok(value) => value.get("level").and_then(Value::as_str) != Some("DEBUG"),
                Err(_) => {
                    if let Some(diag) = diag {
                        diag.swallow(SCOPE, None, "event line is not JSON, kept as is");
                    }
                    true
                }
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The kept settings in their original order, and the keys dropped.
fn pick_settings(settings: &Value) -> (Map<String, Value>, Vec<String>) {
    let mut kept = Map::new();
    let mut removed = Vec::new();
    if let Value::Object(map) = settings {
        for (key, value) in map {
            if SETTINGS_ALLOWLIST.contains(&key.as_str()) {
                kept.insert(key.clone(), value.clone());
            } else {
                removed.push(key.clone());
            }
        }
    }
    (kept, removed)
}

/// JSON with two-space indent and a final newline, as JSON.stringify(value, null, 2) writes it.
fn json_text(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".to_owned());
    text.push('\n');
    text
}

fn readme(sources: &Sources, choices: Choices, files: &[String], removed: usize) -> String {
    let dropped = if removed > 0 {
        format!(" ({removed} dropped)")
    } else {
        String::new()
    };
    let mut lines: Vec<String> = vec![
        "Draggy diagnostics".to_owned(),
        format!(
            "Created {} by Draggy {}.",
            sources.created_at, sources.app_version
        ),
        String::new(),
        "What is inside".to_owned(),
    ];
    lines.extend(files.iter().map(|file| format!("  {file}")));
    lines.extend([
        String::new(),
        "What was removed".to_owned(),
        "  Your home folder is written as ~ and your user name as <user> in every text file."
            .to_owned(),
        "  API keys, tokens and OAuth codes are replaced with [secret:...] markers. They are never logged.".to_owned(),
        "  Chats, prompts, replies and file contents are not here: Draggy hashes them before they reach a log.".to_owned(),
        format!("  Settings: only a short list of harmless fields is kept{dropped}."),
        "  Providers and MCP servers are listed by type and status only, with no address or key.".to_owned(),
        if choices.include_debug {
            String::new()
        } else {
            "  Debug-level lines were left out.".to_owned()
        },
        if choices.include_dumps {
            "  Crash dumps are binary, so their paths could not be scrubbed.".to_owned()
        } else {
            "  Crash dumps were left out.".to_owned()
        },
    ]);
    // A blank line stays only when the line before it is not blank.
    let kept: Vec<String> = lines
        .iter()
        .enumerate()
        .filter(|(index, line)| !line.is_empty() || *index == 0 || !lines[index - 1].is_empty())
        .map(|(_, line)| line.clone())
        .collect();
    format!("{}\n", kept.join("\n"))
}

/// ISO-8601 UTC with milliseconds, as `Date.toISOString` writes it.
pub fn iso_from_unix_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let seconds = rest / 1000;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds / 3600,
        seconds % 3600 / 60,
        seconds % 60,
        rest % 1000
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    const HOME: &str = "C:\\Users\\zoltan";
    // Built from pieces so no secret-shaped literal sits in the repository.
    fn secret() -> String {
        format!("sk-{}", "0123456789abcdef0123456789abcdef")
    }

    fn sources(dir: &Path) -> Sources {
        Sources {
            log_dir: dir.to_path_buf(),
            crash_dumps: Vec::new(),
            home_dir: HOME.to_owned(),
            user_name: "zoltan".to_owned(),
            app_version: "1.2.3".to_owned(),
            created_at: "2026-11-11T10:00:00.000Z".to_owned(),
            system: Map::from_iter([("platform".to_owned(), json!("win32"))]),
            settings: json!({
                "language": "fr",
                "theme": "dark",
                "customInstructions": ["my landlord owes me two thousand euros"],
                "searxngUrl": format!("https://me:{}@host.test", secret()),
                "braveKey": secret(),
            }),
            providers: vec![json!({"type": "openai", "kind": "cloud", "hasKey": true})],
            mcp_servers: vec![json!({"id": "files", "status": "running", "tools": 3})],
        }
    }

    /// A log folder like the writer leaves: one INFO line, one DEBUG line, with a home path and a key in them.
    fn seed_logs(dir: &Path) {
        let app = format!(
            "2026-11-11T10:00:00.000Z INFO files opened {HOME}\\Documents\\notes.txt as zoltan\n\
             2026-11-11T10:00:01.000Z INFO providers request failed key={}\n\
             2026-11-11T10:00:02.000Z DEBUG engine a debug line only the verbose bundle keeps\n",
            secret()
        );
        std::fs::write(dir.join("app.log"), app).expect("app.log");
        let events = format!(
            "{}\n{}\n",
            json!({"ts": "t", "level": "INFO", "msg": "turn", "data": {}}),
            json!({"ts": "t", "level": "DEBUG", "msg": "only the verbose bundle keeps"})
        );
        std::fs::write(dir.join("events.jsonl"), events).expect("events.jsonl");
        std::fs::write(
            dir.join("debug.log"),
            "2026-11-11T10:00:02.000Z DEBUG engine full debug text\n",
        )
        .expect("debug.log");
    }

    fn unzip(zip_bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes.to_vec())).expect("valid zip");
        (0..archive.len())
            .map(|index| {
                let mut file = archive.by_index(index).expect("entry");
                let mut data = Vec::new();
                file.read_to_end(&mut data).expect("read entry");
                (file.name().expect("entry name").into_owned(), data)
            })
            .collect()
    }

    fn named(entries: &[(String, Vec<u8>)], name: &str) -> String {
        let data = entries
            .iter()
            .find(|(entry, _)| entry == name)
            .map(|(_, data)| data.clone())
            .unwrap_or_default();
        String::from_utf8(data).expect("utf8")
    }

    #[test]
    fn holds_no_home_path_user_name_or_secret() {
        let dir = tempfile::tempdir().expect("temp dir");
        seed_logs(dir.path());
        let target = dir.path().join("out.zip");
        save_for_test(&sources(dir.path()), Choices::default(), &target);
        let entries = unzip(&std::fs::read(&target).expect("zip"));
        let all: String = entries
            .iter()
            .map(|(_, data)| String::from_utf8_lossy(data).into_owned())
            .collect();
        for name in [
            "README.txt",
            "app.log",
            "events.jsonl",
            "system.json",
            "settings.json",
            "providers.json",
        ] {
            assert!(entries.iter().any(|(entry, _)| entry == name), "{name}");
        }
        assert!(!all.contains("zoltan"));
        assert!(!all.contains(HOME));
        assert!(!all.contains(&secret()));
        assert!(all.contains('~'));
        assert!(all.contains("<user>"));
    }

    fn save_for_test(sources: &Sources, choices: Choices, target: &Path) {
        save(sources, choices, target, None).expect("saved");
    }

    #[test]
    fn keeps_only_the_harmless_settings() {
        let dir = tempfile::tempdir().expect("temp dir");
        seed_logs(dir.path());
        let entries = build(&sources(dir.path()), Choices::default(), None);
        let names: Vec<(String, Vec<u8>)> = entries.into_iter().map(|e| (e.name, e.data)).collect();
        let settings: Value = serde_json::from_str(&named(&names, "settings.json")).expect("json");
        assert_eq!(settings, json!({"language": "fr", "theme": "dark"}));
        assert!(named(&names, "README.txt").contains("harmless fields"));
        assert!(named(&names, "README.txt").contains("(3 dropped)"));
    }

    #[test]
    fn leaves_debug_lines_out_unless_asked() {
        let dir = tempfile::tempdir().expect("temp dir");
        seed_logs(dir.path());
        let quiet = build(&sources(dir.path()), Choices::default(), None);
        let quiet: Vec<(String, Vec<u8>)> = quiet.into_iter().map(|e| (e.name, e.data)).collect();
        assert!(!named(&quiet, "events.jsonl").contains("only the verbose bundle keeps"));
        assert!(!named(&quiet, "app.log").contains("a debug line only"));
        assert!(!quiet.iter().any(|(name, _)| name == "debug.log"));

        let verbose = build(
            &sources(dir.path()),
            Choices {
                include_debug: true,
                include_dumps: false,
            },
            None,
        );
        let verbose: Vec<(String, Vec<u8>)> =
            verbose.into_iter().map(|e| (e.name, e.data)).collect();
        assert!(named(&verbose, "events.jsonl").contains("only the verbose bundle keeps"));
        assert!(named(&verbose, "debug.log").contains("full debug text"));
    }

    #[test]
    fn lists_crash_dumps_only_when_asked_and_three_at_most() {
        let dir = tempfile::tempdir().expect("temp dir");
        seed_logs(dir.path());
        let dumps: Vec<PathBuf> = ["a", "b", "c", "d"]
            .iter()
            .map(|name| {
                let file = dir.path().join(format!("{name}.dmp"));
                std::fs::write(&file, name).expect("dump");
                file
            })
            .collect();
        let mut src = sources(dir.path());
        src.crash_dumps = dumps;
        let names = |choices| -> Vec<String> {
            build(&src, choices, None)
                .into_iter()
                .map(|e| e.name)
                .collect()
        };
        assert!(
            !names(Choices::default())
                .iter()
                .any(|n| n.starts_with("crashes/"))
        );
        let with = names(Choices {
            include_debug: false,
            include_dumps: true,
        });
        assert_eq!(with.iter().filter(|n| n.starts_with("crashes/")).count(), 3);
    }

    #[test]
    fn previews_the_files_it_saves_with_their_sizes() {
        let dir = tempfile::tempdir().expect("temp dir");
        seed_logs(dir.path());
        let src = sources(dir.path());
        let preview = preview(&src, Choices::default(), None);
        let target = dir.path().join("again.zip");
        save(&src, Choices::default(), &target, None).expect("saved");
        let saved = unzip(&std::fs::read(&target).expect("zip"));
        let preview = preview.as_array().expect("array");
        assert_eq!(preview.len(), saved.len());
        for file in preview {
            let name = file["name"].as_str().expect("name");
            let size = file["size"].as_u64().expect("size") as usize;
            let data = saved
                .iter()
                .find(|(entry, _)| entry == name)
                .expect("entry");
            assert_eq!(data.1.len(), size, "{name}");
        }
    }

    #[test]
    fn caps_events_at_twenty_megabytes_from_the_newest_end() {
        let dir = tempfile::tempdir().expect("temp dir");
        let line = format!("{}\n", json!({"level": "INFO", "msg": "x".repeat(1000)}));
        std::fs::write(dir.path().join("events.jsonl.1"), line.repeat(12_000)).expect("rotation");
        std::fs::write(dir.path().join("events.jsonl"), line.repeat(12_000)).expect("events");
        let entries = build(&sources(dir.path()), Choices::default(), None);
        let events = entries
            .iter()
            .find(|e| e.name == "events.jsonl")
            .expect("events");
        assert!(events.data.len() <= 20 * 1024 * 1024);
        assert!(events.data.len() > 15 * 1024 * 1024);
    }

    #[test]
    fn default_name_uses_the_creation_date() {
        assert_eq!(
            default_name("2026-11-11T10:00:00.000Z"),
            "draggy-diagnostics-2026-11-11.zip"
        );
    }

    #[test]
    fn iso_stamp_matches_date_to_iso_string() {
        assert_eq!(iso_from_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso_from_unix_ms(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
        assert_eq!(
            iso_from_unix_ms(951_782_400_000),
            "2000-02-29T00:00:00.000Z"
        );
    }

    #[test]
    fn debug_lines_are_found_by_their_level_word() {
        assert!(is_debug_line("2026 DEBUG engine x"));
        assert!(!is_debug_line("2026 INFO engine DEBUG in the message"));
        assert!(!is_debug_line(" DEBUG leading space"));
    }

    #[test]
    fn tail_starts_after_a_line_break() {
        assert_eq!(tail_lines("abc\ndef\nghi".to_owned(), 7), "ghi");
        assert_eq!(tail_lines("short".to_owned(), 100), "short");
        assert_eq!(tail_lines("nobreakhere".to_owned(), 4), "here");
    }

    #[test]
    fn rotations_run_oldest_first_and_skip_missing_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("app.log.2"), "").expect("two");
        std::fs::write(dir.path().join("app.log"), "").expect("base");
        let labels: Vec<String> = rotations_of(dir.path(), "app.log")
            .into_iter()
            .map(|(_, label)| label)
            .collect();
        assert_eq!(labels, ["app.log.2", "app.log"]);
    }
}
