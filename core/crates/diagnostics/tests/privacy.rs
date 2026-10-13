//! Plan §9: a chat turn that goes through the diagnostics writer leaves no prompt, reply, stream text, key,
//! OAuth code, bearer token or file content on disk. Only SHA-256 prefixes, lengths and counts remain.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use draggy_diagnostics::{Clock, Config, Diagnostics, SystemClock};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PROMPT: &str = "Please summarise my confidential merger memo for Acme Holdings";
const REPLY: &str = "The merger closes on the ninth of March for 4.2 million euros";
const CHUNKS: [&str; 4] = [
    "The merger",
    " closes on the",
    " ninth of March",
    " for 4.2 million",
];
/// Fake credentials in the shapes the scrubber recognises.
const API_KEY: &str = "sk-ant-api03-PRIVACYTEST0000000000";
const OAUTH_CODE: &str = "4/0AprivacyTESTcode0001";
const BEARER_TOKEN: &str = "PRIVACYTESTBEARER000000";
const FILE_PATH: &str = "/home/user/letters/landlord-deposit-letter.txt";
const FILE_BODY: &str = "Dear landlord, the deposit for flat 3B is 1200 euros and I want it back.";
const TURN: &str = "turn-7";

// Not covered: error messages. The writer keeps them whole in debug.log, as logger.cjs does, so a call site that
// echoes a prompt into an error text writes it in plaintext. Keep prompts out of error messages.
#[test]
fn a_chat_turn_leaves_only_hashes_lengths_and_counts_on_disk() {
    let dir = tempfile::tempdir().expect("temp dir");
    let logs = dir.path().join("logs");
    let diagnostics = writer(&logs);

    simulate_turn(&diagnostics);
    drop(diagnostics);

    // session.json holds only the session id, its start time, the pid and the clean flag. The checks below still run over it.
    let files = written_files(&logs);
    let names: BTreeSet<String> = files.iter().map(|(name, _)| name.clone()).collect();
    assert_eq!(
        names,
        BTreeSet::from(["app.log", "debug.log", "events.jsonl", "session.json"].map(str::to_owned))
    );

    for (name, text) in &files {
        for secret in [
            PROMPT,
            REPLY,
            API_KEY,
            OAUTH_CODE,
            BEARER_TOKEN,
            FILE_BODY,
            "deposit for flat 3B",
            "4.2 million",
        ] {
            assert!(!text.contains(secret), "{name} holds plaintext {secret:?}");
        }
        for chunk in CHUNKS {
            assert!(
                !text.contains(chunk.trim()),
                "{name} holds stream text {chunk:?}"
            );
        }
        assert_hashes_only(name, text);
    }

    let debug = text_of(&files, "debug.log");
    assert!(
        debug.contains(&prompt_hash(PROMPT)),
        "prompt is not hashed in debug.log"
    );
    assert!(
        debug.contains(&prompt_hash(REPLY)),
        "reply is not hashed in debug.log"
    );
    assert!(
        debug.contains(&prompt_hash(FILE_BODY)),
        "file content is not hashed in debug.log"
    );
    assert!(
        debug.contains("[secret:anthropic-key]"),
        "API key is not replaced"
    );
    assert!(
        debug.contains("[secret:Authorization]"),
        "authorization header is not dropped"
    );
    assert!(
        debug.contains("[secret:query]"),
        "OAuth code in a callback url is not replaced"
    );
    assert!(
        debug.contains(FILE_PATH),
        "file path should stay readable in debug.log"
    );
}

