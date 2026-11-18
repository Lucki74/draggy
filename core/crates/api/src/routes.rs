//! `POST /v1/embeddings` and `POST /v1/completions`, which go to the local models without the agent loop.

use std::convert::Infallible;

use axum::body::{Body, Bytes};
use axum::http::StatusCode;
use axum::response::Response;
use futures_util::stream::{self, StreamExt};
use serde_json::Value;
use tokio_util::sync::{CancellationToken, DropGuard};

use crate::dialect::Dialect;
use crate::embeddings;
use crate::ollama;
use crate::server::{
    AGENT_MODEL, Backend, ByteStream, Env, ModelEntry, Permit, Shared, buffered_response, completion_id, error_body, error_response,
    failure_message, json_response, model_failure, shaped_error, sse_response, take_slot,
};
use crate::settings::{self, ApiSettings};

/// Vectors for the inputs, in the OpenAI shape.
pub(crate) async fn embeddings<B: Backend, E: Env>(shared: &Shared<B, E>, body: &Value) -> Response {
    let Some(object) = body.as_object() else {
        return error_response(StatusCode::BAD_REQUEST, "The body must be a JSON object.", "invalid_request_error");
    };
    let inputs = match embeddings::read_inputs(object.get("input")) {
        Ok(inputs) => inputs,
        Err(message) => return error_response(StatusCode::BAD_REQUEST, &message, "invalid_request_error"),
    };
    let format = match embeddings::read_format(body) {
        Ok(format) => format,
        Err(message) => return error_response(StatusCode::BAD_REQUEST, &message, "invalid_request_error"),
    };
    let requested = object.get("model").and_then(Value::as_str).unwrap_or("").to_owned();
    let permit = match take_slot(shared, None).await {
        Ok(permit) => permit,
        Err(response) => return response,
    };
    let tokens = embeddings::estimate_tokens(&inputs);
    let count = inputs.len();
    let cancel = CancellationToken::new();
    let _guard = cancel.clone().drop_guard();
    let result = shared.backend.embed(&requested, inputs, cancel).await;
    drop(permit);
    match result {
        Ok(done) if done.vectors.len() == count => {
            let reply = embeddings::reply_body(&done.model, &done.vectors, format, tokens);
            json_response(StatusCode::OK, reply.to_string())
        }
        Ok(_) => error_response(
            StatusCode::BAD_GATEWAY,
            "The embedding model returned the wrong number of vectors.",
            "server_error",
        ),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &failure_message(&error), "server_error"),
    }
}

/// A legacy text completion, passed to the local model as written.
pub(crate) async fn completions<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    mut body: Value,
    settings: &ApiSettings,
) -> Response {
    if !body.is_object() || body.get("prompt").is_none() {
        return error_response(StatusCode::BAD_REQUEST, "The prompt is required.", "invalid_request_error");
    }
    let stream = body.get("stream") == Some(&Value::Bool(true));
    settings::apply_sampling(&mut body, &settings.sampling);
    let requested = body.get("model").and_then(Value::as_str).unwrap_or("").to_owned();
    let permit = match take_slot(shared, None).await {
        Ok(permit) => permit,
        Err(response) => return response,
    };
    let cancel = CancellationToken::new();
    let guard = cancel.clone().drop_guard();
    let model = match shared.backend.prepare_model(&requested, cancel.clone()).await {
        Ok(model) => model,
        Err(error) => return model_failure(&error, None),
    };
    body["model"] = Value::String(model.clone());
    let reply = match shared.backend.forward_completions(body, cancel.clone()).await {
        Ok(reply) => reply,
        Err(error) => return model_failure(&error, None),
    };
    let status = StatusCode::from_u16(reply.status).unwrap_or(StatusCode::BAD_GATEWAY);
    if stream && status.is_success() {
        let relay = Passthrough {
            upstream: reply.body,
            done: false,
            _guard: Some(guard),
            _permit: Some(permit),
        };
        return sse_response(Body::from_stream(stream::unfold(relay, next_chunk)));
    }
    let mut bytes = Vec::new();
    let mut upstream = reply.body;
    while let Some(chunk) = upstream.next().await {
        match chunk {
            Ok(chunk) => bytes.extend_from_slice(&chunk),
            Err(error) => return model_failure(&error, None),
        }
    }
    let _ = guard.disarm();
    drop(permit);
    if !status.is_success() {
        let id = completion_id(shared.env.as_ref());
        return buffered_response(status, &bytes, &id, &model, shared.env.now_unix(), false);
    }
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(mut value) => {
            if let Some(object) = value.as_object_mut() {
                object.insert("model".to_owned(), Value::String(model));
            }
            json_response(status, value.to_string())
        }
        Err(_) => error_response(
            StatusCode::BAD_GATEWAY,
            "The model's reply could not be read.",
            "server_error",
        ),
    }
}

