//! Per-turn statistics for the statistics page. They stay on this machine.

use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use serde::Deserializer;

use crate::js::{
    de_entries, de_number, de_optional_number, de_optional_text, de_text, key_order, measure,
    now_millis, parse_any, ser_number, ser_optional_number, to_number, utf16_prefix,
};
use crate::{Storage, StorageError};

/// The most distinct tools one turn can report, and the longest tool name kept.
const MAX_TOOLS_PER_TURN: usize = 50;
const MAX_TOOL_NAME_UNITS: usize = 120;
const MAX_MODEL_UNITS: usize = 200;
/// The most rows one listing returns, newest first.
const MAX_METRIC_ROWS: i64 = 20_000;

const MAX_TEXT_UNITS: usize = 200;
const MAX_PRICE_DATE_UNITS: usize = 40;

/// Where a turn's cost came from. `estimated` is a table price on counts the provider never reported.
const COST_SOURCES: [&str; 4] = ["reported", "table", "estimated", "unknown"];
const KINDS: [&str; 3] = ["billed", "account", "local"];

const INSERT: &str = "INSERT INTO metrics (
    recorded_at, workspace_id, chat_id, model, prompt_tokens, response_tokens,
    response_ms, first_token_ms, load_ms, task_ms, loops, tools,
    provider_id, kind, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
    reasoning_tokens, cost_micros, cost_source, price_updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)";

const SELECT: &str =
    "SELECT recorded_at, workspace_id, chat_id, model, prompt_tokens, response_tokens,
        response_ms, first_token_ms, load_ms, task_ms, loops, tools,
        provider_id, kind, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
        reasoning_tokens, cost_micros, cost_source, price_updated_at
   FROM metrics WHERE recorded_at >= ?1 ORDER BY recorded_at DESC LIMIT ?2";

/// The columns cost tracking added, each nullable so a row from before costs were kept stays valid.
pub(crate) const COST_COLUMNS: [(&str, &str); 10] = [
    ("provider_id", "TEXT"),
    ("kind", "TEXT"),
    ("input_tokens", "INTEGER"),
    ("cache_read_tokens", "INTEGER"),
    ("cache_write_tokens", "INTEGER"),
    ("output_tokens", "INTEGER"),
    ("reasoning_tokens", "INTEGER"),
    ("cost_micros", "INTEGER"),
    ("cost_source", "TEXT"),
    ("price_updated_at", "TEXT"),
];

/// A count that was never reported stays none, so "none" and "zero" remain different things.
fn de_count<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Null => None,
        value => Some(to_number(&value))
            .filter(|number| number.is_finite() && *number >= 0.0)
            .map(|number| number.floor() as i64),
    })
}

/// Text kept only when it is a non-empty string.
fn de_plain_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) if !text.is_empty() => Some(text),
        _ => None,
    })
}

/// One finished turn as the window reports it. Each number is read the way JavaScript's `Number` reads it,
/// and the store keeps only the ones it can trust.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MetricInput {
    /// Milliseconds since the epoch; zero or missing means now.
    #[serde(deserialize_with = "de_number")]
    pub recorded_at: f64,
    #[serde(deserialize_with = "de_optional_text")]
    pub workspace_id: Option<String>,
    #[serde(deserialize_with = "de_optional_text")]
    pub chat_id: Option<String>,
    #[serde(deserialize_with = "de_text")]
    pub model: String,
    #[serde(deserialize_with = "de_number")]
    pub prompt_tokens: f64,
    #[serde(deserialize_with = "de_number")]
    pub response_tokens: f64,
    #[serde(deserialize_with = "de_number")]
    pub response_ms: f64,
    /// Kept only when finite and not below zero. An absent value is none; a null one is zero.
    #[serde(deserialize_with = "de_optional_number")]
    pub first_token_ms: Option<f64>,
    #[serde(deserialize_with = "de_number")]
    pub load_ms: f64,
    #[serde(deserialize_with = "de_number")]
    pub task_ms: f64,
    #[serde(deserialize_with = "de_number")]
    pub loops: f64,
    /// Tool name to call count, in the order the turn reported them.
    #[serde(deserialize_with = "de_entries")]
    pub tools: Map<String, Value>,
    #[serde(deserialize_with = "de_plain_text")]
    pub provider_id: Option<String>,
    #[serde(deserialize_with = "de_plain_text")]
    pub kind: Option<String>,
    #[serde(deserialize_with = "de_count")]
    pub input_tokens: Option<i64>,
    #[serde(deserialize_with = "de_count")]
    pub cache_read_tokens: Option<i64>,
    #[serde(deserialize_with = "de_count")]
    pub cache_write_tokens: Option<i64>,
    #[serde(deserialize_with = "de_count")]
    pub output_tokens: Option<i64>,
    #[serde(deserialize_with = "de_count")]
    pub reasoning_tokens: Option<i64>,
    #[serde(deserialize_with = "de_count")]
    pub cost_micros: Option<i64>,
    #[serde(deserialize_with = "de_plain_text")]
    pub cost_source: Option<String>,
    #[serde(deserialize_with = "de_plain_text")]
    pub price_updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    #[serde(serialize_with = "ser_number")]
    pub recorded_at: f64,
    pub workspace_id: Option<String>,
    pub chat_id: Option<String>,
    pub model: String,
    #[serde(serialize_with = "ser_number")]
    pub prompt_tokens: f64,
    #[serde(serialize_with = "ser_number")]
    pub response_tokens: f64,
    #[serde(serialize_with = "ser_number")]
    pub response_ms: f64,
    #[serde(serialize_with = "ser_optional_number")]
    pub first_token_ms: Option<f64>,
    #[serde(serialize_with = "ser_number")]
    pub load_ms: f64,
    #[serde(serialize_with = "ser_number")]
    pub task_ms: f64,
    #[serde(serialize_with = "ser_number")]
    pub loops: f64,
    /// The tools column as it was stored, which is an object for every turn this store wrote.
    pub tools: Value,
    /// A row from before costs were kept has none of these, and reads back without them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_micros: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_updated_at: Option<String>,
}

