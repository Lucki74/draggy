//! Sign-in and token renewal against fakes: the redirect listener, the browser, the vault and the network are all scripted,
//! so nothing opens a socket and the stored record can be read back. The reference has no unit tests for these, so the
//! expectations come from the reference's code paths in electron/mcp.cjs and electron/mcpOauth.cjs.

mod support;

use std::sync::{Arc, Mutex, PoisonError};

use draggy_mcp::definition::RemoteCredentials;
use draggy_mcp::http::Transport;
use draggy_mcp::log::{Level, Log};
use draggy_mcp::ports::{BoxFuture, Clock, MemoryVault, Ports, Provisioner, Vault};
use draggy_mcp::provision::InstallCommand;
use draggy_mcp::signin::{
    Browser, Callback, Redirect, SignInRequest, refresh_tokens, sign_in, vault_key,
};
use serde_json::{Value, json};
use support::{FakeHttp, block_on, json_reply, reply};

const SERVER_URL: &str = "https://tools.example/mcp";
const REDIRECT: &str = "http://127.0.0.1:4000/callback";

/// Discovery for a server whose authorisation server offers registration, or not.
fn discovery(registration: bool) -> Vec<(String, support::Reply)> {
    let mut metadata = json!({
        "authorization_endpoint": "https://auth.example/auth/authorize",
        "token_endpoint": "https://auth.example/auth/token",
    });
    if registration {
        metadata["registration_endpoint"] = json!("https://auth.example/auth/register");
    }
    vec![
        (
            "https://tools.example/.well-known/oauth-protected-resource".to_owned(),
            json_reply(&json!({"authorization_servers": ["https://auth.example/auth"]})),
        ),
        (
            "https://auth.example/auth/.well-known/oauth-authorization-server".to_owned(),
            json_reply(&metadata),
        ),
    ]
}

/// The redirect listener as a script: the address it listens on, and the answer the browser sends back.
struct FakeRedirect {
    address: Result<String, String>,
    answer: Result<Callback, String>,
    closed: Mutex<u32>,
}

impl FakeRedirect {
    fn answering(state: &str) -> Self {
        Self {
            address: Ok(REDIRECT.to_owned()),
            answer: Ok(Callback {
                code: "code-1".to_owned(),
                state: Some(state.to_owned()),
            }),
            closed: Mutex::new(0),
        }
    }

    fn closes(&self) -> u32 {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Redirect for FakeRedirect {
    fn listen(&self) -> BoxFuture<'_, Result<String, String>> {
        let address = self.address.clone();
        Box::pin(async move { address })
    }

    fn callback(&self) -> BoxFuture<'_, Result<Callback, String>> {
        let answer = self.answer.clone();
        Box::pin(async move { answer })
    }

    fn close(&self) {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner) += 1;
    }
}

/// The browser as a recorder: it remembers every address it was sent to.
#[derive(Default)]
struct FakeBrowser {
    opened: Mutex<Vec<String>>,
}

impl Browser for FakeBrowser {
    fn open(&self, url: &str) -> BoxFuture<'_, Result<(), String>> {
        self.opened
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(url.to_owned());
        Box::pin(async { Ok(()) })
    }
}

/// Every log line, with its level, scope, message and data.
#[derive(Default)]
struct Lines {
    lines: Mutex<Vec<Value>>,
}

impl Log for Lines {
    fn line(&self, level: Level, scope: &str, message: &str, data: Value) {
        self.lines
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(json!({"level": level.as_str(), "scope": scope, "msg": message, "data": data}));
    }
}

impl Lines {
    fn find(&self, message: &str) -> Option<Value> {
        self.lines
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .find(|line| line["msg"] == message)
            .cloned()
    }
}

/// A host with no packages, since sign-in never looks at one.
struct NoPackages;

impl Provisioner for NoPackages {
    fn ready(&self) -> bool {
        false
    }

    fn install_command(&self, _package: &str) -> Option<InstallCommand> {
        None
    }

    fn entry_point(&self, _package: &str) -> Option<String> {
        None
    }

    fn install(&self, _command: &InstallCommand) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async { Err("no installs here".to_owned()) })
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now_ms(&self) -> f64 {
        1_000.0
    }
}

