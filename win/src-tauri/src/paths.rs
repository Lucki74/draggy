//! Where Draggy keeps its data. Electron-era installs named the folder after the app, so Tauri's identifier-derived
//! folder would look like a lost install. Also carries the legacy `localai` folder over from Electron-era installs.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

/// The folder name Electron-era installs used under `%APPDATA%`.
const APP_FOLDER: &str = "Draggy";

/// Names the app answered to before, tried in order. Both spellings because only case-sensitive
/// platforms tell them apart.
const LEGACY_APP_NAMES: [&str; 2] = ["localai", "LocalAI"];

/// The file proving the app stored something. Emptiness is no test: Electron writes its own profile
/// scaffolding into the folder as it starts.
const MARKER: &str = "draggy.db";

/// The marker under the previous name. It must arrive renamed, or it sits beside a fresh empty database.
const LEGACY_MARKER: &str = "localai.db";

/// `%APPDATA%\Draggy`. A missing `APPDATA` is an error: guessing another folder would start a fresh,
/// empty profile beside the real one.
pub fn data_dir(appdata: Option<OsString>) -> Result<PathBuf, String> {
    let base = appdata
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "APPDATA is not set".to_owned())?;
    Ok(PathBuf::from(base).join(APP_FOLDER))
}

/// What the carry-over would do. `Adopt` moves the old folder in, `KeepNew` leaves both alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    None,
    KeepNew,
    Adopt,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub moved: usize,
    pub plan: Plan,
    pub message: Option<String>,
}

/// Only the database is renamed; its `-wal` and `-shm` travel with it, since SQLite finds them by the
/// main file's name. Every other entry keeps its name.
pub fn arrival_name(entry: &str) -> String {
    if entry == LEGACY_MARKER {
        return MARKER.to_owned();
    }
    if let Some(suffix) = entry.strip_prefix(&format!("{LEGACY_MARKER}-")) {
        return format!("{MARKER}-{suffix}");
    }
    entry.to_owned()
}

/// Decides without touching anything. Either name proves the old folder was used; on the new side
/// only the current name counts.
pub fn plan_adoption(from: &Path, to: &Path) -> Plan {
    if from == to || !from.exists() {
        return Plan::None;
    }
    let holds_data = [MARKER, LEGACY_MARKER]
        .iter()
        .any(|name| from.join(name).exists());
    if !holds_data {
        return Plan::None;
    }
    if to.join(MARKER).exists() {
        return Plan::KeepNew;
    }
    Plan::Adopt
}

/// Carries the folder over entry by entry, never overwriting. Never fails: a partial move is reported
/// in the message, not raised, because failing to move old data is no reason to refuse to start.
pub fn adopt_folder(from: &Path, to: &Path) -> Outcome {
    let plan = plan_adoption(from, to);
    if plan != Plan::Adopt {
        return Outcome {
            moved: 0,
            plan,
            message: None,
        };
    }

    let mut moved = 0usize;
    let mut skipped = 0usize;
    let result = carry(from, to, &mut moved, &mut skipped);
    if let Err(error) = result {
        return Outcome {
            moved,
            plan,
            message: Some(format!(
                "only partly carried the data folder over from {}: {error}",
                from.display()
            )),
        };
    }

    // An empty old folder is tidied away; one still holding something is left for the person to see.
    if fs::read_dir(from)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
    {
        let _ = fs::remove_dir(from);
    }

    let mut message = format!("carried {moved} item(s) over from {}", from.display());
    if skipped > 0 {
        message.push_str(&format!(", leaving {skipped} that already existed"));
    }
    Outcome {
        moved,
        plan,
        message: Some(message),
    }
}

fn carry(from: &Path, to: &Path, moved: &mut usize, skipped: &mut usize) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let target = to.join(arrival_name(&name.to_string_lossy()));
        if target.exists() {
            *skipped += 1;
            continue;
        }
        fs::rename(entry.path(), target)?;
        *moved += 1;
    }
    Ok(())
}

