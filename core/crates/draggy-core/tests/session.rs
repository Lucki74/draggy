//! A session against a scripted OpenAI-compatible server on loopback: the real client, decoder, agent loop and file
//! tools, with nothing on the network beyond 127.0.0.1.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use draggy_core::{
    ApprovalChoice, ApprovalHandler, ApprovalRecord, CancelToken, CoreError, McpManager,
    McpServerConfigRecord, MessageRecord, PermissionModeRecord, Session, SessionConfig,
    TurnEventRecord, TurnObserver, TurnOutcome, WebConfigRecord,
};
use serde_json::{Value, json};

/// One scripted answer: the SSE lines to send, and whether to pause between them.
struct Reply {
    lines: Vec<String>,
    pause: Duration,
}

fn data(value: &Value) -> String {
    format!("data: {value}\n\n")
}

fn text_reply(pieces: &[&str]) -> Reply {
    let mut lines: Vec<String> = pieces
        .iter()
        .map(|piece| data(&json!({"choices": [{"delta": {"content": piece}}]})))
        .collect();
    lines.push(data(
        &json!({"choices": [{"delta": {}, "finish_reason": "stop"}]}),
    ));
    lines.push(data(
        &json!({"choices": [], "usage": {"prompt_tokens": 50, "completion_tokens": 7}}),
    ));
    lines.push("data: [DONE]\n\n".to_owned());
    Reply {
        lines,
        pause: Duration::ZERO,
    }
}

fn tool_reply(name: &str, arguments: &str) -> Reply {
    let call = json!({"choices": [{"delta": {"tool_calls": [{
        "index": 0, "id": "call_1", "type": "function",
        "function": {"name": name, "arguments": arguments}
    }]}}]});
    Reply {
        lines: vec![
            data(&call),
            data(&json!({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]})),
            data(&json!({"choices": [], "usage": {"prompt_tokens": 40, "completion_tokens": 5}})),
            "data: [DONE]\n\n".to_owned(),
        ],
        pause: Duration::ZERO,
    }
}

struct Server {
    url: String,
    bodies: Arc<Mutex<Vec<Value>>>,
}

fn read_request(stream: &mut TcpStream) -> Option<Value> {
    let mut reader = BufReader::new(&mut *stream);
    let mut length = 0_usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().ok()?;
        }
    }
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

fn serve(replies: Vec<Reply>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let url = format!("http://{}/v1", listener.local_addr().expect("address"));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&bodies);
    thread::spawn(move || {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            if let Some(body) = read_request(&mut stream) {
                seen.lock().expect("bodies").push(body);
            }
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                continue;
            }
            for line in reply.lines {
                if stream.write_all(line.as_bytes()).is_err() || stream.flush().is_err() {
                    break;
                }
                thread::sleep(reply.pause);
            }
        }
    });
    Server { url, bodies }
}

#[derive(Default)]
struct Recorder {
    batches: Mutex<Vec<Vec<TurnEventRecord>>>,
}

impl TurnObserver for Recorder {
    fn on_events(&self, events: Vec<TurnEventRecord>) {
        self.batches.lock().expect("batches").push(events);
    }
}

fn config(url: &str, folder: Option<&std::path::Path>) -> SessionConfig {
    SessionConfig {
        base_url: url.to_owned(),
        model: "test-model".to_owned(),
        api_key: None,
        folder: folder.map(|path| path.display().to_string()),
        context_tokens: Some(4096),
        loop_limit: Some(6),
        allow_commands: false,
        permission_mode: None,
        web: None,
        agy: None,
        skills_dir: None,
    }
}

fn command_config(
    url: &str,
    folder: &std::path::Path,
    mode: Option<PermissionModeRecord>,
) -> SessionConfig {
    SessionConfig {
        allow_commands: true,
        permission_mode: mode,
        web: None,
        agy: None,
        skills_dir: None,
        ..config(url, Some(folder))
    }
}

/// Answers every approval the same way and keeps what it was asked.
struct Scripted {
    choice: ApprovalChoice,
    asked: Mutex<Vec<ApprovalRecord>>,
}