fn ports(vault: &Arc<MemoryVault>) -> Ports {
    let vault: Arc<dyn Vault> = vault.clone();
    Ports {
        vault,
        provisioner: Arc::new(NoPackages),
        clock: Arc::new(FixedClock),
    }
}

fn stored(vault: &MemoryVault, id: &str) -> Value {
    vault.get(&vault_key(id)).unwrap_or(Value::Null)
}

fn sign_in_request(state: &str) -> SignInRequest<'_> {
    SignInRequest {
        id: "docs",
        url: SERVER_URL,
        state,
        pkce_random: &[7_u8; 32],
    }
}

#[test]
fn a_sign_in_stores_the_tokens_and_logs_that_it_succeeded() {
    let vault = Arc::new(MemoryVault::default());
    let mut routes = discovery(true);
    routes.push((
        "https://auth.example/auth/register".to_owned(),
        json_reply(&json!({"client_id": "client-1", "client_secret": "secret-1"})),
    ));
    routes.push((
        "https://auth.example/auth/token".to_owned(),
        json_reply(&json!({"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600})),
    ));
    let http = FakeHttp::routes(routes);
    let redirect = FakeRedirect::answering("state-1");
    let browser = FakeBrowser::default();
    let lines = Lines::default();

    let outcome = block_on(sign_in(
        &http,
        &ports(&vault),
        &lines,
        &redirect,
        &browser,
        sign_in_request("state-1"),
    ));

    assert_eq!(outcome, Ok(()));
    let record = stored(&vault, "docs");
    assert_eq!(record["access_token"], "at-1");
    assert_eq!(record["refresh_token"], "rt-1");
    assert_eq!(record["client_id"], "client-1");
    assert_eq!(record["client_secret"], "secret-1");
    assert_eq!(record["redirect_uri"], REDIRECT);
    // Expires a minute early: 1000 + 3600 seconds - 60 seconds.
    assert_eq!(record["expiresAt"], json!(3_541_000.0));

    let opened = browser
        .opened
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    assert_eq!(opened.len(), 1);
    assert!(
        opened[0].starts_with("https://auth.example/auth/authorize?"),
        "{}",
        opened[0]
    );
    assert!(opened[0].contains("state=state-1"), "{}", opened[0]);
    assert!(opened[0].contains("client_id=client-1"), "{}", opened[0]);
    drop(opened);

    assert_eq!(redirect.closes(), 1);
    assert_eq!(
        lines.find("signed in").map(|line| line["scope"].clone()),
        Some(json!("mcp.docs"))
    );
}

#[test]
fn a_redirect_with_another_state_is_refused_and_nothing_is_stored() {
    let vault = Arc::new(MemoryVault::default());
    let mut routes = discovery(true);
    routes.push((
        "https://auth.example/auth/register".to_owned(),
        json_reply(&json!({"client_id": "client-1"})),
    ));
    let http = FakeHttp::routes(routes);
    let redirect = FakeRedirect::answering("someone-else");

    let outcome = block_on(sign_in(
        &http,
        &ports(&vault),
        &Lines::default(),
        &redirect,
        &FakeBrowser::default(),
        sign_in_request("state-1"),
    ));

    assert_eq!(
        outcome,
        Err("That sign-in did not match this request.".to_owned())
    );
    assert_eq!(stored(&vault, "docs"), Value::Null);
    assert_eq!(redirect.closes(), 1);
    // No token request was made, only discovery and registration.
    assert!(
        http.requests()
            .iter()
            .all(|request| !request.url.ends_with("/token"))
    );
}

#[test]
fn a_server_that_offers_no_registration_and_has_no_client_is_refused_before_the_browser() {
    let vault = Arc::new(MemoryVault::default());
    let http = FakeHttp::routes(discovery(false));
    let browser = FakeBrowser::default();

    let outcome = block_on(sign_in(
        &http,
        &ports(&vault),
        &Lines::default(),
        &FakeRedirect::answering("state-1"),
        &browser,
        sign_in_request("state-1"),
    ));

    assert_eq!(
        outcome,
        Err(
            "That server does not offer registration, so Draggy has no client id to sign in with."
                .to_owned()
        )
    );
    assert!(
        browser
            .opened
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_empty()
    );
}

#[test]
fn a_client_registered_for_the_same_redirect_is_reused_and_not_registered_again() {
    let vault = Arc::new(MemoryVault::default());
    vault.set(
        &vault_key("docs"),
        json!({"client_id": "client-0", "client_secret": "", "redirect_uri": REDIRECT}),
    );
    // The registration route is absent, so a second registration would be a 404 and the sign-in would fail.
    let http = FakeHttp::routes(
        discovery(true)
            .into_iter()
            .chain([(
                "https://auth.example/auth/token".to_owned(),
                json_reply(&json!({"access_token": "at-2"})),
            )])
            .collect(),
    );

    let outcome = block_on(sign_in(
        &http,
        &ports(&vault),
        &Lines::default(),
        &FakeRedirect::answering("state-1"),
        &FakeBrowser::default(),
        sign_in_request("state-1"),
    ));

    assert_eq!(outcome, Ok(()));
    assert!(
        http.requests()
            .iter()
            .all(|request| request.url != "https://auth.example/auth/register")
    );
    assert_eq!(stored(&vault, "docs")["client_id"], "client-0");
}

#[test]
fn a_refresh_stores_the_new_token_and_keeps_the_old_refresh_token() {
    let vault = Arc::new(MemoryVault::default());
    vault.set(
        &vault_key("docs"),
        json!({"access_token": "old", "refresh_token": "rt-old", "client_id": "client-1", "client_secret": "", "expiresAt": ""}),
    );
    let http = FakeHttp::routes(
        discovery(false)
            .into_iter()
            .chain([(
                "https://auth.example/auth/token".to_owned(),
                json_reply(&json!({"access_token": "new", "expires_in": 60})),
            )])
            .collect(),
    );
    let lines = Lines::default();

    let renewed = block_on(refresh_tokens(
        &http,
        &ports(&vault),
        &lines,
        "docs",
        SERVER_URL,
    ));

    assert!(renewed);
    let record = stored(&vault, "docs");
    assert_eq!(record["access_token"], "new");
    assert_eq!(record["refresh_token"], "rt-old");
    assert_eq!(record["client_secret"], "");
    // A 60 second lifetime less the minute of margin leaves no time at all.
    assert_eq!(record["expiresAt"], json!(1_000.0));
    assert!(lines.find("refreshed sign-in").is_some());
}

#[test]
fn a_refused_refresh_is_a_warning_and_the_old_record_stays() {
    let vault = Arc::new(MemoryVault::default());
    let old = json!({"access_token": "old", "refresh_token": "rt-old", "client_id": "client-1"});
    vault.set(&vault_key("docs"), old.clone());
    let http = FakeHttp::routes(
        discovery(false)
            .into_iter()
            .chain([(
                "https://auth.example/auth/token".to_owned(),
                reply(400, "{\"error\":\"invalid_grant\"}"),
            )])
            .collect(),
    );
    let lines = Lines::default();

    let renewed = block_on(refresh_tokens(
        &http,
        &ports(&vault),
        &lines,
        "docs",
        SERVER_URL,
    ));

    assert!(!renewed);
    assert_eq!(stored(&vault, "docs"), old);
    let warning = lines
        .find("could not refresh sign-in")
        .unwrap_or_else(|| panic!("no warning in {:?}", lines.lines));
    assert_eq!(warning["level"], "warn");
    assert!(warning["data"]["reason"].is_string(), "{warning}");
}

#[test]
fn a_server_with_no_refresh_token_is_not_asked_for_a_refresh() {
    let vault = Arc::new(MemoryVault::default());
    vault.set(&vault_key("docs"), json!({"access_token": "old"}));
    let http = FakeHttp::queue(Vec::new());

    let renewed = block_on(refresh_tokens(
        &http,
        &ports(&vault),
        &Lines::default(),
        "docs",
        SERVER_URL,
    ));

    assert!(!renewed);
    assert!(http.requests().is_empty());
}

#[test]
fn a_401_is_answered_by_one_refresh_and_the_call_is_sent_again_with_the_new_token() {
    let vault = Arc::new(MemoryVault::default());
    vault.set(
        &vault_key("docs"),
        json!({"access_token": "old", "refresh_token": "rt", "client_id": "client-1", "client_secret": "", "expiresAt": ""}),
    );
    let http = FakeHttp::queue(vec![
        // The first request is refused for its token.
        reply(401, "token expired"),
        // The refresh: discovery, then the token endpoint.
        json_reply(&json!({"authorization_servers": ["https://auth.example/auth"]})),
        json_reply(&json!({
            "authorization_endpoint": "https://auth.example/auth/authorize",
            "token_endpoint": "https://auth.example/auth/token",
        })),
        json_reply(&json!({"access_token": "new", "refresh_token": "rt-2"})),
        // The same request again, now with the new token.
        json_reply(&json!({"jsonrpc": "2.0", "id": 1, "result": {"ok": true}})),
    ]);
    let lines = Lines::default();
    let credentials = RemoteCredentials::new(
        http.clone(),
        ports(&vault),
        Arc::new(lines),
        "docs",
        SERVER_URL,
        Vec::new(),
    );
    let mut transport = Transport::new(http.clone(), SERVER_URL, credentials);

    let answer = block_on(transport.send("initialize", Some(json!({}))));

    assert_eq!(answer.ok(), Some(json!({"ok": true})));
    let requests = http.requests();
    let posts: Vec<_> = requests
        .iter()
        .filter(|request| request.url == SERVER_URL)
        .collect();
    assert_eq!(posts.len(), 2, "one refused call and one retry");
    assert!(
        posts[0]
            .headers
            .contains(&("Authorization".to_owned(), "Bearer old".to_owned()))
    );
    assert!(
        posts[1]
            .headers
            .contains(&("Authorization".to_owned(), "Bearer new".to_owned()))
    );
    assert_eq!(stored(&vault, "docs")["refresh_token"], "rt-2");
}

#[test]
fn a_second_401_is_an_error_and_not_a_loop() {
    let vault = Arc::new(MemoryVault::default());
    vault.set(
        &vault_key("docs"),
        json!({"access_token": "old", "refresh_token": "rt", "client_id": "client-1", "client_secret": "", "expiresAt": ""}),
    );
    let http = FakeHttp::queue(vec![
        reply(401, "token expired"),
        json_reply(&json!({"authorization_servers": ["https://auth.example/auth"]})),
        json_reply(&json!({
            "authorization_endpoint": "https://auth.example/auth/authorize",
            "token_endpoint": "https://auth.example/auth/token",
        })),
        json_reply(&json!({"access_token": "new"})),
        reply(401, "still expired"),
    ]);
    let credentials = RemoteCredentials::new(
        http.clone(),
        ports(&vault),
        Arc::new(Lines::default()),
        "docs",
        SERVER_URL,
        Vec::new(),
    );
    let mut transport = Transport::new(http.clone(), SERVER_URL, credentials);

    let answer = block_on(transport.send("initialize", Some(json!({}))));

    assert!(answer.is_err(), "{answer:?}");
    assert_eq!(
        http.requests().len(),
        5,
        "a single refresh and a single retry"
    );
}

#[test]
fn a_sign_in_the_user_refuses_reports_the_refusal_and_closes_the_listener() {
    let vault = Arc::new(MemoryVault::default());
    let mut routes = discovery(true);
    routes.push((
        "https://auth.example/auth/register".to_owned(),
        json_reply(&json!({"client_id": "client-1"})),
    ));
    let http = FakeHttp::routes(routes);
    let redirect = FakeRedirect {
        address: Ok(REDIRECT.to_owned()),
        answer: Err("Sign-in was refused.".to_owned()),
        closed: Mutex::new(0),
    };

    let outcome = block_on(sign_in(
        &http,
        &ports(&vault),
        &Lines::default(),
        &redirect,
        &FakeBrowser::default(),
        sign_in_request("state-1"),
    ));

    assert_eq!(outcome, Err("Sign-in was refused.".to_owned()));
    assert_eq!(stored(&vault, "docs"), Value::Null);
    assert_eq!(redirect.closes(), 1);
}
