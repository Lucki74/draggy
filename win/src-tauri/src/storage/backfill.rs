//! Recovers turns the metrics table lacks from `logs/events.jsonl*`. Ports `backfillMetrics` in
//! electron/storage.cjs (339-445). Runs once, then leaves a marker in the kv table.

use std::collections::HashMap;
use std::path::Path;

use draggy_diagnostics::Diagnostics;
use draggy_storage::{DEFAULT_WORKSPACE_ID, MetricInput, Storage};
use serde_json::{Value, json};

const DONE_KEY: &str = "metrics_backfilled";

/// Epoch milliseconds of an ISO 8601 UTC stamp as the log writes it (`2026-01-02T03:04:05.678Z`).
fn parse_ts(stamp: &str) -> Option<i64> {
    let (date, time) = stamp.split_once('T')?;
    let time = time.strip_suffix('Z')?;
    let mut d = date.splitn(3, '-').map(|part| part.parse::<i64>().ok());
    let (year, month, day) = (d.next()??, d.next()??, d.next()??);
    let (clock, millis) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = clock.splitn(3, ':').map(|part| part.parse::<i64>().ok());
    let (hour, minute, second) = (t.next()??, t.next()??, t.next()??);
    let millis: i64 = format!("{millis:0<3}").get(..3)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

fn event_ts(event: &Value) -> Option<i64> {
    event.get("ts")?.as_str().and_then(parse_ts)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n != 0.0)
}

/// Every event with a `cid`, grouped by it, newest log file first as the reference reads them.
fn read_events(logs: &Path, diag: &Diagnostics) -> Vec<Vec<Value>> {
    let Ok(entries) = std::fs::read_dir(logs) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("events.jsonl"))
        .collect();
    files.sort();
    files.reverse();

    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<Value>> = HashMap::new();
    for file in files {
        let text = match std::fs::read(logs.join(&file)) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(error) => {
                diag.warn(
                    "storage",
                    &format!("failed reading log file for metrics backfill: {error}"),
                    None,
                );
                continue;
            }
        };
        for line in text.split('\n').filter(|line| !line.trim().is_empty()) {
            let Ok(event) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let Some(cid) = event
                .get("cid")
                .and_then(Value::as_str)
                .filter(|c| !c.is_empty())
            else {
                continue;
            };
            let cid = cid.to_owned();
            if !groups.contains_key(&cid) {
                order.push(cid.clone());
            }
            groups.entry(cid).or_default().push(event);
        }
    }
    order
        .into_iter()
        .filter_map(|cid| groups.remove(&cid))
        .collect()
}

