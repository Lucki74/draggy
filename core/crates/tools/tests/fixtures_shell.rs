//! Runs the golden fixtures in `shared/fixtures/tools/shell-*.json` through the Rust port. The vitest runner in
//! `src/__tests__/fixtures/toolsShell.test.ts` calls the TypeScript reference on the same files, so both must agree.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use draggy_testkit::{cases, files};
use draggy_tools::shell::{ShellLookup, clip, merge_path, shell_invocation, timeout_for};
use serde_json::{Value, json};

#[test]
fn shell_fixtures_match_the_typescript_reference() {
    for file in files("tools")
        .into_iter()
        .filter(|name| name.starts_with("shell-"))
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
        "shell-invocation.json" => invocation(input),
        "shell-clip.json" => clipped(input),
        "shell-timeout.json" => json!(timeout_for(input.as_f64()).as_millis() as u64),
        "shell-env.json" => {
            json!({ "PATH": merge_path(input["PATH"].as_str().unwrap_or_default()) })
        }
        other => panic!("no runner for {other}"),
    }
}

/// A string field, or the empty string when absent.
fn text<'a>(input: &'a Value, field: &str) -> &'a str {
    input[field].as_str().unwrap_or_default()
}

/// Answers the lookups from the case: the SHELL variable, the files that exist, and the programs on PATH.
struct FixtureLookup {
    shell: Option<PathBuf>,
    existing: BTreeSet<PathBuf>,
    installed: BTreeMap<String, PathBuf>,
}

impl FixtureLookup {
    fn from_case(input: &Value) -> Self {
        let existing = input["existing"]
            .as_array()
            .map(|paths| {
                paths
                    .iter()
                    .filter_map(|path| path.as_str())
                    .map(PathBuf::from)
                    .collect()
            })
            .unwrap_or_default();
        let installed = input["installed"]
            .as_object()
            .map(|map| {
                map.iter()
                    .filter_map(|(name, path)| Some((name.clone(), PathBuf::from(path.as_str()?))))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            shell: input["env"]["SHELL"].as_str().map(PathBuf::from),
            existing,
            installed,
        }
    }
}

impl ShellLookup for FixtureLookup {
    fn user_shell(&self) -> Option<PathBuf> {
        self.shell.clone()
    }

    fn is_file(&self, path: &Path) -> bool {
        self.existing.contains(path)
    }

    fn find(&self, name: &str) -> Option<PathBuf> {
        self.installed.get(name).cloned()
    }
}

fn invocation(input: &Value) -> Value {
    let lookup = FixtureLookup::from_case(input);
    let requested = input["shell"].as_str();
    match shell_invocation(text(input, "command"), requested, &lookup) {
        Ok(found) => json!({
            "shell": found.shell,
            "file": found.file.to_string_lossy(),
            "args": found.args,
        }),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

fn clipped(input: &Value) -> Value {
    let count = input["count"].as_u64().unwrap_or(0) as usize;
    let body = text(input, "fill").repeat(count);
    let whole = format!("{}{body}{}", text(input, "head"), text(input, "tail"));
    let result = clip(&whole);
    json!({ "text": result.text, "truncated": result.truncated })
}
