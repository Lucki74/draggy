//! Runs the recorded MCP sessions in `shared/fixtures/mcp/mcp-session-*.json` through the client. The vitest runner in
//! `src/__tests__/fixtures/mcp-session.test.ts` replays the same inputs through `electron/mcp.cjs`, so both must agree.

mod client_support;

use std::sync::Arc;

use client_support::{Fake, FakeHttp, FakeLauncher, FakeProvisioner, Recorder, Session, ports};
use draggy_mcp::catalogue::missing_requirements;
use draggy_mcp::definition::{ServerConfig, definition_for, is_remote};
use draggy_mcp::lines::{LineBuffer, Parsed, parse_line};
use draggy_mcp::names::{qualified_name, split_qualified_name};
use draggy_mcp::result::{render_tool_result, widget_uri};
use draggy_mcp::server::{CallOptions, Servers};
use draggy_testkit::{cases, files};
use serde_json::{Value, json};

const PREFIX: &str = "mcp-session-";

/// The package the sessions run. It is on disk for every session, so no install is needed.
const MEMORY_PACKAGE: &str = "@modelcontextprotocol/server-memory";

/// Every session file this runner knows. A new file has to be listed here, or the guard below fails.
const KNOWN_FILES: &[&str] = &[
    "mcp-session-definition.json",
    "mcp-session-http.json",
    "mcp-session-lines.json",
    "mcp-session-names.json",
    "mcp-session-results.json",
    "mcp-session-stdio.json",
];

macro_rules! session_tests {
    ($($test:ident => $file:literal),* $(,)?) => {
        $(
            #[test]
            fn $test() {
                check_file($file);
            }
        )*
    };
}

session_tests! {
    definition => "mcp-session-definition.json",
    http => "mcp-session-http.json",
    lines => "mcp-session-lines.json",
    names => "mcp-session-names.json",
    results => "mcp-session-results.json",
    stdio => "mcp-session-stdio.json",
}

#[test]
fn every_session_file_has_a_runner() {
    let found: Vec<String> = files("mcp")
        .into_iter()
        .filter(|file| file.starts_with(PREFIX))
        .collect();
    let known: Vec<String> = KNOWN_FILES.iter().map(|file| (*file).to_owned()).collect();
    assert_eq!(found, known);
}

/// Runs every case of one file and reports all the differences at once, not just the first.
fn check_file(file: &str) {
    let mut failures = Vec::new();
    for case in cases("mcp", file) {
        let name = case["name"].as_str().unwrap_or_default();
        let actual = run(file, &case["input"]);
        if actual != case["expected"] {
            failures.push(format!(
                "{name}\n  expected {}\n  actual   {actual}",
                case["expected"]
            ));
        }
    }
    assert!(failures.is_empty(), "{file}:\n{}", failures.join("\n"));
}

fn run(file: &str, input: &Value) -> Value {
    match file
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.strip_suffix(".json"))
    {
        Some("lines") => run_lines(input),
        Some("results") => run_results(input),
        Some("names") => run_names(input),
        Some("definition") => run_definition(input),
        Some("stdio" | "http") => run_session(input),
        _ => panic!("no runner for {file}"),
    }
}

fn run_lines(input: &Value) -> Value {
    let mut buffer = LineBuffer::default();
    let mut messages = Vec::new();
    for chunk in input["chunks"].as_array().into_iter().flatten() {
        for line in buffer.push(chunk.as_str().unwrap_or_default()) {
            if let Parsed::Message { value, .. } = parse_line(&line) {
                messages.push(value);
            }
        }
    }
    json!({ "messages": messages })
}

fn run_results(input: &Value) -> Value {
    let result = &input["result"];
    match input["op"].as_str() {
        Some("render") => json!(render_tool_result(result)),
        Some("widget") => json!(widget_uri(result)),
        other => panic!("unknown results op {other:?}"),
    }
}

fn run_names(input: &Value) -> Value {
    match input["op"].as_str() {
        Some("qualified") => json!(qualified_name(
            input["server"].as_str().unwrap_or_default(),
            input["tool"].as_str().unwrap_or_default(),
        )),
        Some("split") => match split_qualified_name(input["name"].as_str().unwrap_or_default()) {
            Some(split) => json!({"serverId": split.server_id, "toolName": split.tool_name}),
            None => Value::Null,
        },
        other => panic!("unknown names op {other:?}"),
    }
}

