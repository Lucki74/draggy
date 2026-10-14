//! The stateful and timed behaviour of the providers crate, against fakes: the listing cache over time, the signed
//! catalog's fetch and stored copy, the timeouts each probe carries, and a catalog swap. Nothing here touches the
//! network or a disk; time is passed in as a number.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_providers::catalog::{Catalog, CatalogEntry};
use draggy_providers::discovery::{Discovery, ports};
use draggy_providers::http::{HttpClient, HttpRequest, HttpResponse, TransportError};
use draggy_providers::models::{ListError, ModelLister};
use draggy_providers::registry::{AddArgs, Keystore, KvStore, Registry};
use draggy_providers::remote_catalog::{
    InstanceUse, PUBLIC_KEY, Refresh, RemoteCatalog, STORE, URL_JSON, verified,
};
use draggy_providers::sse::{Delta, LineSplitter, SseWriter};
use draggy_providers::types::{ErrorKind, Usage};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{Value, json};

/// A fake network: each URL answers with a fixed response, and every request is recorded.
#[derive(Clone, Default)]
struct FakeNet {
    answers: Rc<RefCell<HashMap<String, HttpResponse>>>,
    requests: Rc<RefCell<Vec<HttpRequest>>>,
    calls: Rc<Cell<u32>>,
}

impl FakeNet {
    fn answer(&self, url: &str, status: u16, body: &str) {
        self.answers.borrow_mut().insert(
            url.to_owned(),
            HttpResponse {
                status,
                headers: BTreeMap::new(),
                body: body.to_owned(),
            },
        );
    }

    fn answer_with_etag(&self, url: &str, status: u16, body: &str, etag: &str) {
        let headers = BTreeMap::from([("etag".to_owned(), etag.to_owned())]);
        self.answers.borrow_mut().insert(
            url.to_owned(),
            HttpResponse {
                status,
                headers,
                body: body.to_owned(),
            },
        );
    }
}

impl HttpClient for FakeNet {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        self.calls.set(self.calls.get() + 1);
        self.requests.borrow_mut().push(request.clone());
        self.answers
            .borrow()
            .get(&request.url)
            .cloned()
            .ok_or_else(|| TransportError {
                message: "fetch failed".to_owned(),
                cause_message: Some("ECONNREFUSED".to_owned()),
                code: None,
            })
    }
}

/// A key-value store the test can read back after the code under test has written to it.
#[derive(Clone, Default)]
struct Kv(Rc<RefCell<BTreeMap<String, String>>>);

impl KvStore for Kv {
    fn get(&self, key: &str) -> Option<String> {
        self.0.borrow().get(key).cloned()
    }
    fn set(&mut self, key: &str, value: &str) {
        self.0.borrow_mut().insert(key.to_owned(), value.to_owned());
    }
}

#[derive(Clone, Default)]
struct Vault(Rc<RefCell<BTreeMap<String, String>>>);

impl Keystore for Vault {
    fn available(&self) -> bool {
        true
    }
    fn get(&self, owner: &str) -> Option<String> {
        self.0.borrow().get(owner).cloned()
    }
    fn set(&mut self, owner: &str, key: Option<&str>) -> bool {
        match key {
            Some(key) => self.0.borrow_mut().insert(owner.to_owned(), key.to_owned()),
            None => self.0.borrow_mut().remove(owner),
        };
        true
    }
    fn remove(&mut self, owner: &str) {
        self.0.borrow_mut().remove(owner);
    }
}

fn openai_registry(vault: &Vault) -> Registry<Kv, Vault> {
    let mut registry = Registry::new(Kv::default(), vault.clone(), Catalog::bundled());
    registry
        .add(AddArgs {
            provider_type: "openai".to_owned(),
            ..AddArgs::default()
        })
        .expect("openai is in the catalog");
    registry
        .set_key("openai", "sk-test")
        .expect("a key is stored");
    registry
}

const OPENAI_MODELS: &str = "https://api.openai.com/v1/models";

fn openai_net(status: u16, body: &str) -> FakeNet {
    let net = FakeNet::default();
    net.answer(OPENAI_MODELS, status, body);
    net
}

