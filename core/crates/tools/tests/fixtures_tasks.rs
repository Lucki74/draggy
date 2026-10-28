//! Runs the golden fixtures in `shared/fixtures/tools/task-*.json` through the Rust port. The vitest runner in
//! `src/__tests__/fixtures/toolsTasks.test.ts` calls the Electron reference on the same files, so both must agree.

use std::collections::BTreeMap;

use draggy_testkit::{cases, files};
use draggy_tools::task_text::{
    EnvDiff, apply_env_diff, clean_output, clip_with_pointer, env_diff, grep_lines, parse_state,
    slice_since, state_epilogue, supports_state, tail_lines,
};
use serde_json::{Value, json};

#[test]
fn task_fixtures_match_the_electron_reference() {
    for file in files("tools")
        .into_iter()
        .filter(|name| name.starts_with("task-"))
    {
        for case in cases("tools", &file) {
            let name = case["name"].as_str().unwrap_or_default();
            assert_eq!(
                run(&file, &case["input"]),
                case["expected"],
                "{file}: {name}"
            );
        }
    }
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "task-clean.json" => json!(clean_output(input.as_str().unwrap_or_default())),
        "task-clip.json" => clipped(input),
        "task-read.json" => read(input),
        "task-state.json" => state(input),
        other => panic!("no runner for {other}"),
    }
}

fn text<'a>(input: &'a Value, field: &str) -> &'a str {
    input[field].as_str().unwrap_or_default()
}

fn clipped(input: &Value) -> Value {
    let count = input["count"].as_u64().unwrap_or(0) as usize;
    let whole = format!(
        "{}{}{}",
        text(input, "head"),
        text(input, "fill").repeat(count),
        text(input, "tail")
    );
    let result = clip_with_pointer(&whole, input["taskId"].as_str());
    json!({ "text": result.text, "truncated": result.truncated })
}

fn read(input: &Value) -> Value {
    let raw = text(input, "raw");
    match text(input, "op") {
        "since" => {
            let (slice, next) = slice_since(raw, input["since"].as_f64());
            json!({ "text": slice, "next": next })
        }
        "tail" => json!({ "text": tail_lines(raw, input["count"].as_f64().unwrap_or(1.0)) }),
        "grep" => {
            let limit = input["limit"].as_u64().unwrap_or(200) as usize;
            match grep_lines(raw, text(input, "pattern"), limit) {
                Ok(found) => json!({ "text": found.text, "matches": found.matches }),
                Err(error) => json!({ "error": error }),
            }
        }
        other => panic!("no read op {other}"),
    }
}

fn map(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn diff_of(value: &Value) -> EnvDiff {
    EnvDiff {
        set: map(&value["set"]),
        unset: value["unset"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|item| item.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn state(input: &Value) -> Value {
    match text(input, "op") {
        "supports" => json!({ "supported": supports_state(text(input, "shell")) }),
        "epilogue" => {
            json!({ "text": state_epilogue(text(input, "shell"), text(input, "marker")) })
        }
        "diff" => {
            let diff = env_diff(&map(&input["before"]), &map(&input["after"]));
            json!({ "set": diff.set, "unset": diff.unset })
        }
        "apply" => json!(apply_env_diff(
            &map(&input["base"]),
            &diff_of(&input["diff"])
        )),
        "parse" => {
            let (output, state) = parse_state(text(input, "output"), text(input, "marker"));
            let state = state.map(|s| json!({ "cwd": s.cwd, "env": s.env }));
            json!({ "output": output, "state": state })
        }
        other => panic!("no state op {other}"),
    }
}
