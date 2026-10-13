//! Runs the golden fixtures in `shared/fixtures/agent` through the Rust port. The vitest runner in
//! `src/__tests__/fixtures/agent.test.ts` calls the TypeScript reference on the same files, so both must agree.

use draggy_agent::announcement::announces_action;
use draggy_agent::command_rules::{
    command_covered, command_grant_targets, command_prefix, command_segments,
};
use draggy_agent::json::canonical;
use draggy_agent::parsing::{
    ParsedToolCall, TOOL_MARKER_OVERLAP, ToolParser, extract_file_streaming_args, extract_thought,
    has_tool_marker, has_tool_marker_across, has_tool_marker_in_overlap, parse_tool_call,
};
use draggy_agent::permissions::{
    Decision, Grant, PermissionMode, PermissionQuery, ToolAnnotations, Verdict, add_grant, decide,
    denied_by_user, grant_covers, grants_for, refusal_for, target_from_args,
};
use draggy_agent::prompts::{
    InstanceKind, InstanceProfile, ListedModel, ProfileChoice, ProjectMemory, PromptEnvironment,
    PromptMode, PromptProfile, PromptSettings, PromptSkill, PromptTool, SystemPromptInput,
    ThinkingMode, WebMode, build_project_prompt, build_system_prompt, build_voice_prompt,
    current_time_note, prompt_profile_for, voice_search_query,
};
use draggy_agent::repetition::detect_repetition;
use draggy_testkit::{cases, files};
use serde_json::{Map, Value, json};

#[test]
fn fixtures_match_the_typescript_reference() {
    for file in files("agent") {
        for case in cases("agent", &file) {
            let name = case["name"].as_str().unwrap_or_default();
            let actual = run(&file, &case["input"]);
            // Numbers compare as JavaScript doubles, so `1.0` and `1` are the same value on both sides.
            assert_eq!(
                canonical(&actual),
                canonical(&case["expected"]),
                "{file}: {name}"
            );
        }
    }
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "toolParsing.json" => tool_parsing(input),
        "repetition.json" => repetition(input),
        "announcement.json" => json!(announces_action(text(input))),
        "commandRules.json" => command_rules(input),
        "permissions.json" => permissions(input),
        "prompts.json" => prompts(input),
        "promptProfile.json" => profile(input),
        other => panic!("no runner for {other}"),
    }
}

fn op(input: &Value) -> &str {
    input["op"].as_str().unwrap_or_default()
}

/// A string field, or the empty string when absent.
fn text(input: &Value) -> &str {
    input["text"].as_str().unwrap_or_default()
}