fn run_definition(input: &Value) -> Value {
    let id = input["id"].as_str().unwrap_or_default();
    let config = config_of(&input["config"]);
    let definition = definition_for(id, &config);
    let requirements = definition
        .as_ref()
        .map(|definition| definition.requirements());
    let missing = missing_requirements(requirements.as_ref(), &config.catalogue_config());
    json!({
        "definition": definition,
        "remote": is_remote(id, &config),
        "missing": missing,
    })
}

/// Expands `{"repeat": text, "count": n}` into the text repeated `n` times, so a fixture can hold a long value.
fn expand_repeats(value: &Value) -> Value {
    match value {
        Value::Object(map)
            if map.len() == 2 && map.contains_key("repeat") && map.contains_key("count") =>
        {
            let text = map["repeat"].as_str().unwrap_or_default();
            let count = map["count"].as_u64().unwrap_or(0);
            Value::String(text.repeat(usize::try_from(count).unwrap_or(0)))
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), expand_repeats(item)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(expand_repeats).collect()),
        other => other.clone(),
    }
}

/// Runs a stdio or HTTP session: the ops in order, with each start taking the next scripted session.
/// A case with `"npm": false` runs where no npm can be found.
fn run_session(raw: &Value) -> Value {
    let input = &expand_repeats(raw);
    // Paused time lets the client's timers fire the moment nothing else is happening, so a silent server costs no wait.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .unwrap_or_else(|error| panic!("cannot start a runtime: {error}"));

    runtime.block_on(async {
        let sessions: Vec<Session> = input["sessions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(Session::from_json)
            .collect();
        let fake = Fake::new(sessions);
        let recorder = Arc::new(Recorder::default());
        let provisioner =
            FakeProvisioner::new(true, input["npm"] != Value::Bool(false), &[MEMORY_PACKAGE]);
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            recorder.clone(),
            ports(provisioner),
        );

        let mut results = Vec::new();
        for op in input["ops"].as_array().into_iter().flatten() {
            results.push(apply(&mut servers, &fake, op).await);
        }

        json!({
            "results": results,
            "wire": fake.wire(),
            "logs": recorder.lines().into_iter().map(normalise_log).collect::<Vec<_>>(),
        })
    })
}

async fn apply(servers: &mut Servers<FakeHttp, FakeLauncher>, fake: &Fake, op: &Value) -> Value {
    let id = op["id"].as_str().unwrap_or_default();
    match op["op"].as_str() {
        Some("start") => {
            fake.begin_session();
            to_value(servers.start(id, &config_of(&op["config"])).await)
        }
        Some("restart") => {
            fake.begin_session();
            to_value(servers.restart(id, &config_of(&op["config"])).await)
        }
        Some("stop") => json!({"success": servers.stop(id).await}),
        Some("stopAll") => {
            servers.stop_all().await;
            Value::Null
        }
        Some("list") => to_value(servers.list()),
        Some("call") => {
            let options = CallOptions {
                cid: op["cid"].as_str().map(str::to_owned),
                widgets: op["widgets"].as_bool().unwrap_or(true),
            };
            let outcome = servers
                .call_tool(
                    op["server"].as_str().unwrap_or_default(),
                    op["tool"].as_str().unwrap_or_default(),
                    op["args"].clone(),
                    &options,
                )
                .await;
            to_value(outcome)
        }
        other => panic!("unknown session op {other:?}"),
    }
}

fn config_of(value: &Value) -> ServerConfig {
    match value {
        Value::Null => ServerConfig::default(),
        present => serde_json::from_value(present.clone())
            .unwrap_or_else(|error| panic!("bad config {present}: {error}")),
    }
}

fn to_value<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap_or_else(|error| panic!("cannot encode: {error}"))
}

/// Drops the durations, which vary from run to run. Everything else in a log line is compared exactly.
fn normalise_log(mut line: Value) -> Value {
    if let Some(data) = line.get_mut("data").and_then(Value::as_object_mut) {
        data.remove("durMs");
    }
    line
}