impl Scripted {
    fn new(choice: ApprovalChoice) -> Arc<Self> {
        Arc::new(Self {
            choice,
            asked: Mutex::new(Vec::new()),
        })
    }

    fn count(&self) -> usize {
        self.asked.lock().expect("asked").len()
    }
}

impl ApprovalHandler for Scripted {
    fn ask(&self, request: ApprovalRecord) -> ApprovalChoice {
        self.asked.lock().expect("asked").push(request);
        self.choice
    }
}

fn run(session: &Arc<Session>, text: &str, recorder: &Arc<Recorder>) -> TurnOutcome {
    run_asking(session, text, recorder, None)
}

fn run_asking(
    session: &Arc<Session>,
    text: &str,
    recorder: &Arc<Recorder>,
    approvals: Option<Arc<dyn ApprovalHandler>>,
) -> TurnOutcome {
    let observer: Arc<dyn TurnObserver> = recorder.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("runtime");
    runtime
        .block_on(Arc::clone(session).send(
            text.to_owned(),
            observer,
            approvals,
            CancelToken::new(),
        ))
        .expect("turn")
}

#[test]
fn a_plain_reply_streams_to_the_observer_and_lands_in_the_conversation() {
    let server = serve(vec![text_reply(&["Hello", " there"])]);
    let session = Session::new(config(&server.url, None)).expect("session");
    let recorder = Arc::new(Recorder::default());

    let outcome = run(&session, "Say hello", &recorder);

    assert_eq!(outcome.text_content, "Hello there");
    assert!(!outcome.aborted);
    assert_eq!(outcome.loops, 1);
    let batches = recorder.batches.lock().expect("batches");
    let last_patch = batches
        .iter()
        .flatten()
        .filter_map(|event| match event {
            TurnEventRecord::Patch { text_content, .. } => Some(text_content.clone()),
            _ => None,
        })
        .next_back();
    assert_eq!(last_patch.as_deref(), Some("Hello there"));
    let messages = session.messages();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");

    let bodies = server.bodies.lock().expect("bodies");
    assert_eq!(bodies[0]["model"], "test-model");
    assert_eq!(bodies[0]["stream"], true);
}

#[test]
fn a_tool_call_reads_a_file_inside_the_folder_and_the_model_sees_the_result() {
    let folder = tempfile::tempdir().expect("folder");
    std::fs::write(folder.path().join("notes.txt"), "the secret word is plum").expect("write");
    let server = serve(vec![
        tool_reply("read_file", r#"{"path": "notes.txt"}"#),
        text_reply(&["It says plum."]),
    ]);
    let session = Session::new(config(&server.url, Some(folder.path()))).expect("session");
    let recorder = Arc::new(Recorder::default());

    let outcome = run(&session, "What is in notes.txt?", &recorder);

    assert_eq!(outcome.text_content, "It says plum.");
    assert_eq!(outcome.tool_calls.get("read_file"), Some(&1));
    assert_eq!(outcome.loops, 2);
    assert!(outcome.steps.iter().any(|step| step.kind == "reading"));

    let bodies = server.bodies.lock().expect("bodies");
    assert!(
        bodies[0]["tools"].is_array(),
        "the first pass offers the tools"
    );
    let second = bodies[1]["messages"].to_string();
    assert!(second.contains("the secret word is plum"), "{second}");
}

#[test]
fn a_document_tool_call_writes_a_docx_inside_the_folder() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        tool_reply(
            "write_document",
            r#"{"path": "out/report.docx", "content": "<h1>Report</h1><p>Hello</p>"}"#,
        ),
        text_reply(&["Saved."]),
    ]);
    let session = Session::new(config(&server.url, Some(folder.path()))).expect("session");
    let recorder = Arc::new(Recorder::default());

    let handler = Scripted::new(ApprovalChoice::Once);

    let outcome = run_asking(&session, "Write a report", &recorder, Some(handler));

    assert_eq!(outcome.tool_calls.get("write_document"), Some(&1));
    let bytes = std::fs::read(folder.path().join("out").join("report.docx")).expect("docx");
    assert_eq!(&bytes[..2], b"PK");
}

