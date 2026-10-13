//! The first-run decision: whether a launch shows setup, adopts an existing install, or is done.
//! Pure over its inputs, so each case is a unit test rather than a fresh install.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

use crate::js::{iso_timestamp, now_millis, parse_any};

/// The kv key the setup record is stored under.
pub const RECORD_KEY: &str = "onboarding";
/// The kv key the settings are stored under. Any saved setting counts as prior use.
pub const SETTINGS_KEY: &str = "draggy_settings";
pub const CURRENT_VERSION: i64 = 1;
pub const PATHS: [&str; 5] = ["local", "provider", "both", "skipped", "adopted"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    InProgress,
    Done,
}

/// The stored setup record, read as the reference reads it: the status and version are typed, and every
/// other field (path, startedAt, completedAt, and any a later version wrote) is kept as sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record {
    pub version: Number,
    pub status: Status,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

/// What a launch does: show setup, adopt the install as already set up, or do nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Plan {
    Show,
    Adopt,
    Done,
}

/// What the decision reads. A count is the number of models or chats; a count that could not be read is
/// passed as one, since losing the setup costs a new user less than showing it costs an existing one.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanInput {
    pub record: Option<Record>,
    pub has_settings: bool,
    pub model_count: f64,
    pub chat_count: f64,
    pub forced: bool,
}

/// The outcome of one read a launch makes before deciding: its value, or the read failing.
#[derive(Debug, Clone, PartialEq)]
pub enum Reading<T> {
    Read(T),
    Failed,
}

/// What each read gave `collect_inputs`. A raw text that is not a record, or a count that is not a number,
/// is passed as `Read(None)`: it reads as no record, or as a count of one.
#[derive(Debug, Clone, PartialEq)]
pub struct Readings {
    pub raw: Reading<Option<String>>,
    pub settings: Reading<Option<String>>,
    pub model_count: Reading<Option<f64>>,
    pub chat_count: Reading<Option<f64>>,
    pub forced: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("not a setup path: {0}")]
pub struct NotSetupPath(pub String);

/// Decides what this launch does. Forced launches always show setup; a stored record decides next;
/// otherwise any prior use adopts the install.
pub fn plan_onboarding(input: &PlanInput) -> Plan {
    let plan = decide(input);
    tracing::info!(
        target: "settings.onboarding",
        plan = ?plan,
        forced = input.forced,
        has_settings = input.has_settings,
        model_count = input.model_count,
        chat_count = input.chat_count,
        "onboarding plan"
    );
    plan
}

fn decide(input: &PlanInput) -> Plan {
    if input.forced {
        return Plan::Show;
    }
    match input.record.as_ref().map(|record| record.status) {
        Some(Status::InProgress) => return Plan::Show,
        // An older version is done too; the version field leaves room for a later "new steps only" flow.
        Some(Status::Done) => return Plan::Done,
        None => {}
    }
    if input.has_settings || input.model_count > 0.0 || input.chat_count > 0.0 {
        Plan::Adopt
    } else {
        Plan::Show
    }
}

/// Turns the reads a launch made into the decision's inputs. A failed read of the settings counts as saved
/// settings, a failed or non-numeric count as one, and a failed record read as no record.
pub fn collect_inputs(readings: Readings) -> PlanInput {
    let record = match readings.raw {
        Reading::Read(raw) => read_record(raw.as_deref()),
        Reading::Failed => {
            tracing::warn!(target: "settings.onboarding", "onboarding reader failed, counts as no record");
            None
        }
    };
    let has_settings = match readings.settings {
        Reading::Read(settings) => settings.is_some_and(|text| !text.is_empty()),
        Reading::Failed => {
            tracing::warn!(target: "settings.onboarding", "onboarding reader failed, counts as prior use");
            true
        }
    };
    PlanInput {
        record,
        has_settings,
        model_count: count(readings.model_count, "models"),
        chat_count: count(readings.chat_count, "chats"),
        forced: readings.forced,
    }
}

fn count(reading: Reading<Option<f64>>, what: &str) -> f64 {
    match reading {
        Reading::Read(Some(value)) if value.is_finite() => value,
        Reading::Read(_) => 1.0,
        Reading::Failed => {
            tracing::warn!(target: "settings.onboarding", what, "onboarding reader failed, counts as prior use");
            1.0
        }
    }
}

/// The stored record, or None for anything that is not one. A damaged record reads as none.
pub fn read_record(raw: Option<&str>) -> Option<Record> {
    let raw = raw.filter(|text| !text.is_empty())?;
    match parse_any::<Record>(raw) {
        Ok(record) => Some(record),
        Err(error) => {
            tracing::warn!(target: "settings.onboarding", error = %error, "onboarding record damaged, reads as none");
            None
        }
    }
}

pub fn is_valid_path(path: &str) -> bool {
    PATHS.contains(&path)
}

/// `now` as an ISO 8601 UTC timestamp, the way `Date.toISOString` writes it.
pub fn now_iso() -> String {
    iso_timestamp(now_millis())
}

fn record(status: Status, fields: &[(&str, &str)]) -> Record {
    Record {
        version: Number::from(CURRENT_VERSION),
        status,
        fields: fields
            .iter()
            .map(|(key, value)| ((*key).to_string(), Value::String((*value).to_string())))
            .collect(),
    }
}

pub fn in_progress_record(now: &str) -> Record {
    record(Status::InProgress, &[("startedAt", now)])
}

/// The record once setup ends. A path that is not one of the known ones is refused, not stored.
pub fn done_record(
    path: &str,
    now: &str,
    started_at: Option<&str>,
) -> Result<Record, NotSetupPath> {
    if !is_valid_path(path) {
        return Err(NotSetupPath(path.to_string()));
    }
    let mut fields = vec![("path", path), ("completedAt", now)];
    if let Some(start) = started_at.filter(|start| !start.is_empty()) {
        fields.push(("startedAt", start));
    }
    Ok(record(Status::Done, &fields))
}

/// What starting the setup writes: nothing over a start already recorded, so a resumed setup keeps its date.
pub fn record_on_start(existing: Option<&Record>, now: &str) -> Option<Record> {
    if existing.is_some_and(|record| record.status == Status::InProgress) {
        None
    } else {
        Some(in_progress_record(now))
    }
}
