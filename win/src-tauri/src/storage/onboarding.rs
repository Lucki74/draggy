//! First-run setup state: the boot decision and the four setup handlers.
//! Nothing here starts a download; it only reads and writes the setup record.

use std::path::Path;

use draggy_diagnostics::Diagnostics;
use draggy_storage::Storage;
use draggy_storage::onboarding::{
    self as core, Plan, RECORD_KEY, Reading, Readings, Record, SETTINGS_KEY,
};
use serde_json::{Value, json};

/// Weights beside the model, and draft models, are not a model of the user's own.
fn counts_as_model(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".gguf") && !lower.contains("mmproj") && !lower.ends_with("-draft.gguf")
}

fn model_count(data_dir: &Path) -> Reading<Option<f64>> {
    match std::fs::read_dir(data_dir.join("models")) {
        Ok(entries) => Reading::Read(Some(
            entries
                .flatten()
                .filter(|entry| counts_as_model(&entry.file_name().to_string_lossy()))
                .count() as f64,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Reading::Read(Some(0.0)),
        Err(_) => Reading::Failed,
    }
}

fn reading<T>(result: Result<T, draggy_storage::StorageError>) -> Reading<T> {
    result.map_or(Reading::Failed, Reading::Read)
}

fn write(storage: &Storage, record: &Record) -> Result<(), String> {
    let text = serde_json::to_string(record).map_err(|error| error.to_string())?;
    storage
        .set_value(RECORD_KEY, &text)
        .map_err(|error| error.to_string())
}

fn stored(storage: &Storage) -> Option<Record> {
    core::read_record(storage.get_value(RECORD_KEY).ok().flatten().as_deref())
}

/// Decides at boot whether setup shows. An install with prior use is recorded as done.
pub fn decide(storage: &Storage, data_dir: &Path, diag: &Diagnostics) -> bool {
    let input = core::collect_inputs(Readings {
        raw: reading(storage.get_value(RECORD_KEY)),
        settings: reading(storage.get_value(SETTINGS_KEY)),
        model_count: model_count(data_dir),
        chat_count: reading(storage.stats().map(|stats| Some(stats.chats as f64))),
        forced: std::env::var("DRAGGY_ONBOARDING").is_ok_and(|value| value == "1"),
    });
    let mut plan = core::plan_onboarding(&input);
    if plan == Plan::Adopt {
        let adopted = core::done_record("adopted", &core::now_iso(), None)
            .map_err(|error| error.to_string())
            .and_then(|record| write(storage, &record));
        match adopted {
            Ok(()) => diag.info(
                "onboarding",
                "existing install, setup recorded as done",
                None,
            ),
            Err(error) => diag.warn(
                "onboarding",
                &format!("could not record the adopted install: {error}"),
                None,
            ),
        }
        plan = Plan::Done;
    }
    diag.info(
        "onboarding",
        &format!("plan: {}", if plan == Plan::Show { "show" } else { "done" }),
        None,
    );
    plan == Plan::Show
}

fn record_json(record: Option<&Record>) -> Value {
    record
        .and_then(|record| serde_json::to_value(record).ok())
        .unwrap_or(Value::Null)
}

/// `onboarding:state`.
pub fn state(storage: Option<&Storage>, show: bool) -> Value {
    let record = storage.and_then(stored);
    json!({ "plan": if show { "show" } else { "done" }, "record": record_json(record.as_ref()) })
}

/// `onboarding:start`: keeps an earlier start date, else records a new start.
pub fn start(storage: &Storage) -> Result<Value, String> {
    let existing = stored(storage);
    let next = core::record_on_start(existing.as_ref(), &core::now_iso());
    if let Some(record) = &next {
        write(storage, record)?;
    }
    Ok(json!({ "success": true, "record": record_json(next.as_ref().or(existing.as_ref())) }))
}

/// `onboarding:complete`: the record for the path the user took, or a refusal for an unknown one.
pub fn complete(storage: &Storage, path: &str) -> Result<Value, String> {
    if path == "adopted" || !core::is_valid_path(path) {
        return Ok(json!({ "success": false, "error": "Unknown setup path." }));
    }
    let existing = stored(storage);
    let started = existing
        .as_ref()
        .and_then(|record| record.fields.get("startedAt"))
        .and_then(Value::as_str);
    let record =
        core::done_record(path, &core::now_iso(), started).map_err(|error| error.to_string())?;
    write(storage, &record)?;
    Ok(json!({ "success": true, "record": record_json(Some(&record)) }))
}

/// `onboarding:reset`: marks setup as in progress again.
pub fn reset(storage: &Storage, diag: &Diagnostics) -> Result<(), String> {
    write(storage, &core::in_progress_record(&core::now_iso()))?;
    diag.info("onboarding", "setup requested again", None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_diag;

    fn open() -> (tempfile::TempDir, Storage, Diagnostics) {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = Storage::open(dir.path()).expect("open");
        let diag = test_diag(dir.path());
        (dir, storage, diag)
    }

    #[test]
    fn a_fresh_install_shows_setup_and_writes_nothing() {
        let (dir, storage, diag) = open();
        assert!(decide(&storage, dir.path(), &diag));
        assert_eq!(storage.get_value(RECORD_KEY).expect("get"), None);
    }

    #[test]
    fn an_install_with_settings_is_adopted_and_recorded() {
        let (dir, storage, diag) = open();
        storage.set_value(SETTINGS_KEY, "{}").expect("set");
        assert!(!decide(&storage, dir.path(), &diag));
        let record = stored(&storage).expect("record");
        assert_eq!(record.fields.get("path"), Some(&json!("adopted")));
    }

    #[test]
    fn a_model_file_counts_but_mmproj_and_draft_files_do_not() {
        assert!(counts_as_model("Qwen.GGUF"));
        assert!(!counts_as_model("mmproj-f16.gguf"));
        assert!(!counts_as_model("small-draft.gguf"));
        assert!(!counts_as_model("notes.txt"));
        let (dir, storage, diag) = open();
        std::fs::create_dir_all(dir.path().join("models")).expect("dir");
        std::fs::write(dir.path().join("models").join("m.gguf"), b"x").expect("model");
        assert!(!decide(&storage, dir.path(), &diag));
    }

    #[test]
    fn start_keeps_the_first_date_and_complete_carries_it() {
        let (_dir, storage, _diag) = open();
        let first = start(&storage).expect("start");
        let started = first["record"]["startedAt"].clone();
        assert_eq!(first["record"]["status"], "in-progress");
        let again = start(&storage).expect("start");
        assert_eq!(again["record"]["startedAt"], started);
        let done = complete(&storage, "local").expect("complete");
        assert_eq!(done["success"], true);
        assert_eq!(done["record"]["status"], "done");
        assert_eq!(done["record"]["startedAt"], started);
    }

    #[test]
    fn complete_refuses_unknown_and_adopted_paths() {
        let (_dir, storage, _diag) = open();
        for path in ["nope", "adopted", ""] {
            let out = complete(&storage, path).expect("complete");
            assert_eq!(
                out,
                json!({ "success": false, "error": "Unknown setup path." })
            );
        }
        assert_eq!(storage.get_value(RECORD_KEY).expect("get"), None);
    }

    #[test]
    fn reset_writes_an_in_progress_record() {
        let (_dir, storage, diag) = open();
        complete(&storage, "skipped").expect("complete");
        reset(&storage, &diag).expect("reset");
        assert_eq!(
            stored(&storage).expect("record").status,
            core::Status::InProgress
        );
    }

    #[test]
    fn state_reports_the_plan_and_the_record() {
        let (_dir, storage, _diag) = open();
        assert_eq!(
            state(Some(&storage), true),
            json!({ "plan": "show", "record": null })
        );
        assert_eq!(state(None, false)["plan"], "done");
    }
}