#[test]
fn a_document_tool_call_refuses_other_extensions_and_paths_outside_the_folder() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        tool_reply("write_document", r#"{"path": "run.exe", "content": "x"}"#),
        tool_reply(
            "write_document",
            r#"{"path": "../escape.docx", "content": "x"}"#,
        ),
        text_reply(&["Refused."]),
    ]);
    let session = Session::new(config(&server.url, Some(folder.path()))).expect("session");
    let recorder = Arc::new(Recorder::default());

    let handler = Scripted::new(ApprovalChoice::Once);

    run_asking(&session, "Write files", &recorder, Some(handler));

    assert!(!folder.path().join("run.exe").exists());
    assert!(
        !folder
            .path()
            .parent()
            .expect("parent")
            .join("escape.docx")
            .exists()
    );
}

#[test]
fn restored_messages_reach_the_model_and_new_ids_do_not_collide() {
    let server = serve(vec![text_reply(&["Fine"])]);
    let session = Session::new(config(&server.url, None)).expect("session");
    let saved = vec![
        MessageRecord {
            id: "m1".to_owned(),
            role: "user".to_owned(),
            content: "Earlier question".to_owned(),
        },
        MessageRecord {
            id: "m2".to_owned(),
            role: "assistant".to_owned(),
            content: "Earlier answer".to_owned(),
        },
    ];
    session.restore(saved).expect("restore");

    run(&session, "Next question", &Arc::new(Recorder::default()));

    let messages = session.messages();
    let ids: Vec<&str> = messages.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["m1", "m2", "m3", "m4"]);
    let bodies = server.bodies.lock().expect("bodies");
    let sent = bodies[0]["messages"].to_string();
    assert!(sent.contains("Earlier question") && sent.contains("Earlier answer"));
}

#[test]
fn restoring_a_message_with_another_role_is_refused() {
    let session = Session::new(config("http://127.0.0.1:1/v1", None)).expect("session");
    let result = session.restore(vec![MessageRecord {
        id: "m1".to_owned(),
        role: "system".to_owned(),
        content: "x".to_owned(),
    }]);
    assert!(matches!(result, Err(CoreError::Invalid { .. })));
    assert!(session.messages().is_empty());
}

#[test]
fn a_file_outside_the_folder_is_refused() {
    let outer = tempfile::tempdir().expect("outer");
    let folder = outer.path().join("project");
    std::fs::create_dir(&folder).expect("project");
    std::fs::write(outer.path().join("outside.txt"), "private words").expect("write");
    let server = serve(vec![
        tool_reply("read_file", r#"{"path": "../outside.txt"}"#),
        text_reply(&["No."]),
    ]);
    let session = Session::new(config(&server.url, Some(&folder))).expect("session");
    let recorder = Arc::new(Recorder::default());

    run(&session, "Read ../outside.txt", &recorder);

    let bodies = server.bodies.lock().expect("bodies");
    let second = bodies[1]["messages"].to_string();
    assert!(second.contains("TOOL RESULT (read_file)"), "{second}");
    assert!(!second.contains("private words"), "{second}");
}

#[test]
fn the_web_tools_are_offered_only_when_the_web_is_on() {
    let server = serve(vec![text_reply(&["a"]), text_reply(&["b"])]);
    let recorder = Arc::new(Recorder::default());
    let off = Session::new(config(&server.url, None)).expect("session");
    run(&off, "hi", &recorder);
    let on = Session::new(SessionConfig {
        web: Some(WebConfigRecord::default()),
        ..config(&server.url, None)
    })
    .expect("session");
    run(&on, "hi", &recorder);

    let bodies = server.bodies.lock().expect("bodies");
    let names_in = |body: &Value| -> Vec<String> {
        body["tools"]
            .as_array()
            .expect("tools")
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap_or("").to_owned())
            .collect()
    };
    assert_eq!(names_in(&bodies[0]), ["update_plan"]);
    assert_eq!(
        names_in(&bodies[1]),
        ["search_web", "read_url", "update_plan"]
    );
}