impl Storage {
    /// Records a finished turn. A turn with no model is refused.
    pub fn record_metric(&self, row: &MetricInput) -> Result<(), StorageError> {
        self.ensure_open()?;
        let model = utf16_prefix(&row.model, MAX_MODEL_UNITS);
        if model.is_empty() {
            return Err(StorageError::MetricModelMissing);
        }

        // The cap applies to the keys in JavaScript order, so the same fifty names are kept.
        let mut tools = Map::new();
        for (name, count) in key_order(&row.tools).into_iter().take(MAX_TOOLS_PER_TURN) {
            let times = measure(to_number(count)).floor();
            if times > 0.0 {
                let key = utf16_prefix(name, MAX_TOOL_NAME_UNITS);
                // TS quirk: a number assigned to __proto__ on a plain object does nothing, so that key is never kept.
                if key != "__proto__" {
                    tools.insert(key, crate::js::js_number(times));
                }
            }
        }

        let recorded_at = match measure(row.recorded_at).floor() {
            0.0 => now_millis() as f64,
            at => at,
        };
        // A first-token time is kept only when it is a finite, non-negative number, as the reference checks.
        let first_token = row
            .first_token_ms
            .filter(|value| value.is_finite() && *value >= 0.0);
        let tools_json = if tools.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&tools)?)
        };

        let text = |value: &Option<String>, max: usize| value.as_deref().map(|t| utf16_prefix(t, max));
        let kind = row.kind.as_deref().filter(|k| KINDS.contains(k));
        let source = row.cost_source.as_deref().filter(|s| COST_SOURCES.contains(s));

        self.write("recordMetric", |conn| {
            conn.prepare_cached(INSERT)?.execute(params![
                recorded_at,
                row.workspace_id,
                row.chat_id,
                model,
                measure(row.prompt_tokens).floor(),
                measure(row.response_tokens).floor(),
                measure(row.response_ms),
                first_token,
                measure(row.load_ms),
                measure(row.task_ms),
                measure(row.loops).floor().max(1.0),
                tools_json,
                text(&row.provider_id, MAX_TEXT_UNITS),
                kind,
                row.input_tokens,
                row.cache_read_tokens,
                row.cache_write_tokens,
                row.output_tokens,
                row.reasoning_tokens,
                row.cost_micros,
                source,
                text(&row.price_updated_at, MAX_PRICE_DATE_UNITS),
            ])?;
            Ok(())
        })
    }

    /// Turns recorded at or after `since` (milliseconds), newest first, at most 20000 of them.
    pub fn list_metrics(&self, since: f64) -> Result<Vec<Metric>, StorageError> {
        let conn = self.lock()?;
        let mut statement = conn.prepare_cached(SELECT)?;
        let rows = statement
            .query_map(
                params![measure(since).floor(), MAX_METRIC_ROWS],
                metric_from_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn clear_metrics(&self) -> Result<usize, StorageError> {
        self.write("clearMetrics", |conn| {
            Ok(conn.execute("DELETE FROM metrics", [])?)
        })
    }
}

/// The tools column as `JSON.parse` reads it: any JSON value is kept, and an empty or unreadable one is an empty object.
fn metric_from_row(row: &Row<'_>) -> rusqlite::Result<Metric> {
    let tools = match row.get::<_, Option<String>>(11)? {
        Some(text) if !text.is_empty() => {
            parse_any(&text).unwrap_or_else(|_| Value::Object(Map::new()))
        }
        _ => Value::Object(Map::new()),
    };

    Ok(Metric {
        recorded_at: row.get(0)?,
        workspace_id: row.get(1)?,
        chat_id: row.get(2)?,
        model: row.get(3)?,
        prompt_tokens: row.get(4)?,
        response_tokens: row.get(5)?,
        response_ms: row.get(6)?,
        first_token_ms: row.get(7)?,
        load_ms: row.get(8)?,
        task_ms: row.get(9)?,
        loops: row.get(10)?,
        tools,
        provider_id: row.get(12)?,
        kind: row.get(13)?,
        input_tokens: row.get(14)?,
        cache_read_tokens: row.get(15)?,
        cache_write_tokens: row.get(16)?,
        output_tokens: row.get(17)?,
        reasoning_tokens: row.get(18)?,
        cost_micros: row.get(19)?,
        cost_source: row.get(20)?,
        price_updated_at: row.get(21)?,
    })
}
