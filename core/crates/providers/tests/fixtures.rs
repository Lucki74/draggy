//! Runs the golden fixtures in `shared/fixtures/providers/*.json` through the port, as
//! `src/__tests__/fixtures/providers.test.ts` runs them through the Electron reference. Both sides canonicalise the
//! output the same way: whole numbers compare as integers, and a tool call's `arguments` string compares as the JSON
//! it holds, since key order is not meaningful.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;

use draggy_providers::adapters::common::{Connection, ListedModel, Stream};
use draggy_providers::adapters::{anthropic, gemini, ollama, openai};
use draggy_providers::autopin::plan_pins;
use draggy_providers::catalog::{Catalog, CatalogEntry, capabilities_for, problem_with};
use draggy_providers::discovery::{Discovery, ports};
use draggy_providers::errors::{
    from_network, from_response_text, from_response_value, is_retryable, retry_after_seconds,
};
use draggy_providers::http::{HttpClient, HttpRequest, HttpResponse, TransportError};
use draggy_providers::models::{AccountRuntime, ListError, ModelLister};
use draggy_providers::registry::{AddArgs, InstanceConnection, Keystore, KvStore, Patch, Registry};
use draggy_providers::remote_catalog::{PUBLIC_KEY, merge, verified};
use draggy_providers::sse::{Delta, SseWriter, completion};
use draggy_providers::types::{
    ChatRequest, FinishReason, ProviderError, ProviderState, StreamEvent, Usage,
};
use draggy_providers::usage::{from_anthropic, from_codex, from_gemini, from_openai, from_totals};
use draggy_testkit::{cases, files};
use serde_json::{Map, Value, json};

/// Both sides' canonical form: whole numbers as integers, and `arguments` strings parsed where they hold JSON.
fn canon(value: &Value) -> Value {
    match value {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 9.0e15 => json!(f as i64),
            _ => value.clone(),
        },
        Value::Array(items) => Value::Array(items.iter().map(canon).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| {
                    let canonical = match (key.as_str(), item) {
                        ("arguments", Value::String(text)) => serde_json::from_str::<Value>(text)
                            .map_or_else(|_| item.clone(), |parsed| canon(&parsed)),
                        _ => canon(item),
                    };
                    (key.clone(), canonical)
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

fn headers_of(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_owned)
}

fn finish_reason(text: &str) -> FinishReason {
    match text {
        "length" => FinishReason::Length,
        "tool_calls" => FinishReason::ToolCalls,
        _ => FinishReason::Stop,
    }
}

fn chat_request(value: &Value) -> ChatRequest {
    serde_json::from_value(value.clone()).expect("a fixture request reads as a chat request")
}

fn catalog_entry(provider: Option<&str>) -> Option<CatalogEntry> {
    provider.and_then(|id| Catalog::bundled().find(id).cloned())
}

/// The connection a case describes, as the adapters are given it.
fn connection_of(input: &Value) -> Connection {
    let provider = text(input.get("provider"));
    let entry = catalog_entry(provider.as_deref());
    let base_url = text(input.get("baseUrl"))
        .or_else(|| entry.as_ref().map(|e| e.base_url.clone()))
        .unwrap_or_default();
    Connection {
        instance_id: Some(
            text(input.get("instanceId"))
                .or(provider)
                .unwrap_or_default(),
        ),
        base_url,
        api_key: text(input.get("apiKey")).unwrap_or_default(),
        headers: headers_of(input.get("headers")),
        entry,
    }
}

fn request_json(request: &HttpRequest) -> Value {
    let mut out = Map::new();
    out.insert("url".to_owned(), json!(request.url));
    out.insert("method".to_owned(), json!(request.method.as_str()));
    out.insert("headers".to_owned(), json!(request.headers));
    if let Some(body) = &request.body {
        out.insert(
            "body".to_owned(),
            serde_json::from_str(body).unwrap_or(Value::Null),
        );
    }
    Value::Object(out)
}

/// The per-protocol stream, fed the chunks in order, with the finish at the end.
fn stream_events(input: &Value) -> Vec<StreamEvent> {
    let protocol = input
        .get("protocol")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let instance = match input.get("instanceId") {
        None => Some(protocol.to_owned()),
        Some(Value::Null) => None,
        Some(other) => other.as_str().map(str::to_owned),
    };
    let chunks: Vec<Vec<u8>> = input["chunks"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|chunk| match chunk {
                    Value::String(text) => text.as_bytes().to_vec(),
                    Value::Array(bytes) => bytes
                        .iter()
                        .map(|b| b.as_u64().unwrap_or_default() as u8)
                        .collect(),
                    _ => Vec::new(),
                })
                .collect()
        })
        .unwrap_or_default();
    let mut events = Vec::new();
    match protocol {
        "openai" => feed(openai::stream(), &chunks, &mut events),
        "anthropic" => feed(anthropic::stream(instance.as_deref()), &chunks, &mut events),
        "gemini" => feed(gemini::stream(instance.as_deref()), &chunks, &mut events),
        "ollama" => feed(ollama::stream(), &chunks, &mut events),
        _ => {}
    }
    events
}

