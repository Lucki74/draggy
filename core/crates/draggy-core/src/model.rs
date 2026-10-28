//! The model, reached over an OpenAI-compatible endpoint such as `llama-server`. The request is built and the stream is
//! decoded by the providers crate; this module only joins them to the agent loop's `ModelClient`.

use std::collections::VecDeque;
use std::time::Instant;

use draggy_agent::agent_loop::{
    ChatRequest, ChunkStream, FinalCounts, ModelChunk, ModelClient, RepairRequest, ToolCall,
    ToolCallDelta, TurnError, WireMessage,
};
use draggy_providers::adapters::common::{Connection, Stream};
use draggy_providers::adapters::openai::{self, OpenAiDecoder};
use draggy_providers::http::{ByteStream, HttpClient, HttpRequest, Method, read_text};
use draggy_providers::types::{
    ChatMessage, ChatRequest as ProviderRequest, Content, ContentPart, FinishReason, FunctionSpec,
    ImageUrl, Options, StreamEvent, TokenUsage, ToolCall as ProviderCall, ToolCallFunction,
    ToolSpec,
};
use serde_json::Value;

use crate::net::Net;

pub struct OpenAiModel {
    net: std::sync::Arc<Net>,
    connection: Connection,
}

impl OpenAiModel {
    pub fn new(net: std::sync::Arc<Net>, base_url: &str, api_key: Option<&str>) -> Self {
        Self {
            net,
            connection: Connection {
                base_url: base_url.trim_end_matches('/').to_owned(),
                api_key: api_key.unwrap_or_default().to_owned(),
                ..Connection::default()
            },
        }
    }
}

/// Plain text, or text followed by its pictures as data URLs.
fn content_of(message: &WireMessage) -> Content {
    if message.images.is_empty() {
        return Content::Text(message.content.clone());
    }
    let mut parts = vec![ContentPart::Text {
        text: message.content.clone(),
    }];
    for data in &message.images {
        parts.push(ContentPart::ImageUrl {
            image_url: ImageUrl {
                url: format!("data:{};base64,{data}", image_mime(data)),
            },
        });
    }
    Content::Parts(parts)
}

/// The type of an image from the start of its base64, since the wire carries no type.
fn image_mime(base64: &str) -> &'static str {
    if base64.starts_with("iVBOR") {
        "image/png"
    } else if base64.starts_with("R0lGO") {
        "image/gif"
    } else if base64.starts_with("UklGR") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn message_of(message: &WireMessage) -> ChatMessage {
    ChatMessage {
        role: message.role.clone(),
        content: Some(content_of(message)),
        tool_calls: message
            .tool_calls
            .iter()
            .map(|call| ProviderCall {
                id: call.id.clone(),
                function: ToolCallFunction {
                    name: Some(call.name.clone()),
                    arguments: call.arguments.clone(),
                },
            })
            .collect(),
        tool_call_id: message.tool_call_id.clone(),
        tool_name: message.tool_name.clone(),
        thinking: message.thinking.clone(),
        provider_state: None,
    }
}

/// The loop's request as the providers crate reads it.
pub fn provider_request(request: &ChatRequest) -> ProviderRequest {
    ProviderRequest {
        messages: request.messages.iter().map(message_of).collect(),
        tools: request
            .tools
            .iter()
            .flatten()
            .map(|tool| ToolSpec {
                kind: Some(tool.kind.clone()),
                function: Some(FunctionSpec {
                    name: Some(tool.function.name.clone()),
                    description: Some(tool.function.description.clone()),
                    parameters: Some(tool.function.parameters.clone()),
                }),
            })
            .collect(),
        stream: true,
        think: request.think,
        thinking_level: request.thinking_level.clone(),
        options: Options {
            num_ctx: Some(request.num_ctx),
            num_predict: None,
        },
        ..ProviderRequest::default()
    }
}

impl ModelClient for OpenAiModel {
    fn stream(&mut self, request: ChatRequest) -> Result<ChunkStream, TurnError> {
        let http: HttpRequest = {
            let mut sent = openai::build_request(
                &provider_request(&request),
                &self.connection,
                &request.model,
            );
            sent.method = Method::Post;
            sent
        };
        let (head, mut body) = self
            .net
            .open(&http)
            .map_err(|error| TurnError::Model(error.message))?;
        if !head.ok() {
            let text = read_text(&mut *body).unwrap_or_default();
            let shown: String = text.chars().take(300).collect();
            return Err(TurnError::Model(format!(
                "The model server answered {}: {}",
                head.status,
                shown.trim()
            )));
        }
        Ok(Box::new(ChunkReader::new(body)))
    }