#[test]
fn read_url_refuses_a_local_address_and_says_why() {
    let server = serve(vec![
        tool_reply("read_url", r#"{"url": "http://127.0.0.1:1/secret"}"#),
        text_reply(&["No."]),
    ]);
    let session = Session::new(SessionConfig {
        web: Some(WebConfigRecord::default()),
        ..config(&server.url, None)
    })
    .expect("session");
    let recorder = Arc::new(Recorder::default());

    let outcome = run(&session, "Read it", &recorder);

    assert_eq!(outcome.tool_calls.get("read_url"), Some(&1));
    let bodies = server.bodies.lock().expect("bodies");
    let second = bodies[1]["messages"].to_string();
    assert!(second.contains("TOOL RESULT (read_url)"), "{second}");
    assert!(
        second.contains("Refused") || second.contains("local"),
        "{second}"
    );
}

#[test]
fn cancelling_stops_the_turn_and_marks_it_aborted() {
    let mut reply = text_reply(&["one ", "two ", "three ", "four ", "five "]);
    reply.pause = Duration::from_millis(150);
    let server = serve(vec![reply]);
    let session = Session::new(config(&server.url, None)).expect("session");
    let recorder = Arc::new(Recorder::default());
    let cancel = CancelToken::new();
    let stopper = Arc::clone(&cancel);
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        stopper.cancel();
    });

    let observer: Arc<dyn TurnObserver> = recorder.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("runtime");
    let outcome = runtime
        .block_on(Arc::clone(&session).send("Count".to_owned(), observer, None, cancel))
        .expect("turn");

    assert!(outcome.aborted);
    assert!(!outcome.text_content.contains("five"));
}

#[test]
fn a_server_error_reaches_the_shell_as_a_model_error() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let url = format!("http://{}/v1", listener.local_addr().expect("address"));
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            read_request(&mut stream);
            let body = r#"{"error":{"message":"model not loaded"}}"#;
            let reply = format!(
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            drop(stream.write_all(reply.as_bytes()));
        }
    });
    let session = Session::new(config(&url, None)).expect("session");
    let observer: Arc<dyn TurnObserver> = Arc::new(Recorder::default());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("runtime");

    let error = runtime
        .block_on(session.send("Hi".to_owned(), observer, None, CancelToken::new()))
        .expect_err("a 503 fails the turn");

    match error {
        CoreError::Model { message } => assert!(message.contains("503"), "{message}"),
        other => panic!("expected a model error, got {other:?}"),
    }
}

#[test]
fn a_session_needs_an_address_and_a_model() {
    let mut empty = config("", None);
    assert!(matches!(
        Session::new(empty.clone()),
        Err(CoreError::Invalid { .. })
    ));
    empty.base_url = "http://127.0.0.1:1/v1".to_owned();
    empty.model = String::new();
    assert!(matches!(
        Session::new(empty),
        Err(CoreError::Invalid { .. })
    ));
}

fn command_reply(command: &str) -> Reply {
    tool_reply(
        "run_command",
        &serde_json::json!({ "command": command }).to_string(),
    )
}

#[test]
fn commands_are_not_offered_unless_the_session_allows_them() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Done."]),
    ]);
    let session = Session::new(config(&server.url, Some(folder.path()))).expect("session");
    let recorder = Arc::new(Recorder::default());

    run(&session, "Run it", &recorder);

    let bodies = server.bodies.lock().expect("bodies");
    assert!(
        !bodies[0]["tools"].to_string().contains("run_command"),
        "{}",
        bodies[0]["tools"]
    );
    let second = bodies[1]["messages"].to_string();
    assert!(second.contains("TOOL RESULT (run_command)"), "{second}");
    assert!(!folder.path().join("made.txt").exists());
}

