//! The `agy` route against a stand-in CLI that prints the stream-json events.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;

use std::sync::Arc;

use draggy_core::{
    AgyAccount, AgyConfigRecord, CancelToken, CoreError, Session, SessionConfig, TurnEventRecord,
    TurnObserver,
};

const OK: &str = r#"#!/bin/sh
case "$1" in
  --version) echo "agy 1.2.3"; exit 0 ;;
  --help) echo "  --output-format stream-json"; exit 0 ;;
  models) echo "gemini-3-pro  Gemini 3 Pro"; exit 0 ;;
esac
echo '{"event":"init","permission_mode":"request-review","tools":[]}'
echo '{"event":"step_update","step_type":"agent_response","text_delta":"he"}'
echo '{"event":"step_update","step_type":"agent_response","text_delta":"llo"}'
echo '{"event":"result","status":"SUCCESS","usage":{"input_tokens":4,"output_tokens":2}}'
"#;

const UNSAFE: &str = r#"#!/bin/sh
case "$1" in
  --version) echo "agy 1"; exit 0 ;;
  --help) echo "--output-format stream-json"; exit 0 ;;
esac
echo '{"event":"init","permission_mode":"bypass","tools":[]}'
echo '{"event":"step_update","step_type":"agent_response","text_delta":"nope"}'
sleep 5
"#;

fn script(dir: &std::path::Path, body: &str) -> String {
    let path = dir.join("agy");
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.to_string_lossy().into_owned()
}

struct Quiet;

impl TurnObserver for Quiet {
    fn on_events(&self, _events: Vec<TurnEventRecord>) {}
}

fn config(binary: String, work: &std::path::Path) -> SessionConfig {
    SessionConfig {
        base_url: String::new(),
        model: String::new(),
        api_key: None,
        folder: None,
        context_tokens: None,
        loop_limit: None,
        allow_commands: false,
        permission_mode: None,
        web: None,
        agy: Some(AgyConfigRecord {
            binary,
            model: String::new(),
            work_dir: work.to_string_lossy().into_owned(),
        }),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn signing_in_proves_the_account_and_lists_models() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(dir.path(), OK);
    // Only this test reads the variable, so nothing else races on it.
    #[allow(unsafe_code)]
    unsafe {
        std::env::set_var("DRAGGY_AGY_PATH", &binary)
    };
    let account = AgyAccount::new(dir.path().join("state").to_string_lossy().into_owned());
    assert!(matches!(
        account.sign_in(false).await,
        Err(CoreError::Invalid { .. })
    ));
    let status = account.sign_in(true).await.unwrap();
    assert!(status.signed_in && status.acknowledged);
    assert_eq!(status.version.as_deref(), Some("agy 1.2.3"));
    assert_eq!(account.models().await.unwrap(), vec!["gemini-3-pro"]);
    let out = account.sign_out().unwrap();
    assert!(out.acknowledged && !out.signed_in);
}

/// The session owns a runtime, so it must be made and dropped outside an async context.
fn turn(script_text: &str) -> Result<draggy_core::TurnOutcome, CoreError> {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(dir.path(), script_text);
    let session = Session::new(config(binary, &dir.path().join("cwd"))).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(session.send("hi".to_owned(), Arc::new(Quiet), None, CancelToken::new()))
}

#[test]
fn a_chat_turn_streams_the_cli_text() {
    assert_eq!(turn(OK).unwrap().content, "hello");
}

#[test]
fn a_cli_that_skips_permissions_is_refused() {
    let shown = match turn(UNSAFE) {
        Ok(out) => out.content,
        Err(error) => error.to_string(),
    };
    assert!(
        shown.contains("permissions") || shown.contains("asking"),
        "{shown}"
    );
}
