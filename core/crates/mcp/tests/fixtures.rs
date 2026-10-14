//! Runs the golden fixtures in `shared/fixtures/mcp` through the port. The vitest runner in `src/__tests__/fixtures/mcp.test.ts`
//! drives the same inputs through the CJS reference with the same fakes, so both must agree.

mod support;

use std::sync::Mutex;

use draggy_mcp::catalogue::{
    CommandSpec, Config, Entry, command_for, docs_url, find_entry, is_secret_field, list_catalogue,
    missing_requirements, search_catalogue,
};
use draggy_mcp::http::{Transport, TransportError, parse_event_stream};
use draggy_mcp::net::Request;
use draggy_mcp::net::{NetError, Response};
use draggy_mcp::oauth::{
    AuthorizeRequest, ExchangeRequest, OauthError, RefreshRequest, authorize_url, discover,
    exchange, expiry_of, is_expired, pkce_from_random, refresh, register,
};
use draggy_mcp::registry::{id_for, parse_servers, to_entry};
use draggy_testkit::{cases, files};
use serde_json::{Map, Value, json};
use support::{FakeHttp, Reply, block_on, headers_json};

const MCP_URL: &str = "https://tools.example/mcp";

/// One test per fixture file, so a failure names its file. Each new file must be listed here, or the guard below fails.
macro_rules! fixture_tests {
    ($($test:ident => $file:literal),* $(,)?) => {
        const KNOWN_FILES: &[&str] = &[$($file),*];

        $(
            #[test]
            fn $test() {
                check_file($file);
            }
        )*
    };
}

fixture_tests! {
    catalogue_list => "catalogue-list.json",
    catalogue_find => "catalogue-find.json",
    catalogue_search => "catalogue-search.json",
    catalogue_missing => "catalogue-missing.json",
    catalogue_command => "catalogue-command.json",
    catalogue_secret => "catalogue-secret.json",
    catalogue_docs => "catalogue-docs.json",
    registry_parse => "registry-parse.json",
    registry_entry => "registry-entry.json",
    registry_id => "registry-id.json",
    oauth_pkce => "oauth-pkce.json",
    oauth_url => "oauth-url.json",
    oauth_expiry => "oauth-expiry.json",
    oauth_stale => "oauth-stale.json",
    oauth_token => "oauth-token.json",
    oauth_register => "oauth-register.json",
    oauth_discover => "oauth-discover.json",
    http_sse => "http-sse.json",
    http_transport => "http-transport.json",
}

#[test]
fn every_fixture_file_has_a_runner() {
    let unknown: Vec<String> = files("mcp")
        .into_iter()
        // The session files are run by mcp_session.rs, not by the single-step runners here.
        .filter(|file| !file.starts_with("mcp-session-"))
        .filter(|file| !KNOWN_FILES.contains(&file.as_str()))
        .collect();
    assert!(unknown.is_empty(), "no Rust runner for {unknown:?}");
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
    assert!(
        failures.is_empty(),
        "{file}: {} case(s) differ\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "catalogue-list.json" => entries_json(&list_catalogue()),
        "catalogue-find.json" => match find_entry(&text_of(&input["id"])) {
            Some(entry) => entry_json(&entry),
            None => Value::Null,
        },
        "catalogue-search.json" => json!(
            search_catalogue(&text_of(&input["term"]))
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>()
        ),
        "catalogue-missing.json" => json!(missing_requirements(
            entry_of(&input["entry"]).as_ref(),
            &config_of(&input["config"])
        )),
        "catalogue-command.json" => command_json(command_for(
            entry_of(&input["entry"]).as_ref(),
            &config_of(&input["config"]),
        )),
        "catalogue-secret.json" => json!(is_secret_field(
            &text_of(&input["id"]),
            &text_of(&input["field"])
        )),
        "catalogue-docs.json" => match entry_of(&input["entry"]) {
            Some(entry) => json!(docs_url(&entry)),
            None => Value::Null,
        },
        "registry-parse.json" => entries_json(&parse_servers(&input["payload"])),
        "registry-entry.json" => match to_entry(&input["server"]) {
            Some(entry) => entry_json(&entry),
            None => Value::Null,
        },
        "registry-id.json" => json!(id_for(&text_of(&input["name"]))),
        "oauth-pkce.json" => run_pkce(input),
        "oauth-url.json" => run_authorize(input),
        "oauth-expiry.json" => {
            let tokens = non_null(&input["tokens"]);
            match expiry_of(tokens, number_of(&input["now"])) {
                Some(at) => number_value(at),
                None => Value::Null,
            }
        }
        "oauth-stale.json" => json!(is_expired(
            input["stored"]
                .get("expiresAt")
                .filter(|value| !value.is_null()),
            number_of(&input["now"])
        )),
        "oauth-token.json" => run_token(input),
        "oauth-register.json" => run_register(input),
        "oauth-discover.json" => run_discover(input),
        "http-sse.json" => {
            let body: String = input["chunks"]
                .as_array()
                .into_iter()
                .flatten()
                .map(text_of)
                .collect();
            json!(parse_event_stream(&body))
        }
        "http-transport.json" => run_transport(input),
        other => panic!("no Rust runner for {other}"),
    }
}

