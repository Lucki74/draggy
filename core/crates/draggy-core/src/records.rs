//! Flat value types that cross the boundary. Nothing here shares state with the core: the shell gets copies.

use std::collections::HashMap;

use draggy_agent::agent_loop::{AgentPatch, AgentResult, GenerationMetrics, TurnEvent};
use draggy_agent::live_turn::LiveTurn;
use draggy_agent::resume::SearchStep;

/// One entry of the timeline a turn builds: a search, a tool call, a thought, a file.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Default)]
pub struct StepRecord {
    pub id: Option<String>,
    pub kind: String,
    pub content: Option<String>,
    pub is_complete: Option<bool>,
    pub filepath: Option<String>,
    pub filename: Option<String>,
    pub language: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

impl From<&SearchStep> for StepRecord {
    fn from(step: &SearchStep) -> Self {
        Self {
            id: step.id.clone(),
            kind: step.kind.clone(),
            content: step.content.clone(),
            is_complete: step.is_complete,
            filepath: step.filepath.clone(),
            filename: step.filename.clone(),
            language: step.language.clone(),
            stdout: step.stdout.clone(),
            stderr: step.stderr.clone(),
        }
    }
}

/// The figures of one generation.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Default)]
pub struct MetricsRecord {
    pub prompt_tokens: f64,
    pub response_tokens: f64,
    pub prompt_ms: f64,
    pub response_ms: f64,
    pub load_ms: f64,
    pub total_ms: f64,
    pub tokens_per_second: f64,
    pub time_to_first_token_ms: Option<f64>,
    pub context_window: f64,
    pub model: String,
    pub gpu_percent: Option<f64>,
}

impl From<&GenerationMetrics> for MetricsRecord {
    fn from(metrics: &GenerationMetrics) -> Self {
        Self {
            prompt_tokens: metrics.prompt_tokens,
            response_tokens: metrics.response_tokens,
            prompt_ms: metrics.prompt_ms,
            response_ms: metrics.response_ms,
            load_ms: metrics.load_ms,
            total_ms: metrics.total_ms,
            tokens_per_second: metrics.tokens_per_second,
            time_to_first_token_ms: metrics.time_to_first_token_ms,
            context_window: metrics.context_window,
            model: metrics.model.clone(),
            gpu_percent: metrics.gpu_percent,
        }
    }
}

/// What the context window holds while a turn runs.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Default)]
pub struct LiveRecord {
    pub response_tokens: f64,
    pub tokens_per_second: f64,
    pub context_tokens: f64,
    pub context_exact: bool,
    pub context_window: f64,
}

impl From<&LiveTurn> for LiveRecord {
    fn from(live: &LiveTurn) -> Self {
        Self {
            response_tokens: live.response_tokens,
            tokens_per_second: live.tokens_per_second,
            context_tokens: live.context_tokens,
            context_exact: live.context_exact,
            context_window: live.context_window,
        }
    }
}

/// One thing a turn reports. Each variant is a snapshot, so a later one replaces an earlier one of the same kind.
#[derive(uniffi::Enum, Debug, Clone, PartialEq)]
pub enum TurnEventRecord {
    Patch {
        content: String,
        text_content: String,
        steps: Vec<StepRecord>,
    },
    Steps {
        steps: Vec<StepRecord>,
    },
    OutOfContext {
        value: bool,
    },
    Metrics {
        metrics: MetricsRecord,
    },
    Live {
        live: LiveRecord,
    },
}

fn steps_of(steps: &[SearchStep]) -> Vec<StepRecord> {
    steps.iter().map(StepRecord::from).collect()
}

impl From<&TurnEvent> for TurnEventRecord {
    fn from(event: &TurnEvent) -> Self {
        match event {
            TurnEvent::Patch(AgentPatch {
                content,
                text_content,
                steps,
            }) => Self::Patch {
                content: content.clone(),
                text_content: text_content.clone(),
                steps: steps_of(steps),
            },
            TurnEvent::Steps(steps) => Self::Steps {
                steps: steps_of(steps),
            },
            TurnEvent::OutOfContext(value) => Self::OutOfContext { value: *value },
            TurnEvent::Metrics(metrics) => Self::Metrics {
                metrics: metrics.into(),
            },
            TurnEvent::Live(live) => Self::Live { live: live.into() },
        }
    }
}

/// A message of the conversation as the shell shows it.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct MessageRecord {
    pub id: String,
    pub role: String,
    pub content: String,
}

/// What a finished turn produced.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Default)]
pub struct TurnOutcome {
    pub content: String,
    pub text_content: String,
    pub steps: Vec<StepRecord>,
    pub metrics: Option<MetricsRecord>,
    pub out_of_context: bool,
    pub loops: u32,
    pub exhausted: bool,
    pub aborted: bool,
    pub tool_calls: HashMap<String, u32>,
}

impl From<&AgentResult> for TurnOutcome {
    fn from(result: &AgentResult) -> Self {
        Self {
            content: result.content.clone(),
            text_content: result.text_content.clone(),
            steps: steps_of(&result.steps),
            metrics: result.metrics.as_ref().map(MetricsRecord::from),
            out_of_context: result.out_of_context,
            loops: u32::try_from(result.loops).unwrap_or(u32::MAX),
            exhausted: result.exhausted,
            aborted: result.aborted,
            tool_calls: result
                .tool_calls
                .iter()
                .map(|(name, count)| (name.clone(), *count))
                .collect(),
        }
    }
}

/// Where the model runs and how a session talks to it. The key stays in memory; it is never written anywhere.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct SessionConfig {
    /// The OpenAI-compatible base, such as `http://127.0.0.1:8080/v1`.
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    /// The project folder the file tools may reach. Without one the model gets no file tools.
    pub folder: Option<String>,
    /// The window to ask for, when the user fixed one.
    pub context_tokens: Option<i64>,
    /// How many passes a turn may take before it stops with `exhausted`.
    pub loop_limit: Option<u32>,
}
