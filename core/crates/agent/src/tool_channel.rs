//! How a model calls tools: `native` when it advertises tools, `text` with `<tool>{...}</tool>` otherwise. A bad
//! text call gets one repair with constrained decoding. Port of `src/agent/toolChannel.ts`.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::compaction::utf16_prefix;
use crate::js::{CaseFold, Flags, JsRegex, cached};
use crate::parsing::parse_tool_call;

/// The channel a model is asked for tool calls on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolChannel {
    Native,
    Text,
}

/// A tool a model may call, in the shape the registry sends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionDefinition,
}

/// The name and parameters of a tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub parameters: Value,
}

/// The call read back from a repair. Each key is absent when the reply did not carry it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct RepairedCall {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
}

/// The tool channel for a model: native when it advertises tools, otherwise the prompted text format.
pub fn choose_channel(capabilities: Option<&[String]>) -> ToolChannel {
    match capabilities {
        Some(list) if list.iter().any(|cap| cap == "tools") => ToolChannel::Native,
        _ => ToolChannel::Text,
    }
}

/// The schema a repair is asked for. The names are listed so the model cannot invent a tool.
pub fn repair_schema(definitions: &[ToolDefinition]) -> Value {
    let names: Vec<&str> = definitions
        .iter()
        .map(|definition| definition.function.name.as_str())
        .collect();
    let name = if names.is_empty() {
        json!({ "type": "string" })
    } else {
        json!({ "type": "string", "enum": names })
    };

    json!({
        "type": "object",
        "properties": {
            "name": name,
            "args": { "type": "object" },
        },
        "required": ["name", "args"],
    })
}

/// What is asked during a repair, in place of the mangled call. The broken text is cut short, not pasted whole.
pub fn repair_prompt(broken: &str) -> String {
    format!(
        "That tool call could not be read:\n\n{}\n\nSend it again as JSON with exactly two keys: \"name\" for the tool and \"args\" for its arguments. No prose, no tags, no code fences.",
        utf16_prefix(broken, 500)
    )
}

/// Reads a repaired reply with the ordinary parser, so a model that fences its JSON anyway is still understood.
pub fn read_repair(raw: &str) -> RepairedCall {
    let parsed = parse_tool_call(raw);
    // TS quirk: a name that is not a string is read as no name here, where the reference would keep it as-is.
    let name = parsed
        .name
        .as_ref()
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty());

    match name {
        None => RepairedCall::default(),
        Some(name) => RepairedCall {
            name: Some(name.to_string()),
            args: Some(parsed.args.unwrap_or_else(|| json!({}))),
        },
    }
}

/// Whether a reply was trying to be a tool call, so that a reply which did not parse is worth one repair pass.
/// Only the first 4000 units are looked at.
pub fn looks_like_call(text: &str, names: &[&str]) -> bool {
    static OPEN_TAG: OnceLock<Option<JsRegex>> = OnceLock::new();
    static JSON_KEY: OnceLock<Option<JsRegex>> = OnceLock::new();
    let flags = Flags {
        case: CaseFold::AsciiOnly,
        dot_all: false,
    };

    if text.is_empty() {
        return false;
    }

    let sample = utf16_prefix(text, 4000);
    let mentions_tool = names.iter().any(|name| sample.contains(name));
    if !mentions_tool {
        return false;
    }

    let open_tag = cached(
        &OPEN_TAG,
        r"<\s*(?:tool|tool_call|function|invoke)\b",
        flags,
    );
    let json_key = cached(&JSON_KEY, r#""(?:name|tool|tool_name)"\s*:"#, flags);
    open_tag.is_some_and(|regex| regex.is_match(sample))
        || json_key.is_some_and(|regex| regex.is_match(sample))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_that_is_not_a_string_is_no_call() {
        assert_eq!(read_repair(r#"{"name": 5}"#), RepairedCall::default());
    }
}
