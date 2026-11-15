//! Handlers for the cloud image channels. The provider's stored key is read here and never reaches the renderer;
//! the renderer gets the list of connected providers and the picture as a data URL.

use base64::Engine as _;
use serde_json::{Value, json};
use tauri::AppHandle;

use super::terminals::text;
use super::web::keys;
use super::{IpcError, Registry};
use crate::images::cloud::{self, CloudError, Protocol, Request};
use draggy_providers::catalog::Catalog;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "images:cloud-models" => cloud_models);
    register!(registry, "images:cloud-generate" => cloud_generate);
}

fn failure(code: &str) -> Value {
    json!({ "success": false, "code": code })
}

fn stored_key(app: &AppHandle, id: &str) -> String {
    keys::stored(app, &format!("provider:{id}"))
}

/// Providers with an image protocol and a stored key, with their default image models.
async fn cloud_models(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let catalog = Catalog::bundled();
    let providers: Vec<Value> = catalog
        .image_entries()
        .filter(|entry| !stored_key(&app, &entry.id).is_empty())
        .map(|entry| {
            json!({
                "id": entry.id,
                "name": entry.name,
                "models": entry.image_default_models(),
            })
        })
        .collect();
    Ok(json!({ "providers": providers }))
}

/// One picture from a cloud provider with its stored key. The error is a short code the renderer translates.
pub(super) async fn render(
    app: &AppHandle,
    provider: &str,
    model: &str,
    prompt: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, &'static str> {
    let catalog = Catalog::bundled();
    let entry = catalog.find(provider).ok_or("unknown-provider")?;
    let protocol = entry
        .image_protocol()
        .and_then(Protocol::from_id)
        .ok_or("unknown-provider")?;
    if prompt.trim().is_empty() || model.trim().is_empty() {
        return Err("empty-request");
    }
    let key = stored_key(app, &entry.id);
    let picture = Request {
        base: &entry.base_url,
        key: &key,
        model,
        prompt,
        width,
        height,
    };
    cloud::generate(protocol, &picture)
        .await
        .map_err(CloudError::code)
}

/// One picture: `{ provider, model, prompt, width?, height? }`. Replies `{ success, dataUrl }` or a code.
async fn cloud_generate(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = args.first();
    let field = |name: &str| text(request.and_then(|request| request.get(name)));
    let size = |name: &str| {
        request
            .and_then(|request| request.get(name))
            .and_then(Value::as_u64)
            .map_or(1024, |value| value.clamp(64, 2048) as u32)
    };
    let drawn = render(
        &app,
        &field("provider"),
        &field("model"),
        &field("prompt"),
        size("width"),
        size("height"),
    )
    .await;
    Ok(match drawn {
        Ok(bytes) => {
            let (mime, _) = cloud::format_of(&bytes).unwrap_or(("image/png", "png"));
            json!({
                "success": true,
                "dataUrl": format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&bytes)
                ),
            })
        }
        Err(code) => failure(code),
    })
}