/// Runs once at startup, before the log or database create anything in the new folder. `parent` is
/// `%APPDATA%`, `to` is the data folder. Returns the notes to log once the logger is open.
pub fn adopt_legacy_data_folder(parent: &Path, to: &Path) -> Vec<String> {
    let mut notes = Vec::new();
    for name in LEGACY_APP_NAMES {
        let from = parent.join(name);
        if from == to {
            continue;
        }
        let outcome = adopt_folder(&from, to);
        notes.extend(outcome.message);
        if outcome.plan == Plan::Adopt {
            break;
        }
    }
    notes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_the_app_folder_under_appdata() {
        let dir = data_dir(Some(OsString::from(r"C:\Users\x\AppData\Roaming"))).unwrap();
        assert_eq!(
            dir,
            PathBuf::from(r"C:\Users\x\AppData\Roaming").join("Draggy")
        );
    }

    #[test]
    fn refuses_to_guess_without_appdata() {
        assert!(data_dir(None).is_err());
        assert!(data_dir(Some(OsString::new())).is_err());
    }

    #[test]
    fn renames_the_database_and_its_journal_files_only() {
        assert_eq!(arrival_name("localai.db"), "draggy.db");
        assert_eq!(arrival_name("localai.db-wal"), "draggy.db-wal");
        assert_eq!(arrival_name("localai.db-shm"), "draggy.db-shm");
        assert_eq!(arrival_name("localai.db.bak"), "localai.db.bak");
        assert_eq!(arrival_name("chats"), "chats");
    }

    /// Makes `parent/<name>` with the given entries, returning the folder.
    fn old_folder(parent: &Path, name: &str, entries: &[&str]) -> PathBuf {
        let dir = parent.join(name);
        fs::create_dir_all(&dir).unwrap();
        for entry in entries {
            fs::write(dir.join(entry), b"data").unwrap();
        }
        dir
    }

    #[test]
    fn adopts_an_old_folder_with_a_legacy_database() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db"]);
        let to = tmp.path().join("Draggy");
        assert_eq!(plan_adoption(&from, &to), Plan::Adopt);
        let outcome = adopt_folder(&from, &to);
        assert_eq!(outcome.plan, Plan::Adopt);
        assert!(to.join("draggy.db").exists());
        assert!(!to.join("localai.db").exists());
    }

    #[test]
    fn does_nothing_when_there_is_no_old_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let to = tmp.path().join("Draggy");
        let outcome = adopt_folder(&tmp.path().join("localai"), &to);
        assert_eq!(
            outcome,
            Outcome {
                moved: 0,
                plan: Plan::None,
                message: None
            }
        );
        assert!(!to.exists());
    }

    #[test]
    fn does_nothing_when_the_name_is_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = old_folder(tmp.path(), "Draggy", &["draggy.db"]);
        assert_eq!(plan_adoption(&dir, &dir), Plan::None);
    }

    #[test]
    fn ignores_an_old_folder_with_no_marker() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["notes.txt"]);
        let to = tmp.path().join("Draggy");
        assert_eq!(plan_adoption(&from, &to), Plan::None);
        assert!(from.join("notes.txt").exists());
    }

    #[test]
    fn adopts_over_a_scaffolding_only_new_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db"]);
        let to = old_folder(tmp.path(), "Draggy", &["Cache"]);
        assert_eq!(plan_adoption(&from, &to), Plan::Adopt);
    }

    #[test]
    fn never_overwrites_real_new_data() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db"]);
        let to = old_folder(tmp.path(), "Draggy", &["draggy.db"]);
        assert_eq!(plan_adoption(&from, &to), Plan::KeepNew);
        let outcome = adopt_folder(&from, &to);
        assert_eq!(outcome.moved, 0);
        assert!(from.join("localai.db").exists());
        assert_eq!(fs::read(to.join("draggy.db")).unwrap(), b"data");
    }

    #[test]
    fn moves_everything_and_removes_the_empty_old_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(
            tmp.path(),
            "localai",
            &["localai.db", "localai.db-wal", "chats"],
        );
        let to = tmp.path().join("Draggy");
        let outcome = adopt_folder(&from, &to);
        assert_eq!(outcome.moved, 3);
        assert!(to.join("draggy.db-wal").exists());
        assert!(to.join("chats").exists());
        assert!(!from.exists());
    }

    #[test]
    fn keeps_the_old_folder_when_an_entry_already_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db", "chats"]);
        let to = old_folder(tmp.path(), "Draggy", &["chats"]);
        // A marker-less new folder still adopts, and the clashing entry is left behind.
        let outcome = adopt_folder(&from, &to);
        assert_eq!(outcome.moved, 1);
        assert!(from.join("chats").exists());
        assert!(from.exists());
        assert!(
            outcome
                .message
                .unwrap()
                .contains("leaving 1 that already existed")
        );
    }

    #[test]
    fn reports_a_partial_failure_without_panicking() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db"]);
        // A file where the data folder should be makes the carry fail.
        let to = tmp.path().join("Draggy");
        fs::write(&to, b"not a folder").unwrap();
        let outcome = adopt_folder(&from, &to);
        assert_eq!(outcome.moved, 0);
        assert!(outcome.message.unwrap().starts_with("only partly carried"));
    }

    #[test]
    fn says_what_it_did() {
        let tmp = tempfile::tempdir().unwrap();
        let from = old_folder(tmp.path(), "localai", &["localai.db"]);
        let to = tmp.path().join("Draggy");
        let message = adopt_folder(&from, &to).message.unwrap();
        assert!(message.starts_with("carried 1 item(s) over from "));
    }

    #[test]
    fn the_first_legacy_name_that_adopts_ends_the_search() {
        let tmp = tempfile::tempdir().unwrap();
        old_folder(tmp.path(), "localai", &["localai.db"]);
        let to = tmp.path().join("Draggy");
        let notes = adopt_legacy_data_folder(tmp.path(), &to);
        assert_eq!(notes.len(), 1);
        assert!(to.join("draggy.db").exists());
    }
}