fn feed<D: draggy_providers::adapters::common::Decoder>(
    mut stream: Stream<D>,
    chunks: &[Vec<u8>],
    events: &mut Vec<StreamEvent>,
) {
    for chunk in chunks {
        events.extend(stream.push(chunk));
    }
    events.extend(stream.finish());
}

/// A fake of the network for model listings: routes by URL, and a route may answer by the request's model name.
#[derive(Clone, Default)]
struct RoutedHttp {
    routes: Rc<BTreeMap<String, Value>>,
}

impl HttpClient for RoutedHttp {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        let Some(route) = self.routes.get(&request.url) else {
            return Err(TransportError {
                message: "fetch failed".to_owned(),
                cause_message: Some("ECONNREFUSED".to_owned()),
                code: None,
            });
        };
        let answer = match route.get("byModel") {
            Some(by_model) => {
                let body: Value = serde_json::from_str(request.body.as_deref().unwrap_or("{}"))
                    .unwrap_or(Value::Null);
                let model = body
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                by_model
                    .get(model)
                    .cloned()
                    .unwrap_or_else(|| json!({ "status": 404, "body": {} }))
            }
            None => route.clone(),
        };
        let status = answer.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;
        let body = answer.get("body").cloned().unwrap_or_else(|| json!({}));
        Ok(HttpResponse {
            status,
            headers: BTreeMap::from([("content-type".to_owned(), "application/json".to_owned())]),
            body: body.to_string(),
        })
    }
}

/// Account runtimes for a listing case: each answers with its models, or with the message it fails with.
struct FixedAccount(Result<Vec<ListedModel>, String>);

impl AccountRuntime for FixedAccount {
    fn models(&self, _instance_id: &str) -> Result<Vec<ListedModel>, ListError> {
        self.0.clone().map_err(ListError::Other)
    }
}

fn listed_model_of(value: &Value) -> ListedModel {
    ListedModel {
        id: text(value.get("id")).unwrap_or_default(),
        name: text(value.get("name")),
        resolved: text(value.get("resolved")),
        context_length: value.get("contextLength").and_then(Value::as_u64),
        input_modalities: value
            .get("inputModalities")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            }),
        ..ListedModel::default()
    }
}

/// A key-value store and keystore that the case can read back at the end.
#[derive(Clone, Default)]
struct FakeKv(Rc<RefCell<BTreeMap<String, String>>>);

impl KvStore for FakeKv {
    fn get(&self, key: &str) -> Option<String> {
        self.0.borrow().get(key).cloned()
    }
    fn set(&mut self, key: &str, value: &str) {
        self.0.borrow_mut().insert(key.to_owned(), value.to_owned());
    }
}

#[derive(Clone)]
struct FakeKeystore {
    vault: Rc<RefCell<BTreeMap<String, String>>>,
    available: Rc<Cell<bool>>,
}

impl Keystore for FakeKeystore {
    fn available(&self) -> bool {
        self.available.get()
    }
    fn get(&self, owner: &str) -> Option<String> {
        self.vault.borrow().get(owner).cloned()
    }
    fn set(&mut self, owner: &str, key: Option<&str>) -> bool {
        if !self.available.get() {
            return false;
        }
        match key {
            Some(key) => self
                .vault
                .borrow_mut()
                .insert(owner.to_owned(), key.to_owned()),
            None => self.vault.borrow_mut().remove(owner),
        };
        true
    }
    fn remove(&mut self, owner: &str) {
        self.vault.borrow_mut().remove(owner);
    }
}