fn metric_for(
    events: &[Value],
    summary: &Value,
    ts: i64,
    workspace: String,
) -> Option<MetricInput> {
    let data = summary.get("data")?;
    let model = data.get("model")?.as_str().filter(|m| !m.is_empty())?;
    let mut chars = 0.0;
    let mut first_chunk: Option<i64> = None;
    let mut tools = json!({});
    for event in events {
        let msg = event.get("msg").and_then(Value::as_str);
        let data = event.get("data");
        if msg == Some("chunk") && number(data.and_then(|d| d.get("chars"))).is_some() {
            chars += data
                .and_then(|d| d.get("chars"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            if first_chunk.is_none() {
                first_chunk = event_ts(event).filter(|t| *t != 0);
            }
        }
        if msg == Some("step:turn_complete")
            && let Some(calls) = data
                .and_then(|d| d.get("toolCalls"))
                .filter(|c| c.is_object())
        {
            tools = calls.clone();
        }
    }
    let start = events.first().and_then(event_ts).unwrap_or(0);
    let ttft = match (first_chunk, start) {
        (Some(chunk), start) if start != 0 => Some((chunk - start).max(0) as f64),
        _ => None,
    };
    let dur = number(data.get("durMs")).unwrap_or(1000.0);
    let output = number(data.get("outputTokens")).unwrap_or_else(|| (chars / 3.8).round().max(1.0));
    serde_json::from_value(json!({
        "recordedAt": ts,
        "workspaceId": workspace,
        "chatId": data.get("chatId"),
        "model": model,
        "promptTokens": number(data.get("promptTokens")).unwrap_or(6000.0),
        "responseTokens": output,
        "responseMs": dur,
        "firstTokenMs": ttft,
        "loadMs": 0,
        "taskMs": dur,
        "loops": number(data.get("loops")).unwrap_or(1.0),
        "tools": tools,
    }))
    .ok()
}

/// Records the turns the logs hold and the table lacks. Never fails a start: trouble is logged.
pub fn backfill_metrics(storage: &Storage, data_dir: &Path, diag: &Diagnostics) {
    if storage.get_value(DONE_KEY).ok().flatten().as_deref() == Some("done") {
        return;
    }
    let groups = read_events(&data_dir.join("logs"), diag);
    if groups.is_empty() {
        return;
    }
    let (Ok(mut known), Ok(chats)) = (storage.list_metrics(0.0), storage.load_chats()) else {
        diag.warn(
            "storage",
            "metrics backfill failed: database unreadable",
            None,
        );
        return;
    };
    let workspaces: HashMap<String, String> = chats
        .into_iter()
        .filter_map(|chat| Some((chat.id?, chat.workspace_id)))
        .collect();

    let mut backfilled = 0;
    for events in &groups {
        let Some(summary) = events
            .iter()
            .find(|e| e.get("msg").and_then(Value::as_str) == Some("turn summary"))
        else {
            continue;
        };
        let data = summary.get("data");
        if data
            .and_then(|d| d.get("aborted"))
            .is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)))
        {
            continue;
        }
        let Some(ts) = event_ts(summary).filter(|ts| *ts != 0) else {
            continue;
        };
        let chat_id = data.and_then(|d| d.get("chatId")).and_then(Value::as_str);
        let model = data.and_then(|d| d.get("model")).and_then(Value::as_str);
        if model.is_none_or(str::is_empty) {
            continue;
        }
        let duplicate = known.iter().any(|row| {
            row.chat_id.as_deref() == chat_id
                && chat_id.is_some()
                && (row.recorded_at - ts as f64).abs() <= 5000.0
        });
        if duplicate {
            continue;
        }
        let workspace = chat_id
            .and_then(|id| workspaces.get(id))
            .filter(|w| !w.is_empty())
            .cloned()
            .unwrap_or_else(|| DEFAULT_WORKSPACE_ID.to_string());
        let Some(metric) = metric_for(events, summary, ts, workspace) else {
            continue;
        };
        if storage.record_metric(&metric).is_err() {
            continue;
        }
        backfilled += 1;
        if let Ok(rows) = storage.list_metrics(ts as f64 - 1.0) {
            known = rows;
        }
    }

    if let Err(error) = storage.set_value(DONE_KEY, "done") {
        diag.warn(
            "storage",
            &format!("metrics backfill failed: {error}"),
            None,
        );
        return;
    }
    if backfilled > 0 {
        diag.info(
            "storage",
            &format!("backfilled {backfilled} missing metric turn(s) from logs"),
            None,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_diag;

    fn event(ts: &str, msg: &str, data: Value) -> String {
        json!({ "ts": ts, "cid": "t1", "msg": msg, "data": data }).to_string()
    }

    fn write_log(dir: &Path, lines: &[String]) {
        let logs = dir.join("logs");
        std::fs::create_dir_all(&logs).expect("logs");
        std::fs::write(logs.join("events.jsonl"), lines.join("\n")).expect("log");
    }

    #[test]
    fn reads_iso_stamps() {
        assert_eq!(parse_ts("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_ts("2026-01-02T03:04:05.678Z"),
            Some(1_767_323_045_678)
        );
        assert_eq!(parse_ts("nonsense"), None);
    }

    #[test]
    fn a_logged_turn_becomes_one_metric_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = Storage::open(dir.path()).expect("open");
        let diag = test_diag(dir.path());
        write_log(
            dir.path(),
            &[
                event("2026-03-01T10:00:00.000Z", "chunk", json!({ "chars": 380 })),
                event(
                    "2026-03-01T10:00:01.000Z",
                    "step:turn_complete",
                    json!({ "toolCalls": { "search_web": 1 } }),
                ),
                event(
                    "2026-03-01T10:00:02.000Z",
                    "turn summary",
                    json!({ "chatId": "c1", "model": "qwen-local.gguf", "durMs": 2000 }),
                ),
            ],
        );
        backfill_metrics(&storage, dir.path(), &diag);
        let rows = storage.list_metrics(0.0).expect("rows");
        assert_eq!(rows.len(), 1);
        let row = serde_json::to_value(&rows[0]).expect("json");
        assert_eq!(row["model"], "qwen-local.gguf");
        assert_eq!(row["chatId"], "c1");
        assert_eq!(row["tools"], json!({ "search_web": 1 }));
        assert_eq!(row["responseTokens"], 100);
        assert_eq!(
            storage.get_value(DONE_KEY).expect("get").as_deref(),
            Some("done")
        );

        // The marker stops a second pass from adding the turn again.
        backfill_metrics(&storage, dir.path(), &diag);
        assert_eq!(storage.list_metrics(0.0).expect("rows").len(), 1);
    }

    #[test]
    fn an_aborted_or_modelless_turn_is_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = Storage::open(dir.path()).expect("open");
        let diag = test_diag(dir.path());
        write_log(
            dir.path(),
            &[
                event(
                    "2026-03-01T10:00:02.000Z",
                    "turn summary",
                    json!({ "chatId": "c1", "model": "m", "aborted": true }),
                ),
                json!({ "ts": "2026-03-01T10:00:03.000Z", "cid": "t2", "msg": "turn summary", "data": { "chatId": "c2" } })
                    .to_string(),
            ],
        );
        backfill_metrics(&storage, dir.path(), &diag);
        assert!(storage.list_metrics(0.0).expect("rows").is_empty());
    }
}
