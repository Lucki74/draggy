//! The neutral types every adapter speaks: the chat request the agent builds, the events a stream turns into, and the
//! failure a provider reports. The request follows the renderer's body, so the field names match the Electron side.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One chat turn as a provider adapter reads it. Only the fields the adapters use are here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ChatRequest {
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Vec<ToolSpec>,
    #[serde(default)]
    pub stream: bool,
    pub max_tokens: Option<i64>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub think: Option<bool>,
    pub thinking_level: Option<String>,
    pub chat_template_kwargs: Option<Map<String, Value>>,
    pub response_format: Option<Value>,
    #[serde(default)]
    pub options: Options,
}

/// The local-server knobs a request may carry.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Options {
    pub num_ctx: Option<i64>,
    pub num_predict: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    #[serde(default)]
    pub role: String,
    pub content: Option<Content>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub thinking: Option<String>,
    pub provider_state: Option<ProviderState>,
}

/// A message's content: plain text, or parts when it carries images.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Content {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text {
        #[serde(default)]
        text: String,
    },
    ImageUrl {
        image_url: ImageUrl,
    },
    /// Any other part; the adapters drop it, as the reference does.
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageUrl {
    #[serde(default)]
    pub url: String,
}

/// A call the assistant made in an earlier turn, replayed with its result.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: Option<String>,
    #[serde(default)]
    pub function: ToolCallFunction,
}

/// The name and arguments of a call; the arguments are a JSON string or an object.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: Option<String>,
    #[serde(default)]
    pub arguments: Value,
}

/// A tool offered to the model. Only `function` tools go to a provider; anything else is dropped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub function: Option<FunctionSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionSpec {
    pub name: Option<String>,
    pub description: Option<String>,
    pub parameters: Option<Value>,
}

/// The reasoning state a provider returned, tagged with the instance that wrote it. It goes back only to that instance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderState {
    pub instance_id: String,
    #[serde(default)]
    pub state: Value,
}

/// One thing a streamed answer says, in the order the provider said it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    TextDelta {
        text: String,
    },
    ReasoningDelta {
        text: String,
    },
    /// A fragment of a tool call. `arguments` is a piece of JSON text, to be joined by the reader.
    ToolCallDelta {
        index: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        arguments: String,
    },
    ProviderState {
        state: ProviderState,
    },
    Finish {
        reason: FinishReason,
        usage: Usage,
    },
    Error {
        error: ProviderError,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    Length,
    ToolCalls,
}

/// Token counts the provider reported; both are zero when it reported none.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub output_tokens: u64,
}

/// A complete, non-streaming answer in neutral form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Completion {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<CompletedToolCall>,
    pub finish: FinishReason,
    pub usage: Usage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_state: Option<ProviderState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletedToolCall {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub arguments: String,
}

/// A provider failure, named by kind. Its JSON keys are the ones the renderer reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub kind: ErrorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<f64>,
}

impl ProviderError {
    /// A failure that names only its kind, as a hosted tool or an unreadable event does.
    pub fn kind_only(kind: ErrorKind) -> Self {
        Self {
            kind,
            status: None,
            message: None,
            provider_message: None,
            retry_after: None,
        }
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.message {
            Some(message) => f.write_str(message),
            None => write!(f, "{:?}", self.kind),
        }
    }
}

impl std::error::Error for ProviderError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorKind {
    #[serde(rename = "provider-no-credit")]
    NoCredit,
    #[serde(rename = "provider-region-unavailable")]
    RegionUnavailable,
    #[serde(rename = "provider-context-too-long")]
    ContextTooLong,
    #[serde(rename = "provider-refused")]
    Refused,
    #[serde(rename = "provider-invalid-key")]
    InvalidKey,
    #[serde(rename = "provider-model-not-found")]
    ModelNotFound,
    #[serde(rename = "provider-rate-limited")]
    RateLimited,
    #[serde(rename = "provider-unknown-error")]
    UnknownError,
    #[serde(rename = "provider-unreachable")]
    Unreachable,
    #[serde(rename = "account-runtime-unavailable")]
    AccountRuntimeUnavailable,
    #[serde(rename = "account-signed-out")]
    AccountSignedOut,
    #[serde(rename = "account-limit-reached")]
    AccountLimitReached,
    #[serde(rename = "account-access-denied")]
    AccountAccessDenied,
}