fn view_json(view: &impl serde::Serialize) -> Value {
    serde_json::to_value(view).unwrap_or(Value::Null)
}

fn error_text(error: impl std::fmt::Display) -> Value {
    json!({ "error": error.to_string() })
}

fn models_case(input: &Value) -> Value {
    let kv = FakeKv::default();
    let keystore = FakeKeystore {
        vault: Rc::new(RefCell::new(BTreeMap::new())),
        available: Rc::new(Cell::new(true)),
    };
    let mut registry = Registry::new(kv, keystore, Catalog::bundled());
    let add = AddArgs {
        provider_type: text(input.get("type")).unwrap_or_default(),
        label: None,
        base_url: text(input.get("baseUrl")),
        headers: None,
    };
    let id = registry.add(add).map(|view| view.id).unwrap_or_default();
    if let Some(key) = text(input.get("setKey")) {
        registry
            .set_key(&id, &key)
            .expect("the fixture key is accepted");
    }
    if let Some(patch) = input.get("update") {
        let patch: Patch = serde_json::from_value(patch.clone()).expect("a fixture patch reads");
        registry
            .update(&id, patch)
            .expect("the fixture update is accepted");
    }
    let mut accounts = BTreeMap::new();
    if let Some(spec) = input.get("accounts").and_then(Value::as_object) {
        for (protocol, answer) in spec {
            let outcome = match answer.get("error").and_then(Value::as_str) {
                Some(message) => Err(message.to_owned()),
                None => Ok(answer["models"]
                    .as_array()
                    .map(|items| items.iter().map(listed_model_of).collect())
                    .unwrap_or_default()),
            };
            accounts.insert(protocol.clone(), outcome);
        }
    }
    let http = RoutedHttp {
        routes: Rc::new(
            input
                .get("routes")
                .and_then(Value::as_object)
                .map(|m| m.clone().into_iter().collect())
                .unwrap_or_default(),
        ),
    };
    let mut lister = ModelLister::new(http);
    for (protocol, outcome) in accounts {
        lister = lister.with_account(&protocol, Box::new(FixedAccount(outcome)));
    }
    let now = input.get("now").and_then(Value::as_u64).unwrap_or(0);
    match lister.list(&registry, &id, false, now) {
        Ok(models) => json!({ "listed": models.iter().map(view_json).collect::<Vec<_>>() }),
        Err(ListError::Failure(failure)) => json!({ "error": { "failure": failure } }),
        Err(ListError::Other(message)) => json!({ "error": { "message": message } }),
    }
}

fn registry_case(input: &Value) -> Value {
    let kv = FakeKv::default();
    if let Some(store) = input.get("store").and_then(|s| s.get("providers")) {
        let stored = store
            .as_str()
            .map_or_else(|| store.to_string(), str::to_owned);
        kv.0.borrow_mut().insert("providers".to_owned(), stored);
    }
    let vault = Rc::new(RefCell::new(BTreeMap::new()));
    let available = Rc::new(Cell::new(
        input
            .get("keystore")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    ));
    let keystore = FakeKeystore {
        vault: vault.clone(),
        available: available.clone(),
    };
    let mut registry = Registry::new(kv.clone(), keystore, Catalog::bundled());
    let mut results = Vec::new();
    for op in input["ops"].as_array().cloned().unwrap_or_default() {
        let id = text(op.get("id")).unwrap_or_default();
        let outcome: Result<Value, String> = match op["op"].as_str().unwrap_or_default() {
            "add" => {
                let args: AddArgs =
                    serde_json::from_value(op["args"].clone()).expect("a fixture add reads");
                registry
                    .add(args)
                    .map(|view| view_json(&view))
                    .map_err(|e| e.to_string())
            }
            "update" => {
                let patch: Patch =
                    serde_json::from_value(op["patch"].clone()).expect("a fixture patch reads");
                registry
                    .update(&id, patch)
                    .map(|view| view_json(&view))
                    .map_err(|e| e.to_string())
            }
            "setKey" => registry
                .set_key(&id, op["key"].as_str().unwrap_or_default())
                .map(|view| view_json(&view))
                .map_err(|e| e.to_string()),
            "remove" => {
                registry.remove(&id);
                Ok(json!({ "success": true }))
            }
            "list" => Ok(Value::Array(
                registry.list().iter().map(view_json).collect(),
            )),
            "get" => Ok(registry
                .get(&id)
                .map_or(Value::Null, |instance| view_json(&instance))),
            "connectionFor" => Ok(registry
                .connection_for(&id)
                .map_or(Value::Null, |c| connection_json(&c))),
            "enabledBaseUrls" => Ok(json!(registry.enabled_base_urls())),
            "keystore" => {
                available.set(op["available"].as_bool().unwrap_or(true));
                Ok(Value::Null)
            }
            "vaultSize" => Ok(json!(vault.borrow().len())),
            other => panic!("unknown registry op {other}"),
        };
        results.push(match outcome {
            Ok(value) => json!({ "value": value }),
            Err(message) => json!({ "error": message }),
        });
    }
    let providers = kv
        .get(KEY_PROVIDERS)
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);
    let vault_json: Map<String, Value> = vault
        .borrow()
        .iter()
        .map(|(owner, key)| (owner.clone(), json!(key)))
        .collect();
    json!({ "results": results, "providers": providers, "vault": vault_json })
}