/// `String(value ?? "")` for the text inputs the fixtures use.
fn text_of(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// A JSON null means absent, as the fixtures write an undefined field.
fn non_null(value: &Value) -> Option<&Value> {
    if value.is_null() { None } else { Some(value) }
}

fn number_of(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}

/// A whole number is written as an integer, so it compares equal to the JSON the reference writes.
fn number_value(number: f64) -> Value {
    if number.fract() == 0.0 && number.abs() < 9e15 {
        json!(number as i64)
    } else {
        json!(number)
    }
}

fn entry_json(entry: &Entry) -> Value {
    serde_json::to_value(entry).unwrap_or(Value::Null)
}

fn entries_json(entries: &[Entry]) -> Value {
    Value::Array(entries.iter().map(entry_json).collect())
}

/// An entry given as a catalogue id is looked up; one given as an object is read as it is.
fn entry_of(value: &Value) -> Option<Entry> {
    match value {
        Value::String(id) => find_entry(id),
        Value::Null => None,
        object => serde_json::from_value(object.clone()).ok(),
    }
}

fn config_of(value: &Value) -> Config {
    Config {
        env: object_of(&value["env"]),
        arguments: object_of(&value["arguments"]),
    }
}

fn object_of(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn command_json(spec: Option<CommandSpec>) -> Value {
    match spec {
        Some(spec) => json!({ "args": spec.args, "env": spec.env }),
        None => Value::Null,
    }
}

fn run_pkce(input: &Value) -> Value {
    let random = hex::decode(text_of(&input["randomBytes"])).unwrap_or_default();
    let pkce = pkce_from_random(&random);
    json!({ "verifier": pkce.verifier, "challenge": pkce.challenge })
}

fn run_authorize(input: &Value) -> Value {
    let text = |key: &str| input[key].as_str().unwrap_or_default().to_owned();
    let optional = |key: &str| {
        input[key]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let endpoint = text("endpoint");
    let client_id = text("clientId");
    let redirect_uri = text("redirectUri");
    let challenge = text("challenge");
    let state = text("state");
    let scope = optional("scope");
    let resource = optional("resource");
    let request = AuthorizeRequest {
        endpoint: &endpoint,
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        challenge: &challenge,
        state: &state,
        scope: scope.as_deref(),
        resource: resource.as_deref(),
    };
    match authorize_url(&request) {
        Ok(url) => json!(url),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

/// The reply a fixture scripts for one request: a response, or a failure to reach the server.
fn reply_from(value: &Value) -> Reply {
    if let Some(reason) = value["fail"].as_str() {
        return Err(NetError::Failed(reason.to_owned()));
    }
    let status = value["status"]
        .as_u64()
        .and_then(|status| u16::try_from(status).ok())
        .unwrap_or(200);
    let headers: Vec<(String, String)> = value["headers"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(key, value)| (key.clone(), text_of(value)))
        .collect();
    let body = match &value["body"] {
        Value::Null => String::new(),
        Value::String(body) => body.clone(),
        other => other.to_string(),
    };
    Ok(Response {
        status,
        headers,
        body,
    })
}

/// The form a request sent, as the fixtures compare it.
fn form_of(request: &Request) -> Value {
    let body = request.body.clone().unwrap_or_default();
    let fields: Map<String, Value> = url::form_urlencoded::parse(body.as_bytes())
        .map(|(key, value)| (key.into_owned(), json!(value.into_owned())))
        .collect();
    Value::Object(fields)
}

fn oauth_error_text(error: &OauthError) -> String {
    match error {
        OauthError::Json => "invalid json".to_owned(),
        other => other.to_string(),
    }
}

fn run_token(input: &Value) -> Value {
    let fake = FakeHttp::queue(vec![reply_from(&input["reply"])]);
    let endpoint = text_of(&input["endpoint"]);
    let client_id = optional_text(&input["clientId"]);
    let client_secret = optional_text(&input["clientSecret"]);
    let resource = optional_text(&input["resource"]);
    let outcome = if input["grant"] == "refresh_token" {
        let refresh_token = optional_text(&input["refreshToken"]);
        let request = RefreshRequest {
            endpoint: &endpoint,
            client_id: client_id.as_deref(),
            client_secret: client_secret.as_deref(),
            refresh_token: refresh_token.as_deref(),
            resource: resource.as_deref(),
        };
        block_on(refresh(&fake, &request))
    } else {
        let code = optional_text(&input["code"]);
        let redirect_uri = optional_text(&input["redirectUri"]);
        let verifier = optional_text(&input["verifier"]);
        let request = ExchangeRequest {
            endpoint: &endpoint,
            client_id: client_id.as_deref(),
            client_secret: client_secret.as_deref(),
            code: code.as_deref(),
            redirect_uri: redirect_uri.as_deref(),
            verifier: verifier.as_deref(),
            resource: resource.as_deref(),
        };
        block_on(exchange(&fake, &request))
    };

    let sent = fake.requests().first().map(form_of).unwrap_or(Value::Null);
    match outcome {
        Ok(tokens) => json!({ "sent": sent, "result": tokens }),
        Err(error) => json!({ "sent": sent, "error": oauth_error_text(&error) }),
    }
}

fn run_register(input: &Value) -> Value {
    let fake = FakeHttp::queue(vec![reply_from(&input["reply"])]);
    let endpoint = optional_text(&input["endpoint"]);
    let redirect_uri = text_of(&input["redirectUri"]);
    let registered = block_on(register(&fake, endpoint.as_deref(), &redirect_uri));
    let sent = fake
        .requests()
        .first()
        .and_then(|request| {
            request
                .body
                .as_deref()
                .and_then(|body| serde_json::from_str::<Value>(body).ok())
        })
        .unwrap_or(Value::Null);
    json!({ "sent": sent, "registered": registered.unwrap_or(Value::Null) })
}

fn run_discover(input: &Value) -> Value {
    let routes: Vec<(String, Reply)> = input["routes"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(url, reply)| (url.clone(), reply_from(reply)))
        .collect();
    let fake = FakeHttp::routes(routes);
    let server = text_of(&input["server"]);
    let outcome = block_on(discover(&fake, &server));
    let requests: Vec<String> = fake
        .requests()
        .into_iter()
        .map(|request| request.url)
        .collect();

    match outcome {
        Ok(metadata) => json!({
            "requests": requests,
            "metadata": {
                "issuer": metadata.issuer,
                "authorization_endpoint": metadata.authorization_endpoint,
                "token_endpoint": metadata.token_endpoint,
                "registration_endpoint": metadata.registration_endpoint,
                "scopes_supported": metadata.scopes_supported,
                "discovered": metadata.discovered,
            },
        }),
        Err(error) => json!({ "requests": requests, "error": oauth_error_text(&error) }),
    }
}

/// The fixture's `Transport` credentials: a token that a refresh can replace, and headers the user set.
struct Scripted {
    token: Mutex<Option<String>>,
    refresh_to: Option<String>,
    headers: Option<Vec<(String, String)>>,
}

impl draggy_mcp::http::Credentials for Scripted {
    fn token(&self) -> impl std::future::Future<Output = Option<String>> + Send {
        std::future::ready(
            self.token
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        )
    }

    fn headers(&self) -> impl std::future::Future<Output = Option<Vec<(String, String)>>> + Send {
        std::future::ready(self.headers.clone())
    }

    fn unauthorized(&self) -> impl std::future::Future<Output = bool> + Send {
        let refreshed = match &self.refresh_to {
            Some(next) => {
                *self
                    .token
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(next.clone());
                true
            }
            None => false,
        };
        std::future::ready(refreshed)
    }
}

fn run_transport(input: &Value) -> Value {
    let replies: Vec<Reply> = input["responses"]
        .as_array()
        .into_iter()
        .flatten()
        .map(reply_from)
        .collect();
    let fake = FakeHttp::queue(replies);
    let credentials = Scripted {
        token: Mutex::new(input["token"].as_str().map(str::to_owned)),
        refresh_to: input["refreshTo"].as_str().map(str::to_owned),
        headers: input["headers"].as_object().map(|map| {
            map.iter()
                .map(|(key, value)| (key.clone(), text_of(value)))
                .collect()
        }),
    };
    let mut transport = Transport::new(fake.clone(), MCP_URL, credentials);

    let mut results = Vec::new();
    for op in input["ops"].as_array().into_iter().flatten() {
        let outcome = block_on(async {
            match op["op"].as_str() {
                Some("send") => {
                    transport
                        .send(&text_of(&op["method"]), op.get("params").cloned())
                        .await
                }
                Some("notify") => transport
                    .notify(&text_of(&op["method"]), op.get("params").cloned())
                    .await
                    .map(|()| Value::Null),
                _ => {
                    transport.close().await;
                    Ok(Value::Null)
                }
            }
        });
        results.push(match outcome {
            Ok(value) => json!({ "ok": value }),
            Err(error) => json!({ "error": transport_error_text(&error) }),
        });
    }

    let requests: Vec<Value> = fake
        .requests()
        .iter()
        .map(|request| {
            json!({
                "method": request.method.as_str(),
                "url": request.url,
                "headers": headers_json(&request.headers),
                "body": request.body.as_deref().and_then(|body| serde_json::from_str::<Value>(body).ok()),
            })
        })
        .collect();

    json!({
        "results": results,
        "requests": requests,
        "sessionId": transport.session_id().map_or(Value::Null, |session| json!(session)),
    })
}

fn transport_error_text(error: &TransportError) -> String {
    match error {
        TransportError::Json => "invalid json".to_owned(),
        other => other.to_string(),
    }
}

/// A text the reference reads as absent when the fixture writes null.
fn optional_text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}