#[test]
fn a_listing_is_kept_a_day_and_asked_again_on_refresh_or_after() {
    let net = openai_net(200, r#"{"data":[{"id":"gpt-5.5"}]}"#);
    let calls = net.calls.clone();
    let vault = Vault::default();
    let registry = openai_registry(&vault);
    let mut lister = ModelLister::new(net);
    let day = 24 * 60 * 60 * 1000;

    lister
        .list(&registry, "openai", false, 0)
        .expect("the listing answers");
    lister
        .list(&registry, "openai", false, 23 * 60 * 60 * 1000)
        .expect("the cache answers");
    assert_eq!(calls.get(), 1, "a day-old listing is served from the cache");
    lister
        .list(&registry, "openai", true, 23 * 60 * 60 * 1000)
        .expect("refresh asks again");
    assert_eq!(calls.get(), 2);
    lister
        .list(&registry, "openai", false, 23 * 60 * 60 * 1000 + day + 1)
        .expect("an old listing is asked again");
    assert_eq!(calls.get(), 3);
}

#[test]
fn a_refusal_is_kept_a_minute_so_the_menu_does_not_ask_every_time() {
    let net = openai_net(401, r#"{"error":{"message":"Incorrect API key provided"}}"#);
    let calls = net.calls.clone();
    let vault = Vault::default();
    let registry = openai_registry(&vault);
    let mut lister = ModelLister::new(net);

    let first = lister
        .list(&registry, "openai", false, 0)
        .expect_err("the refusal is named");
    assert!(matches!(&first, ListError::Failure(f) if f.kind == ErrorKind::InvalidKey));
    assert!(lister.list(&registry, "openai", false, 0).is_err());
    assert_eq!(calls.get(), 1, "the second look is answered from the cache");
    assert!(lister.list(&registry, "openai", false, 61_000).is_err());
    assert_eq!(calls.get(), 2, "after a minute the listing is asked again");
    assert!(lister.list(&registry, "openai", true, 61_000).is_err());
    assert_eq!(calls.get(), 3, "a refresh always asks");
}

#[test]
fn every_listing_request_carries_the_fifteen_second_timeout() {
    let net = openai_net(200, r#"{"data":[]}"#);
    let seen = net.requests.clone();
    let registry = openai_registry(&Vault::default());
    ModelLister::new(net)
        .list(&registry, "openai", false, 0)
        .expect("the listing answers");
    let requests = seen.borrow();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].timeout_ms, Some(15_000));
    assert_eq!(
        requests[0].headers.get("Authorization").map(String::as_str),
        Some("Bearer sk-test")
    );
}

#[test]
fn a_catalog_swap_changes_which_models_are_offered_as_new() {
    let vault = Vault::default();
    let mut registry = openai_registry(&vault);
    let before = registry.list();
    assert!(before[0].new_models.is_empty());

    let mut catalog = Catalog::bundled();
    let entries: Vec<CatalogEntry> = catalog
        .entries()
        .iter()
        .map(|entry| {
            let mut entry = entry.clone();
            if entry.id == "openai" {
                entry.default_models.push("gpt-9".to_owned());
            }
            entry
        })
        .collect();
    catalog = Catalog::from_entries(entries);
    registry.set_catalog(catalog);
    let after = registry.list();
    assert_eq!(after[0].new_models, vec!["gpt-9".to_owned()]);
    assert!(
        !after[0].pinned_models.contains(&"gpt-9".to_owned()),
        "a new model is never ticked for the user"
    );
}

#[test]
fn a_probe_of_a_local_server_gives_up_within_its_400_millisecond_timeout() {
    let net = FakeNet::default();
    let seen = net.requests.clone();
    let found = Discovery::new(net).scan(&Catalog::bundled(), &[], false);
    assert!(found.is_empty());
    let requests = seen.borrow();
    assert!(!requests.is_empty());
    assert!(
        requests
            .iter()
            .all(|r| r.timeout_ms == Some(400) && r.url.starts_with("http://127.0.0.1:"))
    );
}

#[test]
fn draggys_own_ports_are_left_out_of_the_scan() {
    let scanned = ports(&Catalog::bundled(), &[8080, 11500], true);
    assert!(!scanned.contains(&8080));
    assert!(!scanned.contains(&5173));
    assert!(scanned.contains(&11434));
}

/// The Ed25519 pair the signed-catalog cases sign with, from a fixed seed so every run is the same.
fn signing_key() -> (Ed25519KeyPair, String) {
    let seed = [7u8; 32];
    let pair = Ed25519KeyPair::from_seed_unchecked(&seed).expect("a 32-byte seed makes a key");
    let mut der = vec![
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    der.extend_from_slice(pair.public_key().as_ref());
    let pem = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n",
        STANDARD.encode(der)
    );
    (pair, pem)
}

fn signed(pair: &Ed25519KeyPair, body: &str) -> String {
    STANDARD.encode(pair.sign(body.as_bytes()).as_ref())
}

fn signed_file(provider: Value) -> String {
    json!({ "version": 1, "providers": [provider] }).to_string()
}

fn newcloud() -> Value {
    json!({
        "id": "newcloud",
        "name": "New Cloud",
        "kind": "cloud",
        "protocol": "openai",
        "baseUrl": "https://api.newcloud.example/v1",
        "keyUrl": "https://newcloud.example/keys",
        "auth": "bearer",
        "defaultModels": ["nc-1"],
    })
}

fn cloud_enabled() -> Vec<InstanceUse> {
    vec![InstanceUse {
        provider_type: "openai".to_owned(),
        kind: "cloud".to_owned(),
        enabled: true,
    }]
}

#[test]
fn a_signed_file_is_fetched_once_a_day_and_then_asked_with_its_etag() {
    let (pair, pem) = signing_key();
    let body = signed_file(newcloud());
    let net = FakeNet::default();
    net.answer_with_etag(URL_JSON, 200, &body, "\"v1\"");
    net.answer(&format!("{URL_JSON}.sig"), 200, &signed(&pair, &body));
    let kv = Kv::default();
    let mut remote = RemoteCatalog::new(kv.clone(), net.clone(), pem.clone());

    let Refresh::Updated(catalog) = remote.refresh(1_000_000_000_000, &cloud_enabled()) else {
        panic!("a signed file is accepted");
    };
    assert!(
        catalog
            .find("newcloud")
            .is_some_and(|entry| entry.remote == Some(true))
    );
    assert_eq!(
        remote.refresh(1_000_000_000_000 + 1000, &cloud_enabled()),
        Refresh::Fresh
    );

    net.answers.borrow_mut().insert(
        URL_JSON.to_owned(),
        HttpResponse {
            status: 304,
            headers: BTreeMap::new(),
            body: String::new(),
        },
    );
    let later = 1_000_000_000_000 + 24 * 60 * 60 * 1000;
    assert_eq!(remote.refresh(later, &cloud_enabled()), Refresh::Unchanged);
    let last = net
        .requests
        .borrow()
        .last()
        .cloned()
        .expect("the refresh asked");
    assert_eq!(
        last.headers.get("If-None-Match").map(String::as_str),
        Some("\"v1\"")
    );
    assert!(verified(&body, &signed(&pair, &body), &pem));
}

#[test]
fn a_tampered_file_is_refused_and_the_bundled_catalog_stays() {
    let (pair, pem) = signing_key();
    let good = signed_file(newcloud());
    let tampered = good.replace("api.newcloud", "api.evil");
    let net = FakeNet::default();
    net.answer(URL_JSON, 200, &tampered);
    net.answer(&format!("{URL_JSON}.sig"), 200, &signed(&pair, &good));
    let kv = Kv::default();
    let mut remote = RemoteCatalog::new(kv.clone(), net, pem);

    assert_eq!(
        remote.refresh(0, &cloud_enabled()),
        Refresh::Failed("bad signature".to_owned())
    );
    assert!(
        kv.get(STORE).is_some_and(|text| !text.contains("body")),
        "the failed copy is not stored"
    );
    assert!(remote.load(&cloud_enabled()).is_none());
}

#[test]
fn a_failed_attempt_waits_a_day_as_well() {
    let net = FakeNet::default();
    net.answer(URL_JSON, 500, "");
    let seen = net.requests.clone();
    let mut remote = RemoteCatalog::new(Kv::default(), net, PUBLIC_KEY);
    let now = 1_000_000_000_000;
    assert!(matches!(
        remote.refresh(now, &cloud_enabled()),
        Refresh::Failed(_)
    ));
    assert_eq!(remote.refresh(now + 1000, &cloud_enabled()), Refresh::Fresh);
    assert_eq!(
        seen.borrow().len(),
        1,
        "the second look inside the day is not a fetch"
    );
}

#[test]
fn nothing_is_fetched_while_no_cloud_provider_is_on() {
    let net = FakeNet::default();
    let calls = net.calls.clone();
    let mut remote = RemoteCatalog::new(Kv::default(), net, PUBLIC_KEY);
    let off = vec![InstanceUse {
        provider_type: "openai".to_owned(),
        kind: "cloud".to_owned(),
        enabled: false,
    }];
    assert_eq!(remote.refresh(0, &off), Refresh::Skipped);
    assert_eq!(calls.get(), 0);
}

#[test]
fn a_stored_copy_is_checked_again_at_start_so_an_edit_on_disk_is_not_trusted() {
    let (pair, pem) = signing_key();
    let body = signed_file(newcloud());
    let net = FakeNet::default();
    net.answer(URL_JSON, 200, &body);
    net.answer(&format!("{URL_JSON}.sig"), 200, &signed(&pair, &body));
    let kv = Kv::default();
    let mut remote = RemoteCatalog::new(kv.clone(), net, pem.clone());
    assert!(matches!(
        remote.refresh(0, &cloud_enabled()),
        Refresh::Updated(_)
    ));

    let fresh = RemoteCatalog::new(kv.clone(), FakeNet::default(), pem.clone());
    assert!(
        fresh
            .load(&cloud_enabled())
            .and_then(|c| c.find("newcloud").cloned())
            .is_some()
    );

    let mut saved: Value = serde_json::from_str(&kv.get(STORE).expect("the copy is stored"))
        .expect("the stored copy is JSON");
    saved["body"] = json!(
        saved["body"]
            .as_str()
            .unwrap_or_default()
            .replace("api.newcloud", "api.evil")
    );
    let mut edited = kv.clone();
    edited.set(STORE, &saved.to_string());
    assert!(
        RemoteCatalog::new(kv, FakeNet::default(), pem)
            .load(&cloud_enabled())
            .is_none()
    );
}

#[test]
fn a_line_that_arrives_in_pieces_waits_for_its_newline() {
    let mut splitter = LineSplitter::default();
    assert!(splitter.push(b"data: {\"a\"").is_empty());
    assert_eq!(
        splitter.push(b":1}\r\n\ndata: two\n"),
        vec![
            "data: {\"a\":1}\r".to_owned(),
            String::new(),
            "data: two".to_owned()
        ]
    );
    assert_eq!(splitter.push(b"tail"), Vec::<String>::new());
    assert_eq!(splitter.take_rest(), "tail");
}

#[test]
fn a_multi_byte_character_split_across_reads_is_read_whole() {
    let euro = "€".as_bytes();
    let mut splitter = LineSplitter::default();
    assert!(splitter.push(&euro[..1]).is_empty());
    assert_eq!(splitter.push(&euro[1..]).len(), 0);
    assert_eq!(splitter.push(b"\n"), vec!["€".to_owned()]);
}

#[test]
fn a_frame_is_a_data_line_and_a_blank_line() {
    let mut clock = 0u64;
    let mut writer = SseWriter::new(move || {
        clock += 1;
        clock
    });
    writer.delta(Delta {
        content: Some("Hi".to_owned()),
        ..Delta::default()
    });
    writer.done();
    let frames = writer.take_frames();
    assert_eq!(frames.len(), 2);
    assert!(frames[0].starts_with("data: {") && frames[0].ends_with("}\n\n"));
    assert_eq!(frames[1], "data: [DONE]\n\n");
    assert!(writer.is_closed());
}

#[test]
fn an_answer_is_timed_from_the_first_token_to_the_last() {
    let mut clock = 100u64;
    let mut writer = SseWriter::new(move || {
        clock += 10;
        clock
    });
    writer.delta(Delta {
        content: Some("a".to_owned()),
        ..Delta::default()
    });
    writer.finish(
        None,
        Usage {
            prompt_tokens: 3,
            output_tokens: 4,
        },
    );
    let frame = writer.take_frames().pop().expect("the finish frame");
    let payload: Value = serde_json::from_str(frame.trim_start_matches("data: ").trim_end())
        .expect("the frame is JSON");
    assert_eq!(payload["timings"]["prompt_ms"], json!(10));
    assert_eq!(payload["timings"]["predicted_ms"], json!(10));
    assert_eq!(payload["usage"]["total_tokens"], json!(7));
}

#[test]
fn a_key_is_never_in_the_listed_view_of_the_registry() {
    let vault = Vault::default();
    let registry = openai_registry(&vault);
    let text = serde_json::to_string(&registry.list()).expect("the view is JSON");
    assert!(!text.contains("sk-test"));
    assert!(text.contains("\"keyHint\":\"test\""));
}

#[test]
fn the_registry_fails_without_a_key_when_a_keyed_provider_is_switched_on() {
    let mut registry = Registry::new(Kv::default(), Vault::default(), Catalog::bundled());
    registry
        .add(AddArgs {
            provider_type: "openai".to_owned(),
            ..AddArgs::default()
        })
        .expect("openai is in the catalog");
    let refused = registry.update(
        "openai",
        draggy_providers::registry::Patch {
            enabled: Some(true),
            ..Default::default()
        },
    );
    assert_eq!(
        refused.map_err(|e| e.0).expect_err("a key is needed"),
        "Add a key first."
    );
}

#[test]
fn a_bundled_entry_is_checked_on_the_same_bar_as_a_remote_one() {
    for entry in Catalog::bundled().entries() {
        let value = serde_json::to_value(entry).expect("an entry is JSON");
        assert_eq!(
            draggy_providers::catalog::problem_with(&value),
            None,
            "{}",
            entry.id
        );
    }
}