const KEY_PROVIDERS: &str = "providers";

fn connection_json(connection: &InstanceConnection) -> Value {
    json!({
        "instance": view_json(&connection.instance),
        "baseUrl": connection.base_url,
        "apiKey": connection.api_key,
        "headers": connection.headers,
        "entryId": connection.entry.as_ref().map(|e| e.id.clone()),
    })
}

fn remote_case(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "merge" => {
            let in_use: Vec<String> = input
                .get("inUse")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let file = &input["file"];
            match merge(
                file,
                &in_use,
                input.get("previous").filter(|p| !p.is_null()),
            ) {
                Ok(entries) => {
                    let file_ids: Vec<String> = file["providers"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|p| text(p.get("id"))).collect())
                        .unwrap_or_default();
                    let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
                    let kept: Vec<Value> = entries
                        .iter()
                        .filter(|e| {
                            e.remote == Some(true)
                                || file_ids.contains(&e.id)
                                || in_use.contains(&e.id)
                        })
                        .map(view_json)
                        .collect();
                    json!({ "ids": ids, "entries": kept })
                }
                Err(error) => error_text(error),
            }
        }
        "verify" => {
            let key = match input["publicKey"].as_str() {
                Some("builtin") | None => PUBLIC_KEY.to_owned(),
                Some(pem) => pem.to_owned(),
            };
            json!(verified(
                input["body"].as_str().unwrap_or_default(),
                input["signature"].as_str().unwrap_or_default(),
                &key
            ))
        }
        other => panic!("unknown remote op {other}"),
    }
}

/// A fake of loopback for discovery: each port answers the paths it names, and counts every probe it gets.
#[derive(Clone)]
struct LoopbackHttp {
    servers: Rc<BTreeMap<u16, BTreeMap<String, Value>>>,
    probes: Rc<RefCell<BTreeMap<String, u64>>>,
}

impl HttpClient for LoopbackHttp {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        let url = url::Url::parse(&request.url).expect("a probe URL parses");
        let port = url.port().unwrap_or_default();
        *self
            .probes
            .borrow_mut()
            .entry(port.to_string())
            .or_insert(0) += 1;
        let Some(server) = self.servers.get(&port) else {
            return Err(TransportError {
                message: "fetch failed".to_owned(),
                cause_message: Some("ECONNREFUSED".to_owned()),
                code: None,
            });
        };
        match server.get(url.path()) {
            None => Ok(HttpResponse {
                status: 404,
                headers: BTreeMap::new(),
                body: "not found".to_owned(),
            }),
            Some(Value::String(raw)) => Ok(HttpResponse {
                status: 200,
                headers: BTreeMap::new(),
                body: raw.clone(),
            }),
            Some(value) => Ok(HttpResponse {
                status: 200,
                headers: BTreeMap::new(),
                body: value.to_string(),
            }),
        }
    }
}

