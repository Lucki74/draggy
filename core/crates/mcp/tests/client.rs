//! Client behavior the recorded sessions cannot express: a crash nobody asked about, an oversized interface, the bearer
//! header, and what stays out of the log. Everything runs on paused time against the doubles in `client_support`.

mod client_support;

use std::collections::VecDeque;
use std::future::{Future, ready};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use client_support::{
    Answer, Fake, FakeHttp, FakeLauncher, FakeProvisioner, Recorder, ScriptedProcess, Session,
    ports, reply,
};
use draggy_mcp::definition::ServerConfig;
use draggy_mcp::ports::Ports;
use draggy_mcp::process::{Event, Launcher, Process};
use draggy_mcp::server::{CALL_TIMEOUT, CallOptions, HANDSHAKE_TIMEOUT, Limits, Servers};
use serde_json::{Map, Value, json};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

/// The argument value that must never reach the log, not even in a hashed form.
const SECRET_ARGUMENT: &str = "sk-argument-value-never-logged";

/// The package the memory server runs. It is on disk, so no test here installs anything.
const MEMORY_PACKAGE: &str = "@modelcontextprotocol/server-memory";

fn memory_config() -> ServerConfig {
    ServerConfig {
        package: Some(MEMORY_PACKAGE.to_owned()),
        ..Default::default()
    }
}

/// Ports with the memory package installed and npm available.
fn installed_ports() -> Ports {
    ports(FakeProvisioner::new(true, true, &[MEMORY_PACKAGE]))
}

/// Paused time, so the client's timers fire the moment nothing else is happening.
fn run<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .unwrap_or_else(|error| panic!("cannot start a runtime: {error}"))
        .block_on(future)
}

fn session(value: Value) -> Session {
    Session::from_json(&value)
}

fn init() -> Value {
    json!({"method": "initialize", "result": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "memory", "version": "1"}}})
}

fn list(names: &[&str]) -> Value {
    let tools: Vec<Value> = names.iter().map(|name| json!({"name": name})).collect();
    json!({"method": "tools/list", "result": {"tools": tools}})
}

#[test]
fn the_timeouts_are_the_reference_limits() {
    assert_eq!(HANDSHAKE_TIMEOUT, Duration::from_millis(60_000));
    assert_eq!(CALL_TIMEOUT, Duration::from_millis(120_000));
}

#[test]
fn a_crash_nobody_asked_about_is_logged_and_the_server_leaves_the_list() {
    run(async {
        let recorder = Arc::new(Recorder::default());
        let fake = Fake::new(Vec::new());
        let mut servers = Servers::new(
            FakeHttp { fake },
            DyingLauncher,
            recorder.clone(),
            installed_ports(),
        );

        let state = servers.start("memory", &memory_config()).await;
        assert_eq!(state.status, "ready", "{state:?}");

        // The exit arrives on its own, with no request pending. Let the reader task see it.
        tokio::time::sleep(Duration::from_millis(1)).await;

        assert!(servers.list().is_empty());
        let lines = recorder.lines();
        let crash = lines
            .iter()
            .find(|line| line["msg"] == "server exited unexpectedly")
            .unwrap_or_else(|| panic!("no crash line in {lines:?}"));
        assert_eq!(crash["level"], "error");
        assert_eq!(crash["data"]["code"], 9);
    });
}