/// A model's stream passed on as it comes, holding the slot and the cancel guard until it ends.
struct Passthrough {
    upstream: ByteStream,
    done: bool,
    _guard: Option<DropGuard>,
    _permit: Option<Permit>,
}

async fn next_chunk(mut relay: Passthrough) -> Option<(Result<Bytes, Infallible>, Passthrough)> {
    if relay.done {
        return None;
    }
    match relay.upstream.next().await {
        Some(Ok(chunk)) => Some((Ok(chunk), relay)),
        Some(Err(error)) => {
            relay.done = true;
            let frame = format!(
                "data: {}\n\ndata: [DONE]\n\n",
                error_body(&failure_message(&error), "server_error")
            );
            Some((Ok(Bytes::from(frame)), relay))
        }
        None => {
            relay.done = true;
            if let Some(guard) = relay._guard.take() {
                let _ = guard.disarm();
            }
            None
        }
    }
}

fn ollama_shape() -> Option<Dialect> {
    Some(Dialect::OllamaChat)
}

async fn all_entries<B: Backend, E: Env>(shared: &Shared<B, E>) -> Option<Vec<ModelEntry>> {
    let mut entries = shared.backend.list_models().await.ok()?;
    entries.push(ModelEntry {
        id: AGENT_MODEL.to_owned(),
        owned_by: "draggy".to_owned(),
        context_length: None,
        capabilities: Vec::new(),
    });
    Some(entries)
}

/// The read-only Ollama routes, or `None` when the path is not one of them.
pub(crate) async fn ollama_get<B: Backend, E: Env>(shared: &Shared<B, E>, path: &str) -> Option<Response> {
    let body = match path {
        "/api/version" => ollama::version(),
        "/api/ps" => ollama::running(),
        "/api/tags" => match all_entries(shared).await {
            Some(entries) => ollama::tags(&entries, shared.env.now_unix()),
            None => {
                return Some(shaped_error(
                    ollama_shape(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "The model list failed.",
                    "server_error",
                ));
            }
        },
        _ => return None,
    };
    Some(json_response(StatusCode::OK, body.to_string()))
}

/// `POST /api/show`.
pub(crate) async fn ollama_show<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    body: &Value,
    settings: &ApiSettings,
) -> Response {
    let name = body
        .get("model")
        .or_else(|| body.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let wanted = settings::resolve_alias(name, &settings.aliases).unwrap_or(name);
    let wanted = ollama::plain_name(wanted);
    let Some(entries) = all_entries(shared).await else {
        return shaped_error(
            ollama_shape(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "The model list failed.",
            "server_error",
        );
    };
    match entries.iter().find(|entry| entry.id == wanted) {
        Some(entry) => json_response(StatusCode::OK, ollama::show(entry).to_string()),
        None => shaped_error(
            ollama_shape(),
            StatusCode::NOT_FOUND,
            &format!("model '{name}' not found"),
            "invalid_request_error",
        ),
    }
}

/// `POST /api/embed`, and the older `POST /api/embeddings` with one `prompt` and one `embedding` back.
pub(crate) async fn ollama_embed<B: Backend, E: Env>(shared: &Shared<B, E>, body: &Value, legacy: bool) -> Response {
    let shape = ollama_shape();
    let key = if legacy { "prompt" } else { "input" };
    let inputs = match embeddings::read_inputs(body.get(key)) {
        Ok(inputs) => inputs,
        Err(message) => return shaped_error(shape, StatusCode::BAD_REQUEST, &message, "invalid_request_error"),
    };
    let requested = ollama::plain_name(body.get("model").and_then(Value::as_str).unwrap_or("")).to_owned();
    let permit = match take_slot(shared, shape).await {
        Ok(permit) => permit,
        Err(response) => return response,
    };
    let tokens = embeddings::estimate_tokens(&inputs);
    let count = inputs.len();
    let cancel = CancellationToken::new();
    let _guard = cancel.clone().drop_guard();
    let result = shared.backend.embed(&requested, inputs, cancel).await;
    drop(permit);
    match result {
        Ok(done) if done.vectors.len() == count => {
            let reply = if legacy {
                serde_json::json!({"embedding": done.vectors.first().cloned().unwrap_or_default()})
            } else {
                ollama::embed_reply(&done.model, &done.vectors, tokens)
            };
            json_response(StatusCode::OK, reply.to_string())
        }
        Ok(_) => shaped_error(
            shape,
            StatusCode::BAD_GATEWAY,
            "The embedding model returned the wrong number of vectors.",
            "server_error",
        ),
        Err(error) => shaped_error(shape, StatusCode::INTERNAL_SERVER_ERROR, &failure_message(&error), "server_error"),
    }
}