fn discovery_case(input: &Value) -> Value {
    let servers: BTreeMap<u16, BTreeMap<String, Value>> = input
        .get("servers")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(port, paths)| {
                    let paths = paths
                        .as_object()
                        .map(|p| p.clone().into_iter().collect())
                        .unwrap_or_default();
                    (port.parse().unwrap_or_default(), paths)
                })
                .collect()
        })
        .unwrap_or_default();
    let excluded: Vec<u16> = input
        .get("excludedPorts")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_u64().map(|n| n as u16))
                .collect()
        })
        .unwrap_or_default();
    let is_dev = input.get("isDev").and_then(Value::as_bool).unwrap_or(false);
    let probes = Rc::new(RefCell::new(BTreeMap::new()));
    let http = LoopbackHttp {
        servers: Rc::new(servers),
        probes: probes.clone(),
    };
    let catalog = Catalog::bundled();
    let found = Discovery::new(http).scan(&catalog, &excluded, is_dev);
    let scanned_ports = ports(&catalog, &excluded, is_dev);
    json!({
        "ports": scanned_ports,
        "found": found.iter().map(view_json).collect::<Vec<_>>(),
        "probes": probes.borrow().clone(),
    })
}

/// Listing parsing and the helpers the listings file exercises.
fn listings_case(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "parse_models" => {
            let json = &input["json"];
            match input["protocol"].as_str().unwrap_or_default() {
                "openai" => Value::Array(
                    openai::parse_models(json)
                        .into_iter()
                        .map(|m| json!({ "id": m.id, "contextLength": m.context_length, "supported": m.supported, "inputModalities": m.input_modalities }))
                        .collect(),
                ),
                "ollama" => Value::Array(ollama::parse_models(json).into_iter().map(|m| json!({ "id": m.id, "contextLength": null, "cloud": m.cloud })).collect()),
                "anthropic" => Value::Array(anthropic::parse_models(json).into_iter().map(|m| json!({ "id": m.id, "contextLength": m.context_length })).collect()),
                _ => Value::Array(gemini::parse_models(json).into_iter().map(|m| json!({ "id": m.id, "contextLength": m.context_length })).collect()),
            }
        }
        "parse_show" => {
            let show = ollama::parse_show(&input["json"]);
            json!({ "capabilities": show.capabilities, "contextLength": show.context_length })
        }
        "sanitize" => gemini::sanitize_schema(&input["schema"]),
        "thinking_style" => json!(anthropic::thinking_style(
            input["model"].as_str().unwrap_or_default()
        )),
        other => panic!("unknown listing op {other}"),
    }
}

fn requests_case(input: &Value) -> Value {
    let connection = connection_of(input);
    let model_id = text(input.get("modelId"))
        .or_else(|| text(input.get("model")))
        .unwrap_or_default();
    let request = match input["op"].as_str().unwrap_or_default() {
        "show_request" => ollama::show_request(&connection, &model_id),
        "models_request" => match input["protocol"].as_str().unwrap_or_default() {
            "openai" => openai::models_request(&connection),
            "anthropic" => anthropic::models_request(&connection),
            "gemini" => gemini::models_request(&connection),
            _ => ollama::models_request(&connection),
        },
        _ => {
            let body = chat_request(&input["body"]);
            match input["protocol"].as_str().unwrap_or_default() {
                "openai" => openai::build_request(&body, &connection, &model_id),
                "anthropic" => anthropic::build_request(&body, &connection, &model_id),
                "gemini" => gemini::build_request(&body, &connection, &model_id),
                _ => ollama::build_request(&body, &connection, &model_id),
            }
        }
    };
    request_json(&request)
}

fn answers_case(input: &Value) -> Value {
    let protocol = input["protocol"].as_str().unwrap_or_default();
    let instance = match input.get("instanceId") {
        None => Some(protocol.to_owned()),
        Some(Value::Null) => None,
        Some(other) => other.as_str().map(str::to_owned),
    };
    let body = &input["body"];
    let outcome: Result<draggy_providers::types::Completion, ProviderError> = match protocol {
        "openai" => openai::translate_json(body),
        "anthropic" => anthropic::translate_json(body, instance.as_deref()),
        "gemini" => gemini::translate_json(body, instance.as_deref()),
        _ => Ok(ollama::translate_json(body)),
    };
    match outcome {
        Ok(answer) => json!({ "completion": answer }),
        Err(failure) => json!({ "error": failure }),
    }
}