    fn repair(&mut self, _request: RepairRequest) -> Option<String> {
        None
    }
}

#[derive(Default)]
struct PendingCall {
    id: Option<String>,
    name: String,
    arguments: String,
}

/// Reads the body a piece at a time and hands the loop one chunk per read. Dropping it closes the connection.
struct ChunkReader {
    body: Box<dyn ByteStream>,
    decoder: Stream<OpenAiDecoder>,
    queue: VecDeque<Result<ModelChunk, TurnError>>,
    calls: Vec<PendingCall>,
    started: Instant,
    first_token: Option<Instant>,
    finished: bool,
}

impl ChunkReader {
    fn new(body: Box<dyn ByteStream>) -> Self {
        Self {
            body,
            decoder: openai::stream(),
            queue: VecDeque::new(),
            calls: Vec::new(),
            started: Instant::now(),
            first_token: None,
            finished: false,
        }
    }

    fn arrive(&mut self) {
        self.first_token.get_or_insert_with(Instant::now);
    }

    fn absorb(&mut self, events: Vec<StreamEvent>) {
        if events.is_empty() {
            return;
        }
        let mut chunk = ModelChunk::default();
        for event in events {
            match event {
                StreamEvent::TextDelta { text } => {
                    self.arrive();
                    chunk.content.push_str(&text);
                }
                StreamEvent::ReasoningDelta { text } => {
                    self.arrive();
                    chunk.thinking.push_str(&text);
                }
                StreamEvent::ToolCallDelta {
                    index,
                    id,
                    name,
                    arguments,
                } => {
                    self.arrive();
                    let slot = index as usize;
                    if self.calls.len() <= slot {
                        self.calls.resize_with(slot + 1, PendingCall::default);
                    }
                    let call = &mut self.calls[slot];
                    if let Some(id) = &id {
                        call.id = Some(id.clone());
                    }
                    if let Some(name) = &name {
                        call.name.push_str(name);
                    }
                    call.arguments.push_str(&arguments);
                    chunk.tool_call_deltas.push(ToolCallDelta {
                        id,
                        name,
                        arguments: Some(arguments),
                    });
                }
                StreamEvent::ProviderState { .. } => {}
                StreamEvent::Finish { reason, usage } => {
                    chunk.tool_calls = self.completed_calls();
                    chunk.done =
                        Some(self.counts(reason, usage.prompt_tokens, usage.output_tokens, usage.tokens));
                }
                StreamEvent::Error { error } => {
                    chunk.error = Some(error.to_string());
                }
            }
        }
        self.queue.push_back(Ok(chunk));
    }

    fn completed_calls(&mut self) -> Vec<ToolCall> {
        std::mem::take(&mut self.calls)
            .into_iter()
            .filter(|call| !call.name.is_empty())
            .map(|call| ToolCall {
                id: call.id,
                name: call.name,
                arguments: serde_json::from_str::<Value>(&call.arguments)
                    .ok()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
            })
            .collect()
    }

    fn counts(
        &self,
        reason: FinishReason,
        prompt: u64,
        output: u64,
        split: Option<TokenUsage>,
    ) -> FinalCounts {
        let now = Instant::now();
        let first = self.first_token.unwrap_or(now);
        let prompt_ns = first.duration_since(self.started).as_nanos() as f64;
        let eval_ns = now.duration_since(first).as_nanos() as f64;
        FinalCounts {
            done_reason: Some(
                match reason {
                    FinishReason::Stop => "stop",
                    FinishReason::Length => "length",
                    FinishReason::ToolCalls => "tool_calls",
                }
                .to_owned(),
            ),
            prompt_eval_count: prompt as f64,
            eval_count: output as f64,
            prompt_eval_duration_ns: prompt_ns,
            eval_duration_ns: eval_ns,
            load_duration_ns: 0.0,
            total_duration_ns: prompt_ns + eval_ns,
            usage: split,
        }
    }
}

impl Iterator for ChunkReader {
    type Item = Result<ModelChunk, TurnError>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(item) = self.queue.pop_front() {
                return Some(item);
            }
            if self.finished {
                return None;
            }
            match self.body.next_chunk() {
                Ok(Some(bytes)) => {
                    let events = self.decoder.push(&bytes);
                    self.absorb(events);
                }
                Ok(None) => {
                    self.finished = true;
                    let events = self.decoder.finish();
                    self.absorb(events);
                }
                Err(error) => {
                    self.finished = true;
                    return Some(Err(TurnError::Model(error.message)));
                }
            }
        }
    }
}

impl Drop for ChunkReader {
    fn drop(&mut self) {
        self.body.cancel();
    }
}
