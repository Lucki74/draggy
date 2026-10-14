//! Turns a tool's answer into the text the model reads, and finds the interface a tool may point at.

use serde_json::{Map, Value};

use crate::js::{stringify, to_js_string, trim, truthy};

/// Flattens a tool result into text. Images and audio are named rather than dropped, so a model told nothing came back
/// does not conclude the tool failed and call it again.
pub fn render_tool_result(result: &Value) -> String {
    let Some(object) = result.as_object() else {
        return String::new();
    };

    let parts: Vec<String> = blocks(object.get("content"))
        .iter()
        .map(render_block)
        .filter(|part| !part.is_empty())
        .collect();
    let joined = parts.join("\n\n");
    let text = trim(&joined);

    match object.get("structuredContent") {
        Some(structured) if text.is_empty() && truthy(Some(structured)) => stringify(structured),
        _ => text.to_owned(),
    }
}

/// The `ui://` interface a result points at, from an embedded resource or a resource link. Ordinary resources are ignored.
pub fn widget_uri(result: &Value) -> Option<String> {
    for block in blocks(result.get("content")) {
        let embedded = block
            .get("resource")
            .and_then(|resource| resource.get("uri"));
        if is_widget(embedded) {
            return embedded.and_then(Value::as_str).map(str::to_owned);
        }

        let is_link = block.get("type").and_then(Value::as_str) == Some("resource_link");
        if is_link && is_widget(block.get("uri")) {
            return block.get("uri").and_then(Value::as_str).map(str::to_owned);
        }
    }

    None
}

/// Whether a uri names an interface rather than a document.
pub fn is_widget(uri: Option<&Value>) -> bool {
    uri.and_then(Value::as_str)
        .is_some_and(|uri| uri.starts_with("ui://"))
}

fn blocks(value: Option<&Value>) -> &[Value] {
    match value.and_then(Value::as_array) {
        Some(items) => items.as_slice(),
        None => &[],
    }
}

fn render_block(block: &Value) -> String {
    let Some(object) = block.as_object() else {
        return String::new();
    };

    match object.get("type").and_then(Value::as_str) {
        Some("text") => text_of(object.get("text")),
        Some("image") => format!("[image returned, {}]", mime_of(object.get("mimeType"))),
        Some("audio") => format!("[audio returned, {}]", mime_of(object.get("mimeType"))),
        Some("resource") => render_resource(object.get("resource")),
        _ => String::new(),
    }
}

fn render_resource(value: Option<&Value>) -> String {
    let empty = Map::new();
    let resource = value.and_then(Value::as_object).unwrap_or(&empty);
    let uri = resource.get("uri");

    if is_widget(uri) {
        // The markup stays out of what the model reads: a page of script is not something to act on.
        return format!("[interface: {}]", to_js_string(uri.unwrap_or(&Value::Null)));
    }

    if let Some(text) = resource.get("text").and_then(Value::as_str) {
        return text.to_owned();
    }

    let name = match uri {
        Some(uri) if truthy(Some(uri)) => to_js_string(uri),
        _ => "unnamed".to_owned(),
    };
    format!("[resource: {name}]")
}

/// `String(value ?? "")`: a missing or null text is nothing, and anything else reads as the reference reads it.
fn text_of(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(text) => to_js_string(text),
    }
}

fn mime_of(value: Option<&Value>) -> String {
    match value {
        Some(mime) if truthy(Some(mime)) => to_js_string(mime),
        _ => "unknown type".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_missing_mime_type_is_named_unknown() {
        let text = render_tool_result(&json!({"content": [{"type": "image"}]}));
        assert_eq!(text, "[image returned, unknown type]");
    }

    #[test]
    fn a_number_text_block_reads_as_its_digits() {
        assert_eq!(
            render_tool_result(&json!({"content": [{"type": "text", "text": 0}]})),
            "0"
        );
    }
}