#[test]
fn an_interface_past_the_size_limit_is_not_handed_over() {
    run(async {
        let markup = "x".repeat(256 * 1024 + 1);
        let fake = Fake::new(vec![session(json!({"replies": [
            init(),
            list(&["board"]),
            {"method": "tools/call", "result": {"content": [
                {"type": "resource", "resource": {"uri": "ui://board/1", "text": "<div/>"}}]}},
            {"method": "resources/read", "result": {"contents": [
                {"uri": "ui://board/1", "mimeType": "text/html", "text": markup}]}},
        ]}))]);
        let recorder = Arc::new(Recorder::default());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            recorder.clone(),
            installed_ports(),
        );
        fake.begin_session();
        servers.start("memory", &memory_config()).await;

        let outcome = servers
            .call_tool("memory", "board", json!({}), &CallOptions::default())
            .await;

        assert!(outcome.success);
        assert_eq!(outcome.app, None);
        assert_eq!(outcome.text.as_deref(), Some("[interface: ui://board/1]"));
        let lines = recorder.lines();
        assert!(
            lines
                .iter()
                .any(|line| line["msg"] == "widget too large to show"
                    && line["data"]["chars"] == 256 * 1024 + 1),
            "{lines:?}"
        );
    });
}

#[test]
fn a_held_token_goes_out_as_a_bearer_header() {
    run(async {
        let fake = Fake::new(vec![session(json!({"replies": [init(), list(&[])]}))]);
        let ports = installed_ports();
        ports
            .vault
            .set("oauth:docs", json!({"access_token": "tok-123"}));
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            Arc::new(Recorder::default()),
            ports,
        );
        fake.begin_session();
        let config = ServerConfig {
            url: Some("https://tools.example/mcp".to_owned()),
            ..ServerConfig::default()
        };

        let state = servers.start("docs", &config).await;
        assert_eq!(state.status, "ready", "{state:?}");

        let first = &fake.wire()[0];
        assert_eq!(first["headers"]["authorization"], "Bearer tok-123");
    });
}

#[test]
fn an_argument_never_reaches_the_log_in_any_form_but_its_short_hash() {
    run(async {
        let fake = Fake::new(vec![session(json!({"replies": [
            init(),
            list(&["read"]),
            {"method": "tools/call", "result": {"content": [{"type": "text", "text": "ok"}]}},
        ]}))]);
        let recorder = Arc::new(Recorder::default());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            recorder.clone(),
            installed_ports(),
        );
        fake.begin_session();
        servers.start("memory", &memory_config()).await;

        let mut args = Map::new();
        args.insert("path".to_owned(), json!(SECRET_ARGUMENT));
        let outcome = servers
            .call_tool(
                "memory",
                "read",
                Value::Object(args),
                &CallOptions::default(),
            )
            .await;
        assert!(outcome.success);

        let logged = Value::Array(recorder.lines()).to_string();
        assert!(!logged.contains(SECRET_ARGUMENT), "{logged}");
        assert!(logged.contains("argHash"), "{logged}");
    });
}

#[test]
fn a_session_that_answers_nothing_is_a_timeout_not_a_hang() {
    run(async {
        let fake = Fake::new(vec![Session {
            replies: VecDeque::from([reply(Answer::Silent)]),
            ..Session::default()
        }]);
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            Arc::new(Recorder::default()),
            installed_ports(),
        );
        fake.begin_session();

        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(state.status, "error");
        assert!(
            state
                .error
                .as_deref()
                .is_some_and(|error| error.contains("did not answer initialize in time")),
            "{state:?}"
        );
    });
}

#[test]
fn the_limits_come_in_as_parameters() {
    run(async {
        let fake = Fake::new(vec![Session {
            replies: VecDeque::from([reply(Answer::Silent)]),
            ..Session::default()
        }]);
        let limits = Limits {
            handshake: Duration::from_millis(250),
            call: CALL_TIMEOUT,
        };
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            Arc::new(Recorder::default()),
            installed_ports(),
        )
        .with_limits(limits);
        fake.begin_session();

        let started = tokio::time::Instant::now();
        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(state.status, "error");
        assert_eq!(started.elapsed(), Duration::from_millis(250));
    });
}

/// Starts a process that answers the handshake and then exits on its own, with nothing asking it to.
struct DyingLauncher;

impl Launcher for DyingLauncher {
    type Process = Dying;

    fn program_name(&self) -> String {
        "node".to_owned()
    }

