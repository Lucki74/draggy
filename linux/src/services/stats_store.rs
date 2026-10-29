use super::hardware_metrics::{SystemMetrics, sample_metrics};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use draggy_core::cost::{CostKind, PassUsageRecord, price_passes};
use draggy_core::{MetricsRecord, TurnOutcome};
use draggy_storage::{Metric, MetricInput, Storage};
use gtk::glib;
use serde_json::{Map, Value};

/// The model a local reply is priced against to say what it saved. The same default as the Windows app.
pub const REFERENCE_PROVIDER: &str = "anthropic";
pub const REFERENCE_MODEL: &str = "claude-sonnet-4-5";

/// How many days the cost chart shows.
const CHART_DAYS: i32 = 30;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryItem {
    pub prompt_tokens: usize,
    pub completion_tokens: usize,
}

/// Who pays for a reply through the current settings, and which price-table entry prices it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostTarget {
    pub kind: CostKind,
    /// The price table's provider key. Empty when the table cannot price this server.
    pub provider: String,
    pub model: String,
}

/// What one finished turn cost. A local turn has no charge; `saved_micros` is what the same tokens would have cost
/// on the reference model.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnCost {
    pub kind: CostKind,
    /// Whole micro-dollars for a billed or account turn. None when no price is known, which is not the same as free.
    pub micros: Option<i64>,
    pub saved_micros: Option<i64>,
    /// `reported`, `table`, `estimated` or `unknown`, as the metrics table stores it.
    pub source: String,
    pub price_updated_at: Option<String>,
    /// The token counts of the turn's requests, summed.
    pub usage: PassUsageRecord,
}

/// One row of a breakdown table: a provider, model or workspace and what its replies cost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Share {
    pub label: String,
    pub replies: usize,
    pub micros: i64,
    pub unpriced: usize,
}

/// One day of the cost chart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayCost {
    pub label: String,
    pub micros: i64,
}

/// The cost figures over every kept turn, plus the chart and the tables.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CostSummary {
    /// Billed API spend.
    pub spent_micros: i64,
    /// What account logins would have cost through the API. Nothing is charged for them.
    pub plan_value_micros: i64,
    /// What local replies would have cost on the reference model.
    pub saved_micros: i64,
    /// Billed replies with no known price. They add nothing to `spent_micros`.
    pub unpriced: usize,
    /// Some figure rests on estimated token counts, so it is shown with a `~`.
    pub estimated: bool,
    pub days: Vec<DayCost>,
    pub providers: Vec<Share>,
    pub models: Vec<Share>,
    pub workspaces: Vec<Share>,
}

#[derive(Default, Clone)]
pub struct StatsStore {
    pub total_prompt: Arc<Mutex<usize>>,
    pub total_completion: Arc<Mutex<usize>>,
    pub history: Arc<Mutex<Vec<UsageHistoryItem>>>,
    pub metrics: Arc<Mutex<Option<SystemMetrics>>>,
    /// The local database the turns are kept in. `None` when it could not be opened.
    pub storage: Option<Arc<Storage>>,
}

impl StatsStore {
    pub fn new(storage: Option<Arc<Storage>>) -> Self {
        let store = Self {
            storage,
            ..Self::default()
        };
        store.refresh_metrics();
        store
    }

    pub fn record_tokens(&self, prompt: usize, completion: usize) {
        *self.total_prompt.lock().unwrap() += prompt;
        *self.total_completion.lock().unwrap() += completion;
        self.history.lock().unwrap().push(UsageHistoryItem {
            prompt_tokens: prompt,
            completion_tokens: completion,
        });
    }

    pub fn refresh_metrics(&self) {
        *self.metrics.lock().unwrap() = Some(sample_metrics());
    }

    /// The cost figures of every kept turn, or none when the database is not open.
    pub fn cost_summary(&self) -> Option<CostSummary> {
        let rows = self.storage.as_ref()?.list_metrics(0.0).ok()?;
        Some(summarize(&rows, now_ms()))
    }
}

/// Milliseconds since the epoch, as the metrics table keeps them.
pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Prices a finished turn. A turn whose engine reported no token split is taken as one estimated request.
pub fn price_turn(target: &CostTarget, metrics: &MetricsRecord) -> TurnCost {
    let passes = if !metrics.pass_usage.is_empty() {
        metrics.pass_usage.clone()
    } else if target.kind == CostKind::Local {
        Vec::new()
    } else {
        vec![PassUsageRecord {
            input: tokens(metrics.prompt_tokens),
            cache_read: 0,
            cache_write: 0,
            output: tokens(metrics.response_tokens),
            reasoning: 0,
            estimated: true,
            cost_usd: None,
        }]
    };
    let usage = sum_passes(&passes);
    let local = target.kind == CostKind::Local;
    let record = if local {
        price_passes(REFERENCE_PROVIDER, REFERENCE_MODEL, &passes)
    } else {
        price_passes(&target.provider, &target.model, &passes)
    };
    TurnCost {
        kind: target.kind,
        micros: if local { None } else { record.micros },
        saved_micros: if local { record.micros } else { None },
        source: record.source,
        price_updated_at: record.price_updated_at,
        usage,
    }
}