#[test]
fn stream_chunks_are_counted_by_bytes_and_their_text_never_reaches_disk() {
    let dir = tempfile::tempdir().expect("temp dir");
    let logs = dir.path().join("logs");
    let diagnostics = writer(&logs);
    stream(&diagnostics);
    drop(diagnostics);

    let files = written_files(&logs);
    let events: Vec<Value> = text_of(&files, "events.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).expect("events.jsonl line is JSON"))
        .collect();
    let chunk_events: Vec<&Value> = events
        .iter()
        .filter(|event| event["msg"] == "chunk")
        .collect();
    assert_eq!(chunk_events.len(), CHUNKS.len());
    let counted: Vec<u64> = chunk_events
        .iter()
        .map(|event| event["data"]["bytes"].as_u64().unwrap_or_default())
        .collect();
    let expected: Vec<u64> = CHUNKS.iter().map(|chunk| chunk.len() as u64).collect();
    assert_eq!(counted, expected);
}

/// Opens the writer the way the app does: debug everything, app at INFO, a fixed session and pid.
fn writer(logs: &Path) -> Diagnostics {
    let config = Config::from_env(|_| None, "a1b2c3d4", 4242, true, None);
    let clock: Arc<dyn Clock> = Arc::new(SystemClock::default());
    Diagnostics::open(logs, config, clock)
}

fn simulate_turn(diagnostics: &Diagnostics) {
    diagnostics.info(
        "agent",
        "turn start",
        Some(json!({
            "cid": TURN,
            "model": "llama3",
            "prompt": PROMPT,
            "input": { "query": PROMPT },
        })),
    );
    diagnostics.info(
        "engine.llama",
        "request",
        Some(json!({
            "cid": TURN,
            "url": format!("http://127.0.0.1:8080/v1/chat?key={API_KEY}"),
            "headers": { "Authorization": format!("Bearer {BEARER_TOKEN}"), "x-api-key": API_KEY },
            "apiKey": API_KEY,
        })),
    );
    diagnostics.info(
        "mcp.github",
        "sign-in redirect",
        Some(json!({ "cid": TURN, "callback": format!("http://127.0.0.1:53682/callback?code={OAUTH_CODE}&state=abc") })),
    );
    stream(diagnostics);
    diagnostics.info(
        "agent",
        "turn complete",
        Some(json!({
            "cid": TURN,
            "reply": REPLY,
            "messages": [
                { "role": "user", "content": PROMPT },
                { "role": "assistant", "content": [{ "type": "text", "text": REPLY }] },
            ],
        })),
    );
    diagnostics.info(
        "tools",
        "writeFile:start",
        Some(json!({ "cid": TURN, "path": FILE_PATH, "content": FILE_BODY })),
    );
}

/// One line per chunk, by length only, plus one raw chunk under the sensitive key to show the key guard too.
fn stream(diagnostics: &Diagnostics) {
    for chunk in CHUNKS {
        diagnostics.stream_chunk("llama", "chunk", Some(TURN), chunk.as_bytes());
    }
    diagnostics.debug(
        "llama",
        "raw",
        Some(json!({ "cid": TURN, "rawChunk": CHUNKS[0] })),
    );
}

/// Every file the writer produced under `logs`, read as text.
fn written_files(logs: &Path) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut pending: Vec<PathBuf> = vec![logs.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(&path).expect("read log dir").flatten() {
            let child = entry.path();
            if child.is_dir() {
                pending.push(child);
            } else {
                let name = entry.file_name().to_string_lossy().into_owned();
                let text = fs::read_to_string(&child).expect("log file is UTF-8");
                found.push((name, text));
            }
        }
    }
    found.sort();
    found
}

fn text_of<'a>(files: &'a [(String, String)], name: &str) -> &'a str {
    files
        .iter()
        .find(|(file, _)| file == name)
        .map(|(_, text)| text.as_str())
        .unwrap_or_else(|| panic!("{name} was not written"))
}

/// Every `sha256:` in a file is followed by eight hex digits and a closing bracket: no longer value is kept.
fn assert_hashes_only(name: &str, text: &str) {
    for (index, _) in text.match_indices("sha256:") {
        let digits = &text[index + "sha256:".len()..];
        let prefix = digits.get(..8).unwrap_or_default();
        assert!(
            prefix
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
                && digits.as_bytes().get(8) == Some(&b']'),
            "{name}: sha256 marker is not an 8-digit prefix"
        );
    }
}

/// `[N chars, sha256:xxxxxxxx]` as the writer stores it, computed here without the crate's helpers.
fn prompt_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let prefix: String = digest
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let units = text.encode_utf16().count();
    format!("[{units} chars, sha256:{prefix}]")
}