#[cfg(unix)]
#[test]
fn an_approved_command_runs_and_the_model_reads_its_output() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo draggy-ran-this"),
        text_reply(&["It printed the words."]),
    ]);
    let session = Session::new(command_config(&server.url, folder.path(), None)).expect("session");
    let recorder = Arc::new(Recorder::default());
    let handler = Scripted::new(ApprovalChoice::Once);

    let outcome = run_asking(&session, "Say it", &recorder, Some(handler.clone()));

    assert_eq!(outcome.tool_calls.get("run_command"), Some(&1));
    assert_eq!(handler.count(), 1);
    let asked = handler.asked.lock().expect("asked");
    assert_eq!(asked[0].tool, "run_command");
    assert!(
        asked[0].target.as_deref().unwrap_or("").contains("echo"),
        "{:?}",
        asked[0]
    );
    drop(asked);
    let bodies = server.bodies.lock().expect("bodies");
    let second = bodies[1]["messages"].to_string();
    assert!(second.contains("TOOL RESULT (run_command)"), "{second}");
    assert!(second.contains("draggy-ran-this"), "{second}");
    assert!(second.contains("Exit code 0"), "{second}");
}

#[test]
fn a_refused_command_does_not_run() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Understood."]),
    ]);
    let session = Session::new(command_config(&server.url, folder.path(), None)).expect("session");
    let recorder = Arc::new(Recorder::default());
    let handler = Scripted::new(ApprovalChoice::No);

    run_asking(&session, "Make it", &recorder, Some(handler.clone()));

    assert_eq!(handler.count(), 1);
    assert!(!folder.path().join("made.txt").exists());
}

#[test]
fn a_command_that_needs_an_answer_is_refused_when_nobody_can_give_one() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Understood."]),
    ]);
    let session = Session::new(command_config(&server.url, folder.path(), None)).expect("session");
    let recorder = Arc::new(Recorder::default());

    run(&session, "Make it", &recorder);

    assert!(!folder.path().join("made.txt").exists());
}

#[test]
fn plan_mode_refuses_commands_without_asking() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Understood."]),
    ]);
    let session = Session::new(command_config(
        &server.url,
        folder.path(),
        Some(PermissionModeRecord::Plan),
    ))
    .expect("session");
    let recorder = Arc::new(Recorder::default());
    let handler = Scripted::new(ApprovalChoice::Once);

    run_asking(&session, "Make it", &recorder, Some(handler.clone()));

    assert_eq!(handler.count(), 0);
    assert!(!folder.path().join("made.txt").exists());
}

#[cfg(unix)]
#[test]
fn auto_mode_runs_commands_without_asking() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Made."]),
    ]);
    let session = Session::new(command_config(
        &server.url,
        folder.path(),
        Some(PermissionModeRecord::Auto),
    ))
    .expect("session");
    let recorder = Arc::new(Recorder::default());

    run(&session, "Make it", &recorder);

    assert!(folder.path().join("made.txt").exists());
}

#[cfg(unix)]
#[test]
fn a_session_wide_grant_covers_the_same_command_in_a_later_turn() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo again"),
        text_reply(&["First."]),
        command_reply("echo again"),
        text_reply(&["Second."]),
    ]);
    let session = Session::new(command_config(&server.url, folder.path(), None)).expect("session");
    let recorder = Arc::new(Recorder::default());
    let handler = Scripted::new(ApprovalChoice::Workspace);

    run_asking(&session, "Once", &recorder, Some(handler.clone()));
    run_asking(&session, "Twice", &recorder, Some(handler.clone()));

    assert_eq!(handler.count(), 1, "the second turn was not asked again");
    let bodies = server.bodies.lock().expect("bodies");
    assert!(bodies[3]["messages"].to_string().contains("Exit code 0"));
}

#[cfg(unix)]
#[test]
fn cancelling_stops_a_running_command() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![command_reply("sleep 30"), text_reply(&["Stopped."])]);
    let session = Session::new(command_config(
        &server.url,
        folder.path(),
        Some(PermissionModeRecord::Auto),
    ))
    .expect("session");
    let recorder = Arc::new(Recorder::default());
    let cancel = CancelToken::new();
    let stopper = Arc::clone(&cancel);
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        stopper.cancel();
    });

    let observer: Arc<dyn TurnObserver> = recorder.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("runtime");
    let started = std::time::Instant::now();
    let outcome = runtime
        .block_on(Arc::clone(&session).send("Wait".to_owned(), observer, None, cancel))
        .expect("turn");

    assert!(outcome.aborted);
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "the command was left running"
    );
}

