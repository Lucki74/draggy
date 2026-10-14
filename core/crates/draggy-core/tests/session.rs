//! A session against a scripted OpenAI-compatible server on loopback: the real client, decoder, agent loop and file
//! tools, with nothing on the network beyond 127.0.0.1.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use draggy_core::{
    CancelToken, CoreError, Session, SessionConfig, TurnEventRecord, TurnObserver, TurnOutcome,
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
    let mut reader = BufReader::new(stream.try_clone().ok()?);
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
    }
}

fn run(session: &Arc<Session>, text: &str, recorder: &Arc<Recorder>) -> TurnOutcome {
    let observer: Arc<dyn TurnObserver> = recorder.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("runtime");
    runtime
        .block_on(Arc::clone(session).send(text.to_owned(), observer, CancelToken::new()))
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
        .block_on(Arc::clone(&session).send("Count".to_owned(), observer, cancel))
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
        .block_on(session.send("Hi".to_owned(), observer, CancelToken::new()))
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