    fn spawn(&self, _args: &[String], _env: &Map<String, Value>) -> Result<Dying, String> {
        let (events, receiver) = mpsc::unbounded_channel();
        Ok(Dying {
            events,
            receiver: AsyncMutex::new(receiver),
        })
    }
}

struct Dying {
    events: mpsc::UnboundedSender<Event>,
    receiver: AsyncMutex<mpsc::UnboundedReceiver<Event>>,
}

impl Process for Dying {
    fn write_line(&self, line: String) -> impl Future<Output = bool> + Send {
        let message: Value = serde_json::from_str(line.trim()).unwrap_or(Value::Null);
        if let Some(id) = message.get("id").cloned() {
            let is_list = message["method"] == "tools/list";
            let result = if is_list {
                json!({"tools": []})
            } else {
                json!({"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "dying"}})
            };
            let _ = self.events.send(Event::Stdout(format!(
                "{}\n",
                json!({"jsonrpc": "2.0", "id": id, "result": result})
            )));
            if is_list {
                let _ = self.events.send(Event::Exited(Some(9)));
            }
        }
        ready(true)
    }

    async fn next_event(&self) -> Event {
        let mut receiver = self.receiver.lock().await;
        receiver.recv().await.unwrap_or(Event::Exited(None))
    }

    fn stop(&self) {}
}

/// The package the sessions run, and the path it is found at once installed.
const MEMORY_ENTRY: &str = "/fake/node_modules/@modelcontextprotocol/server-memory/index.js";

/// A launcher that remembers the arguments each process was started with, then starts it as the fake would.
#[derive(Clone)]
struct RecordingLauncher {
    inner: FakeLauncher,
    started_with: Arc<Mutex<Vec<Vec<String>>>>,
}

impl Launcher for RecordingLauncher {
    type Process = ScriptedProcess;

    fn program_name(&self) -> String {
        "node".to_owned()
    }

    fn spawn(&self, args: &[String], env: &Map<String, Value>) -> Result<ScriptedProcess, String> {
        self.started_with
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(args.to_vec());
        self.inner.spawn(args, env)
    }
}

fn recording(fake: &Fake) -> (RecordingLauncher, Arc<Mutex<Vec<Vec<String>>>>) {
    let started_with = Arc::new(Mutex::new(Vec::new()));
    let launcher = RecordingLauncher {
        inner: FakeLauncher { fake: fake.clone() },
        started_with: started_with.clone(),
    };
    (launcher, started_with)
}

#[test]
fn a_package_that_is_not_installed_is_installed_then_run_from_its_entry_point() {
    run(async {
        let fake = Fake::new(vec![session(json!({"replies": [init(), list(&[])]}))]);
        let provisioner = FakeProvisioner::new(true, true, &[]);
        let (launcher, started_with) = recording(&fake);
        let recorder = Arc::new(Recorder::default());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            launcher,
            recorder.clone(),
            ports(provisioner.clone()),
        );
        fake.begin_session();

        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(state.status, "ready", "{state:?}");
        let installs = provisioner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .installs
            .clone();
        assert_eq!(
            installs,
            vec![vec!["install".to_owned(), MEMORY_PACKAGE.to_owned()]]
        );
        let started = started_with
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        assert_eq!(started, vec![vec![MEMORY_ENTRY.to_owned()]]);
        let messages: Vec<String> = recorder
            .lines()
            .iter()
            .filter_map(|line| line["msg"].as_str().map(str::to_owned))
            .collect();
        assert!(
            messages.contains(&"installing server package".to_owned()),
            "{messages:?}"
        );
        assert!(
            messages.contains(&"installed server package".to_owned()),
            "{messages:?}"
        );
    });
}

#[test]
fn a_failed_install_is_logged_and_its_stderr_is_the_error() {
    run(async {
        let fake = Fake::new(Vec::new());
        let provisioner = FakeProvisioner::new(true, true, &[]);
        provisioner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .install_outcome = Some(Err("npm ERR! 404 Not Found".to_owned()));
        let (launcher, started_with) = recording(&fake);
        let recorder = Arc::new(Recorder::default());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            launcher,
            recorder.clone(),
            ports(provisioner),
        );

        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(state.status, "error");
        assert_eq!(
            state.error.as_deref(),
            Some(
                "@modelcontextprotocol/server-memory could not be installed: npm ERR! 404 Not Found."
            )
        );
        assert!(
            started_with
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_empty()
        );
        let lines = recorder.lines();
        let failure = lines
            .iter()
            .find(|line| line["msg"] == "server package install failed")
            .unwrap_or_else(|| panic!("no install failure in {lines:?}"));
        assert_eq!(failure["level"], "warn");
        assert_eq!(failure["data"]["detail"], "npm ERR! 404 Not Found");
    });
}