/// A string field that may be `null`.
fn optional(value: &Value) -> Option<&str> {
    value.as_str()
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn flag(value: &Value) -> bool {
    value.as_bool().unwrap_or(false)
}

/// The JSON a parsed call reads as in the fixtures: `name` and `args`, each `null` when absent.
fn call_json(call: ParsedToolCall) -> Value {
    json!({ "name": call.name, "args": call.args })
}

fn tool_parsing(input: &Value) -> Value {
    let raw = input["raw"].as_str().unwrap_or_default();
    match op(input) {
        "detect" | "detectParse" | "strip" => {
            let names = string_list(&input["names"]);
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            let parser = ToolParser::new(&names).expect("built-in tool patterns compile");
            match op(input) {
                "detect" => json!(parser.detect(raw)),
                "strip" => json!(parser.strip(raw)),
                _ => match parser.detect(raw) {
                    Some(detected) => call_json(parse_tool_call(&detected)),
                    None => Value::Null,
                },
            }
        }
        "parse" => call_json(parse_tool_call(raw)),
        "thought" => json!(extract_thought(raw)),
        "markerIn" => json!(has_tool_marker(text(input))),
        "markerOverlap" => json!(has_tool_marker_in_overlap(
            input["chunk"].as_str().unwrap_or_default()
        )),
        "markerAcross" => json!(has_tool_marker_across(
            input["first"].as_str().unwrap_or_default(),
            input["second"].as_str().unwrap_or_default()
        )),
        "markerOverlapWidth" => json!(TOOL_MARKER_OVERLAP),
        "fileArgs" => {
            let args = extract_file_streaming_args(raw);
            json!({ "filename": args.filename, "content": args.content })
        }
        other => panic!("unknown toolParsing op {other}"),
    }
}

fn repetition(input: &Value) -> Value {
    let source = text(input);
    if op(input) == "prefixLoops" {
        // Every code-point prefix of a streamed reply goes through the check. The TypeScript runner walks the same points.
        let flags = source
            .char_indices()
            .map(|(index, c)| json!(detect_repetition(&source[..index + c.len_utf8()]).has_loop));
        return Value::Array(flags.collect());
    }
    let result = detect_repetition(source);
    json!({
        "hasLoop": result.has_loop,
        "pattern": result.pattern,
        "repeatCount": result.repeat_count,
        "trimmedText": result.trimmed_text,
    })
}

fn command_rules(input: &Value) -> Value {
    match op(input) {
        "segments" => json!(command_segments(optional(&input["command"]))),
        "prefix" => json!(command_prefix(
            input["segment"].as_str().unwrap_or_default()
        )),
        "targets" => json!(command_grant_targets(optional(&input["command"]))),
        "covered" => json!(command_covered(
            &string_list(&input["allowed"]),
            optional(&input["command"])
        )),
        other => panic!("unknown commandRules op {other}"),
    }
}

fn annotations(value: &Value) -> ToolAnnotations {
    ToolAnnotations {
        read_only: flag(&value["readOnly"]),
        destructive: flag(&value["destructive"]),
        idempotent: flag(&value["idempotent"]),
        open_world: flag(&value["openWorld"]),
        sandboxed: flag(&value["sandboxed"]),
        executes: flag(&value["executes"]),
    }
}

fn mode(value: &Value) -> PermissionMode {
    match value.as_str() {
        Some("plan") => PermissionMode::Plan,
        Some("acceptEdits") => PermissionMode::AcceptEdits,
        Some("auto") => PermissionMode::Auto,
        _ => PermissionMode::Ask,
    }
}

fn grant(value: &Value) -> Grant {
    Grant {
        tool: value["tool"].as_str().unwrap_or_default().to_string(),
        target: optional(&value["target"]).map(str::to_string),
    }
}

fn grants(value: &Value) -> Vec<Grant> {
    value
        .as_array()
        .map(|items| items.iter().map(grant).collect())
        .unwrap_or_default()
}

/// Grants as the fixtures write them: `target` is present only when the grant has one.
fn grants_json(grants: &[Grant]) -> Value {
    Value::Array(
        grants
            .iter()
            .map(|grant| {
                let mut object = Map::new();
                object.insert("tool".to_string(), json!(grant.tool));
                if let Some(target) = &grant.target {
                    object.insert("target".to_string(), json!(target));
                }
                Value::Object(object)
            })
            .collect(),
    )
}

fn decision_name(decision: Decision) -> &'static str {
    match decision {
        Decision::Allow => "allow",
        Decision::Ask => "ask",
        Decision::Deny => "deny",
    }
}