/// The row a finished turn is kept as in the metrics table. A local turn keeps no cost.
pub fn turn_metric(
    target: &CostTarget,
    cost: &TurnCost,
    metrics: &MetricsRecord,
    outcome: &TurnOutcome,
    workspace: Option<String>,
    chat_id: &str,
    now_ms: f64,
) -> MetricInput {
    let priced = cost.kind != CostKind::Local;
    let usage = &cost.usage;
    let tools: Map<String, Value> = outcome
        .tool_calls
        .iter()
        .map(|(name, count)| (name.clone(), Value::from(*count)))
        .collect();
    MetricInput {
        recorded_at: now_ms,
        workspace_id: workspace,
        chat_id: Some(chat_id.to_owned()),
        model: if target.model.is_empty() {
            metrics.model.clone()
        } else {
            target.model.clone()
        },
        prompt_tokens: metrics.prompt_tokens,
        response_tokens: metrics.response_tokens,
        response_ms: metrics.response_ms,
        first_token_ms: metrics.time_to_first_token_ms,
        load_ms: metrics.load_ms,
        task_ms: metrics.total_ms,
        loops: f64::from(outcome.loops),
        tools,
        provider_id: (!target.provider.is_empty()).then(|| target.provider.clone()),
        kind: Some(kind_name(cost.kind).to_owned()),
        input_tokens: Some(usage.input as i64),
        cache_read_tokens: Some(usage.cache_read as i64),
        cache_write_tokens: Some(usage.cache_write as i64),
        output_tokens: Some(usage.output as i64),
        reasoning_tokens: Some(usage.reasoning as i64),
        cost_micros: if priced { cost.micros } else { None },
        cost_source: priced.then(|| cost.source.clone()),
        price_updated_at: if priced {
            cost.price_updated_at.clone()
        } else {
            None
        },
    }
}