#[test]
fn an_install_that_leaves_no_entry_point_says_so_and_starts_nothing() {
    run(async {
        let fake = Fake::new(Vec::new());
        let provisioner = FakeProvisioner::new(true, true, &[]);
        provisioner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .adds_on_install = false;
        let (launcher, started_with) = recording(&fake);
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            launcher,
            Arc::new(Recorder::default()),
            ports(provisioner),
        );

        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(
            state.error.as_deref(),
            Some(
                "@modelcontextprotocol/server-memory installed but does not say which file to run."
            )
        );
        assert!(
            started_with
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_empty()
        );
    });
}

#[test]
fn extensions_that_are_not_set_up_yet_are_refused_before_anything_else() {
    run(async {
        let fake = Fake::new(Vec::new());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            Arc::new(Recorder::default()),
            ports(FakeProvisioner::new(false, true, &[MEMORY_PACKAGE])),
        );

        let state = servers.start("memory", &memory_config()).await;

        assert_eq!(
            state.error.as_deref(),
            Some("Extensions are not ready yet.")
        );
    });
}

#[test]
fn a_sign_out_forgets_the_token_before_the_server_stops() {
    run(async {
        let fake = Fake::new(vec![session(json!({"replies": [init(), list(&[])]}))]);
        let ports = installed_ports();
        ports.vault.set(
            "oauth:docs",
            json!({"access_token": "tok-123", "refresh_token": "rt"}),
        );
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            Arc::new(Recorder::default()),
            ports.clone(),
        );
        fake.begin_session();
        let config = ServerConfig {
            url: Some("https://tools.example/mcp".to_owned()),
            ..ServerConfig::default()
        };
        assert_eq!(servers.start("docs", &config).await.status, "ready");

        assert!(servers.sign_out("docs").await);

        assert_eq!(ports.vault.get("oauth:docs"), None);
        assert!(servers.list().is_empty());
    });
}

#[test]
fn a_process_error_during_a_call_fails_the_call_and_lists_the_server_as_failed() {
    run(async {
        let fake = Fake::new(vec![session(json!({"replies": [
            init(),
            list(&["read"]),
            {"process_error": "pipe broke"},
        ]}))]);
        let recorder = Arc::new(Recorder::default());
        let mut servers = Servers::new(
            FakeHttp { fake: fake.clone() },
            FakeLauncher { fake: fake.clone() },
            recorder.clone(),
            installed_ports(),
        );
        fake.begin_session();
        assert_eq!(
            servers.start("memory", &memory_config()).await.status,
            "ready"
        );

        let outcome = servers
            .call_tool("memory", "read", json!({}), &CallOptions::default())
            .await;

        assert!(!outcome.success);
        assert_eq!(outcome.error.as_deref(), Some("pipe broke"));
        let listed = servers.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "error");
        assert_eq!(listed[0].error.as_deref(), Some("pipe broke"));
        assert!(
            recorder
                .lines()
                .iter()
                .any(|line| line["msg"] == "process error" && line["level"] == "error"),
            "{:?}",
            recorder.lines()
        );
    });
}