/// Blocks until released, the way a dialog the user has not answered yet would.
struct Waiting {
    release: Mutex<bool>,
    seen: Mutex<bool>,
}

impl ApprovalHandler for Waiting {
    fn ask(&self, _request: ApprovalRecord) -> ApprovalChoice {
        *self.seen.lock().expect("seen") = true;
        while !*self.release.lock().expect("release") {
            thread::sleep(Duration::from_millis(20));
        }
        ApprovalChoice::Once
    }
}

#[test]
fn stopping_the_turn_does_not_wait_for_an_unanswered_approval_and_the_command_never_runs() {
    let folder = tempfile::tempdir().expect("folder");
    let server = serve(vec![
        command_reply("echo x > made.txt"),
        text_reply(&["Never sent."]),
    ]);
    let session = Session::new(command_config(&server.url, folder.path(), None)).expect("session");
    let recorder = Arc::new(Recorder::default());
    let waiting = Arc::new(Waiting {
        release: Mutex::new(false),
        seen: Mutex::new(false),
    });
    let cancel = CancelToken::new();
    let (stopper, watcher) = (Arc::clone(&cancel), Arc::clone(&waiting));
    thread::spawn(move || {
        while !*watcher.seen.lock().expect("seen") {
            thread::sleep(Duration::from_millis(10));
        }
        stopper.cancel();
    });

    let observer: Arc<dyn TurnObserver> = recorder.clone();
    let approvals: Arc<dyn ApprovalHandler> = waiting.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("runtime");
    let outcome = runtime
        .block_on(Arc::clone(&session).send(
            "Make it".to_owned(),
            observer,
            Some(approvals),
            cancel,
        ))
        .expect("turn");
    // The user answers "yes" after the stop; it must not run anything now.
    *waiting.release.lock().expect("release") = true;
    thread::sleep(Duration::from_millis(100));

    assert!(outcome.aborted);
    assert!(!folder.path().join("made.txt").exists());
}

fn serve_mcp() -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("address");
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&bodies);

    thread::spawn(move || {
        while let Ok((mut stream, _)) = listener.accept() {
            let Some(req) = read_request(&mut stream) else {
                continue;
            };
            seen.lock().expect("bodies").push(req.clone());

            let method = req.get("method").and_then(Value::as_str).unwrap_or("");
            let id = req.get("id").cloned().unwrap_or(json!(1));

            let res = match method {
                "initialize" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "test-mcp", "version": "1.0.0"}
                    }
                }),
                "notifications/initialized" => json!({}),
                "tools/list" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "echo",
                                "description": "Echoes text.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {"msg": {"type": "string"}},
                                    "required": ["msg"]
                                },
                                "annotations": {
                                    "readOnlyHint": true,
                                    "destructiveHint": false
                                }
                            }
                        ]
                    }
                }),
                "tools/call" => {
                    let msg = req
                        .get("params")
                        .and_then(|p| p.get("arguments"))
                        .and_then(|a| a.get("msg"))
                        .and_then(Value::as_str)
                        .unwrap_or("default");
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [
                                {"type": "text", "text": format!("mcp says {msg}")}
                            ]
                        }
                    })
                }
                _ => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
            };

            let body_str = serde_json::to_string(&res).unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
                body_str.len(),
                body_str
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            let _ = stream.shutdown(std::net::Shutdown::Write);
            let mut discard = [0u8; 128];
            while let Ok(n) = stream.read(&mut discard) {
                if n == 0 {
                    break;
                }
            }
        }
    });

    Server {
        url: format!("http://{address}"),
        bodies,
    }
}