fn catalog_case(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "entry" => Catalog::bundled()
            .find(input["id"].as_str().unwrap_or_default())
            .map_or(Value::Null, view_json),
        "capabilities" => {
            let caps = capabilities_for(
                catalog_entry(input["provider"].as_str()).as_ref(),
                input["model"].as_str().unwrap_or_default(),
            );
            json!({ "capabilities": caps.capabilities, "contextLength": caps.context_length, "maxOutputTokens": caps.max_output_tokens })
        }
        "problem" => problem_with(&input["entry"]).map_or(Value::Null, |problem| json!(problem)),
        other => panic!("unknown catalog op {other}"),
    }
}

fn errors_case(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "response" => {
            let headers = headers_of(input.get("headers"));
            let status = input["status"].as_u64().unwrap_or_default() as u16;
            let failure = match input.get("body") {
                Some(Value::Object(_) | Value::Array(_)) => {
                    from_response_value(status, &input["body"], &headers, 0)
                }
                body => from_response_text(
                    status,
                    body.and_then(Value::as_str).unwrap_or_default(),
                    &headers,
                    0,
                ),
            };
            json!(failure)
        }
        "network" => {
            let cause = input.get("cause");
            let error = TransportError {
                message: text(input.get("message")).unwrap_or_default(),
                cause_message: cause.and_then(|c| text(c.get("message"))),
                code: None,
            };
            json!(from_network(&error))
        }
        "retryable" => {
            let failure: ProviderError =
                serde_json::from_value(input["failure"].clone()).expect("a fixture failure reads");
            json!(is_retryable(&failure))
        }
        "retry_after" => {
            let value = text(input.get("value"));
            let now = input["now"].as_f64().unwrap_or_default() as u64;
            retry_after_seconds(value.as_deref().unwrap_or_default(), now)
                .map_or(Value::Null, |seconds| json!(seconds))
        }
        other => panic!("unknown errors op {other}"),
    }
}

fn sse_case(input: &Value) -> Value {
    if input["op"] == "completion" {
        let args = &input["args"];
        let usage = Usage {
            prompt_tokens: args["usage"]["promptTokens"].as_u64().unwrap_or_default(),
            output_tokens: args["usage"]["outputTokens"].as_u64().unwrap_or_default(),
            ..Usage::default()
        };
        let tool_calls: Vec<Value> = args
            .get("toolCalls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return completion(
            args.get("content")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            args.get("reasoning")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            &tool_calls,
            finish_reason(args.get("finish").and_then(Value::as_str).unwrap_or("stop")),
            usage,
        );
    }
    let mut clock = 1000u64;
    let mut writer = SseWriter::new(move || {
        clock += 100;
        clock
    });
    let mut frames: Vec<Value> = Vec::new();
    for op in input["ops"].as_array().cloned().unwrap_or_default() {
        match op["op"].as_str().unwrap_or_default() {
            "delta" => writer.delta(Delta {
                content: text(op.get("content")),
                reasoning: text(op.get("reasoning")),
                tool_calls: op
                    .get("toolCalls")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            }),
            "finish" => {
                let usage = Usage {
                    prompt_tokens: op["usage"]["promptTokens"].as_u64().unwrap_or_default(),
                    output_tokens: op["usage"]["outputTokens"].as_u64().unwrap_or_default(),
                    ..Usage::default()
                };
                writer.finish(text(op.get("reason")).map(|r| finish_reason(&r)), usage);
            }
            "retry" => writer.retry(
                op["attempt"].as_u64().unwrap_or_default(),
                op["of"].as_u64().unwrap_or_default(),
                op.get("retryAfterMs").and_then(Value::as_u64),
            ),
            "providerState" => {
                let state: ProviderState =
                    serde_json::from_value(op["state"].clone()).expect("a fixture state reads");
                writer.provider_state(&state);
            }
            "error" => {
                let error: ProviderError =
                    serde_json::from_value(op["error"].clone()).expect("a fixture error reads");
                writer.error(&error);
            }
            "malformed" => writer.malformed(),
            "done" => writer.done(),
            "stop" => writer.stop(op.get("how").and_then(Value::as_str).unwrap_or("abort")),
            other => panic!("unknown sse op {other}"),
        }
        for frame in writer.take_frames() {
            frames.push(parse_frame(&frame));
        }
        if op["op"] == "done" {
            frames.push(json!({ "closed": true }));
        }
    }
    Value::Array(frames)
}