/// Sums the cost figures of the kept turns. A row with no kind predates the cost columns and is left out of the money.
pub fn summarize(rows: &[Metric], now_ms: f64) -> CostSummary {
    let mut summary = CostSummary::default();
    let mut by_day: BTreeMap<(i32, i32, i32), i64> = BTreeMap::new();
    let mut providers: BTreeMap<String, Share> = BTreeMap::new();
    let mut models: BTreeMap<String, Share> = BTreeMap::new();
    let mut workspaces: BTreeMap<String, Share> = BTreeMap::new();
    for row in rows {
        let kind = row.kind.as_deref();
        if !matches!(kind, Some("billed" | "account" | "local")) {
            continue;
        }
        if row.cost_source.as_deref() == Some("estimated") {
            summary.estimated = true;
        }
        let micros = row.cost_micros;
        let unpriced = kind == Some("billed") && micros.is_none();
        match kind {
            Some("billed") => {
                if let Some(micros) = micros {
                    summary.spent_micros += micros;
                    if let Some(day) = local_day(row.recorded_at) {
                        *by_day.entry(day).or_insert(0) += micros;
                    }
                }
            }
            Some("account") => summary.plan_value_micros += micros.unwrap_or(0),
            _ => {
                summary.saved_micros +=
                    price_passes(REFERENCE_PROVIDER, REFERENCE_MODEL, &[row_pass(row)])
                        .micros
                        .unwrap_or(0);
            }
        }
        if unpriced {
            summary.unpriced += 1;
        }
        let provider = row
            .provider_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| {
                if kind == Some("local") {
                    "Local".into()
                } else {
                    "Not set".into()
                }
            });
        let model = if row.model.is_empty() {
            "Unknown".to_owned()
        } else {
            row.model.clone()
        };
        let workspace = row
            .workspace_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| "No folder".into());
        let paid = micros.unwrap_or(0);
        add_share(&mut providers, provider, paid, unpriced);
        add_share(&mut models, model, paid, unpriced);
        add_share(&mut workspaces, workspace, paid, unpriced);
    }
    summary.days = match glib::DateTime::from_unix_local((now_ms / 1000.0) as i64) {
        Ok(today) => (0..CHART_DAYS)
            .rev()
            .filter_map(|back| today.add_days(-back).ok())
            .map(|day| DayCost {
                label: day
                    .format("%d %b")
                    .map(|text| text.to_string())
                    .unwrap_or_default(),
                micros: by_day.get(&day.ymd()).copied().unwrap_or(0),
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    summary.providers = sorted(providers);
    summary.models = sorted(models);
    summary.workspaces = sorted(workspaces);
    summary
}

/// A money figure with adaptive decimals, as the Windows app shows it. A `~` marks a figure built on estimated counts.
pub fn format_money(micros: i64, estimated: bool) -> String {
    let mark = if estimated { "~" } else { "" };
    let amount = micros as f64 / 1_000_000.0;
    if amount <= 0.0 {
        return format!("{mark}$0.00");
    }
    if amount < 0.0001 {
        return format!("{mark}<$0.0001");
    }
    if amount < 0.01 {
        return format!("{mark}${amount:.4}");
    }
    format!("{mark}${amount:.2}")
}

fn kind_name(kind: CostKind) -> &'static str {
    match kind {
        CostKind::Billed => "billed",
        CostKind::Account => "account",
        CostKind::Local => "local",
    }
}

fn tokens(value: f64) -> u64 {
    value.max(0.0).round() as u64
}

fn count(stored: Option<i64>, fallback: f64) -> u64 {
    stored.map_or_else(|| tokens(fallback), |value| value.max(0) as u64)
}

fn row_pass(row: &Metric) -> PassUsageRecord {
    PassUsageRecord {
        input: count(row.input_tokens, row.prompt_tokens),
        cache_read: count(row.cache_read_tokens, 0.0),
        cache_write: count(row.cache_write_tokens, 0.0),
        output: count(row.output_tokens, row.response_tokens),
        reasoning: count(row.reasoning_tokens, 0.0),
        estimated: false,
        cost_usd: None,
    }
}

fn sum_passes(passes: &[PassUsageRecord]) -> PassUsageRecord {
    passes.iter().fold(
        PassUsageRecord {
            input: 0,
            cache_read: 0,
            cache_write: 0,
            output: 0,
            reasoning: 0,
            estimated: false,
            cost_usd: None,
        },
        |mut total, pass| {
            total.input = total.input.saturating_add(pass.input);
            total.cache_read = total.cache_read.saturating_add(pass.cache_read);
            total.cache_write = total.cache_write.saturating_add(pass.cache_write);
            total.output = total.output.saturating_add(pass.output);
            total.reasoning = total.reasoning.saturating_add(pass.reasoning);
            total.estimated |= pass.estimated;
            total
        },
    )
}

/// The local calendar day a time falls on, as (year, month, day).
fn local_day(recorded_at: f64) -> Option<(i32, i32, i32)> {
    glib::DateTime::from_unix_local((recorded_at / 1000.0) as i64)
        .ok()
        .map(|time| time.ymd())
}

fn add_share(shares: &mut BTreeMap<String, Share>, label: String, micros: i64, unpriced: bool) {
    let share = shares.entry(label.clone()).or_insert_with(|| Share {
        label,
        replies: 0,
        micros: 0,
        unpriced: 0,
    });
    share.replies += 1;
    share.micros += micros;
    if unpriced {
        share.unpriced += 1;
    }
}

/// The biggest spenders first, then the busiest, then the name.
fn sorted(shares: BTreeMap<String, Share>) -> Vec<Share> {
    let mut list: Vec<Share> = shares.into_values().collect();
    list.sort_by(|a, b| {
        b.micros
            .cmp(&a.micros)
            .then(b.replies.cmp(&a.replies))
            .then(a.label.cmp(&b.label))
    });
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass(input: u64, output: u64) -> PassUsageRecord {
        PassUsageRecord {
            input,
            cache_read: 0,
            cache_write: 0,
            output,
            reasoning: 0,
            estimated: false,
            cost_usd: None,
        }
    }

    #[test]
    fn money_shows_adaptive_decimals() {
        assert_eq!(format_money(0, false), "$0.00");
        assert_eq!(format_money(1_500_000, false), "$1.50");
        assert_eq!(format_money(4_200, false), "$0.0042");
        assert_eq!(format_money(50, false), "<$0.0001");
        assert_eq!(format_money(1_500_000, true), "~$1.50");
    }

    #[test]
    fn a_billed_turn_with_no_known_price_has_no_figure() {
        let target = CostTarget {
            kind: CostKind::Billed,
            provider: String::new(),
            model: "some-model".into(),
        };
        let metrics = MetricsRecord {
            prompt_tokens: 10.0,
            response_tokens: 5.0,
            ..MetricsRecord::default()
        };
        let cost = price_turn(&target, &metrics);
        assert_eq!(cost.micros, None);
        assert_eq!(cost.source, "unknown");
        assert_eq!(cost.usage.input, 10);
        assert!(cost.usage.estimated);
    }

    #[test]
    fn a_local_turn_has_no_charge_but_a_saving() {
        let target = CostTarget {
            kind: CostKind::Local,
            provider: String::new(),
            model: "qwen".into(),
        };
        let metrics = MetricsRecord {
            pass_usage: vec![pass(1_000_000, 0)],
            ..MetricsRecord::default()
        };
        let cost = price_turn(&target, &metrics);
        assert_eq!(cost.micros, None);
        assert!(cost.saved_micros.is_some_and(|saved| saved > 0));
    }
}