#[test]
fn a_session_with_mcp_runs_normally_when_no_mcp_servers_are_active() {
    let server = serve(vec![text_reply(&["Hello from session."])]);
    let mcp = McpManager::new(None, None).expect("manager");
    let session = Session::with_mcp(config(&server.url, None), mcp).expect("session");
    let recorder = Arc::new(Recorder::default());

    let outcome = run(&session, "Hi", &recorder);
    assert_eq!(outcome.text_content, "Hello from session.");

    let bodies = server.bodies.lock().expect("bodies");
    let tools = bodies[0]["tools"].as_array().expect("tools");
    assert_eq!(tools.len(), 1, "only update_plan is offered");
}

#[test]
fn a_session_with_mcp_offers_server_tools_and_runs_them() {
    let mcp_server = serve_mcp();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let manager = McpManager::new(None, None).expect("manager");

    runtime.block_on(async {
        let state = manager
            .start(
                "test_srv".to_owned(),
                Some(McpServerConfigRecord {
                    url: Some(mcp_server.url.clone()),
                    ..Default::default()
                }),
            )
            .await;
        if state.status != "ready" {
            println!("seen requests: {:?}", mcp_server.bodies.lock().unwrap());
            panic!(
                "state.status was {} with error {:?}",
                state.status, state.error
            );
        }
        assert_eq!(state.tools.len(), 1);
        assert_eq!(state.tools[0].qualified_name, "test_srv__echo");
    });

    let open_ai_server = serve(vec![
        tool_reply("test_srv__echo", "{\"msg\": \"banana\"}"),
        text_reply(&["The echoed answer is banana."]),
    ]);

    let session = Session::with_mcp(config(&open_ai_server.url, None), manager).expect("session");
    let recorder = Arc::new(Recorder::default());

    let outcome = run(&session, "Echo banana please", &recorder);
    assert_eq!(outcome.text_content, "The echoed answer is banana.");
    assert_eq!(outcome.tool_calls.get("test_srv__echo"), Some(&1));

    let bodies = open_ai_server.bodies.lock().expect("bodies");
    assert!(bodies[0]["tools"].to_string().contains("test_srv__echo"));
    let second_pass_messages = bodies[1]["messages"].to_string();
    assert!(second_pass_messages.contains("mcp says banana"));
}

#[test]
fn a_picture_goes_to_the_model_as_an_image_part() {
    let server = serve(vec![text_reply(&["Seen"])]);
    let session = Session::new(config(&server.url, None)).expect("session");
    let observer: Arc<dyn TurnObserver> = Arc::new(Recorder::default());
    let image = draggy_core::ImageRecord {
        name: "dot.png".to_owned(),
        mime: "image/png".to_owned(),
        data: vec![0x89, b'P', b'N', b'G'],
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("runtime");

    let outcome = runtime
        .block_on(Arc::clone(&session).send_with_images(
            "What is this".to_owned(),
            vec![image],
            observer,
            None,
            CancelToken::new(),
        ))
        .expect("turn");

    assert_eq!(outcome.text_content, "Seen");
    let bodies = server.bodies.lock().expect("bodies");
    let sent = bodies[0].to_string();
    assert!(sent.contains("data:image/png;base64,iVBORw=="), "{sent}");
}

#[test]
fn the_plan_the_model_writes_is_kept_and_can_be_cleared() {
    let server = serve(vec![
        tool_reply(
            "update_plan",
            r#"{"steps":"[x] Read it\n[>] Fix it\n[ ] Test it"}"#,
        ),
        text_reply(&["Done"]),
    ]);
    let session = Session::new(config(&server.url, None)).expect("session");
    assert!(session.plan().is_empty());

    run(&session, "Fix the bug", &Arc::new(Recorder::default()));

    let steps: Vec<(String, String)> = session
        .plan()
        .into_iter()
        .map(|step| (step.text, step.status))
        .collect();
    assert_eq!(
        steps,
        [
            ("Read it".to_owned(), "done".to_owned()),
            ("Fix it".to_owned(), "doing".to_owned()),
            ("Test it".to_owned(), "todo".to_owned()),
        ]
    );
    session.clear_plan();
    assert!(session.plan().is_empty());
}