fn permissions(input: &Value) -> Value {
    let tool = input["tool"].as_str().unwrap_or_default();
    match op(input) {
        "decide" => {
            let grants = grants(&input["grants"]);
            let verdict = decide(&PermissionQuery {
                mode: mode(&input["mode"]),
                tool,
                annotations: annotations(&input["annotations"]),
                target: optional(&input["target"]),
                grants: &grants,
            });
            json!({ "decision": decision_name(verdict.decision), "reason": verdict.reason })
        }
        "grantCovers" => json!(grant_covers(
            &grant(&input["grant"]),
            tool,
            optional(&input["target"])
        )),
        "addGrant" => grants_json(&add_grant(
            &grants(&input["grants"]),
            grant(&input["grant"]),
        )),
        "grantsFor" => grants_json(&grants_for(
            tool,
            optional(&input["target"]),
            annotations(&input["annotations"]),
        )),
        "targetFromArgs" => json!(target_from_args(&input["args"])),
        "refusal" => {
            let verdict = Verdict {
                decision: Decision::Deny,
                reason: input["verdict"]["reason"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            };
            json!(refusal_for(tool, &verdict))
        }
        "denied" => json!(denied_by_user(tool)),
        other => panic!("unknown permissions op {other}"),
    }
}

fn thinking(value: &Value) -> ThinkingMode {
    match value.as_str() {
        Some("low") => ThinkingMode::Low,
        Some("high") => ThinkingMode::High,
        _ => ThinkingMode::Medium,
    }
}

fn web(value: &Value) -> WebMode {
    match value.as_str() {
        Some("on") => WebMode::On,
        Some("off") => WebMode::Off,
        _ => WebMode::Auto,
    }
}

fn prompt_tools(value: &Value) -> Vec<PromptTool> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| PromptTool {
                    name: item["name"].as_str().unwrap_or_default().to_string(),
                    group: item["group"].as_str().unwrap_or_default().to_string(),
                    usage: item["usage"].as_str().unwrap_or_default().to_string(),
                    required: string_list(&item["required"]),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn prompt_skills(value: &Value) -> Vec<PromptSkill> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| PromptSkill {
                    id: item["id"].as_str().unwrap_or_default().to_string(),
                    name: item["name"].as_str().unwrap_or_default().to_string(),
                    description: item["description"].as_str().unwrap_or_default().to_string(),
                    model_invocable: item["modelInvocable"].as_bool(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn prompts(input: &Value) -> Value {
    match op(input) {
        "system" => {
            let settings = PromptSettings {
                thinking_mode: thinking(&input["settings"]["thinkingMode"]),
                web_mode: web(&input["settings"]["webMode"]),
                custom_instructions: string_list(&input["settings"]["customInstructions"]),
            };
            let mode = PromptMode {
                native_tools: flag(&input["mode"]["nativeTools"]),
                native_thinking: flag(&input["mode"]["nativeThinking"]),
                profile: match input["mode"]["profile"].as_str() {
                    Some("full") => Some(PromptProfile::Full),
                    Some("compact") => Some(PromptProfile::Compact),
                    _ => None,
                },
            };
            let environment = PromptEnvironment {
                has_folder: flag(&input["environment"]["hasFolder"]),
                project_root: optional(&input["environment"]["projectRoot"]).map(str::to_string),
                code_execution: flag(&input["environment"]["codeExecution"]),
                library_ready: flag(&input["environment"]["libraryReady"]),
            };
            let tools = prompt_tools(&input["tools"]);
            let memory = match &input["memory"] {
                Value::Null => None,
                memory => Some(ProjectMemory {
                    path: memory["path"].as_str().unwrap_or_default().to_string(),
                    text: memory["text"].as_str().unwrap_or_default().to_string(),
                }),
            };
            let skills = prompt_skills(&input["skills"]);
            json!(build_system_prompt(&SystemPromptInput {
                settings: &settings,
                mode,
                environment: &environment,
                tools: &tools,
                date: input["date"].as_str().unwrap_or_default(),
                memory: memory.as_ref(),
                skills: &skills,
            }))
        }
        "time" => json!(current_time_note(
            input["time"].as_str().unwrap_or_default()
        )),
        "project" => json!(build_project_prompt(
            input["root"].as_str().unwrap_or_default()
        )),
        "voice" => {
            let cues = string_list(&input["cues"]);
            let cues: Vec<&str> = cues.iter().map(String::as_str).collect();
            json!(build_voice_prompt(flag(&input["searchEnabled"]), &cues))
        }
        "voiceSearch" => {
            let first_line = text(input).split('\n').next().unwrap_or_default();
            json!(voice_search_query(first_line))
        }
        other => panic!("unknown prompts op {other}"),
    }
}

fn profile(input: &Value) -> Value {
    let instance = match &input["instance"] {
        Value::Null => None,
        value => Some(InstanceProfile {
            kind: match value["kind"].as_str() {
                Some("local") => InstanceKind::Local,
                Some("account") => InstanceKind::Account,
                _ => InstanceKind::Cloud,
            },
            prompt_profile: match value["promptProfile"].as_str() {
                Some("auto") => Some(ProfileChoice::Auto),
                Some("compact") => Some(ProfileChoice::Compact),
                Some("full") => Some(ProfileChoice::Full),
                _ => None,
            },
        }),
    };
    let listed = match &input["listed"] {
        Value::Null => None,
        value => Some(ListedModel {
            id: value["id"].as_str().unwrap_or_default().to_string(),
            context_length: value["contextLength"].as_u64(),
        }),
    };
    let model = input["model"].as_str().unwrap_or_default();
    match prompt_profile_for(model, instance.as_ref(), listed.as_ref()) {
        PromptProfile::Compact => json!("compact"),
        PromptProfile::Full => json!("full"),
    }
}