/// One frame as the fixture reads it: its JSON payload, or the done marker.
fn parse_frame(frame: &str) -> Value {
    let payload = frame
        .strip_prefix("data: ")
        .and_then(|rest| rest.strip_suffix("\n\n"))
        .unwrap_or_default();
    if payload == "[DONE]" {
        return json!("[DONE]");
    }
    serde_json::from_str(payload).expect("a frame carries JSON")
}

/// These fixtures pin the legacy prompt and output counts; the token split has its own `usage` fixture.
fn without_split(mut value: Value) -> Value {
    match &mut value {
        Value::Object(map) => {
            if let Some(Value::Object(usage)) = map.get_mut("usage") {
                usage.remove("tokens");
            }
            for child in map.values_mut() {
                *child = without_split(child.take());
            }
        }
        Value::Array(items) => {
            for child in items.iter_mut() {
                *child = without_split(child.take());
            }
        }
        _ => {}
    }
    value
}

fn usage_case(input: &Value) -> Value {
    let payload = input.get("payload");
    let count = |key: &str| {
        payload
            .and_then(|p| p.get(key))
            .and_then(Value::as_u64)
            .unwrap_or_default()
    };
    let usage = match input["vendor"].as_str().unwrap_or_default() {
        "anthropic" => from_anthropic(payload),
        "openai" => from_openai(payload),
        "gemini" => from_gemini(payload),
        "codex" => from_codex(payload),
        "totals" => from_totals(count("prompt"), count("output")),
        other => panic!("unknown usage vendor {other}"),
    };
    json!({
        "promptTokens": usage.prompt_tokens,
        "outputTokens": usage.output_tokens,
        "tokens": usage.tokens,
    })
}

fn autopin_case(input: &Value) -> Value {
    let entry: CatalogEntry = serde_json::from_value(json!({
        "id": "fixture",
        "name": "Fixture",
        "kind": "cloud",
        "protocol": "openai",
        "auth": "bearer",
        "noisePatterns": input["noisePatterns"].clone(),
    }))
    .expect("a fixture entry reads");
    let list = |value: &Value| -> Option<Vec<String>> {
        value.as_array().map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
    };
    let listed = list(&input["listed"]).unwrap_or_default();
    let pinned = list(&input["pinned"]).unwrap_or_default();
    let seen = list(&input["seen"]);
    let plan = plan_pins(Some(&entry), &listed, &pinned, seen.as_deref());
    json!({
        "seenModels": plan.seen_models,
        "pinnedModels": plan.pinned_models,
        "added": plan.added,
    })
}

/// Runs one case of the named fixture file through the port.
fn run(area: &str, input: &Value) -> Value {
    match area {
        "autopin" => autopin_case(input),
        "sse" => sse_case(input),
        "errors" => errors_case(input),
        "catalog" => catalog_case(input),
        "requests" => requests_case(input),
        "streams" => {
            let events = stream_events(input);
            Value::Array(events.iter().map(view_json).map(without_split).collect())
        }
        "answers" => without_split(answers_case(input)),
        "listings" => listings_case(input),
        "models" => models_case(input),
        "registry" => registry_case(input),
        "remote" => remote_case(input),
        "discovery" => discovery_case(input),
        "usage" => usage_case(input),
        other => panic!("no runner for fixture area {other}"),
    }
}

#[test]
fn providers_fixtures_match_the_typescript_reference() {
    let mut failures = Vec::new();
    let mut total = 0;
    for file in files("providers") {
        // The CLI-runtime and gateway files run in fixtures_cli.rs, which dispatches on each case's driver.
        if file.starts_with("providers-cli-") || file.starts_with("providers-gateway-") {
            continue;
        }
        let area = file.trim_end_matches(".json").to_owned();
        for case in cases("providers", &file) {
            total += 1;
            let name = case["name"].as_str().unwrap_or_default();
            let actual = canon(&run(&area, &case["input"]));
            let expected = canon(&case["expected"]);
            if actual != expected {
                failures.push(format!(
                    "{area} / {name}\n  expected {expected}\n  actual   {actual}"
                ));
            }
        }
    }
    assert!(total > 0, "no providers fixture cases were found");
    assert!(
        failures.is_empty(),
        "{} of {total} providers fixture cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
