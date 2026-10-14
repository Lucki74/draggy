//! The credential store against the shared secrets fixtures (`shared/fixtures/secrets/*.json`), plus what the fixtures
//! cannot show: the bytes on disk, the file mode, the logs and the scrubber hook. The vitest runner reads the same files.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::alphabet;
use base64::engine::general_purpose::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use draggy_storage::secrets::{
    SafeStorageScheme, SecretStore, SecretVault, VaultError, decrypt_safe_storage_v10,
};
use draggy_testkit::{cases, files};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

const STORE: &str = "secrets.bin";
const SECRET: &str = "fixture-secret-0001";

/// Stands in for the keystore, as electron/secrets.test.js does: base64 both ways. A failed check reads as
/// unavailable, and a failed backend call as no backend, which is how the shells map the trait.
#[derive(Clone)]
struct FakeVault {
    available: bool,
    backend: Option<String>,
    encrypt_fails: bool,
    decrypt_fails: bool,
}

impl FakeVault {
    fn working() -> Self {
        Self {
            available: true,
            backend: None,
            encrypt_fails: false,
            decrypt_fails: false,
        }
    }

    fn unavailable() -> Self {
        Self {
            available: false,
            ..Self::working()
        }
    }

    fn with_backend(name: &str) -> Self {
        Self {
            backend: Some(name.to_string()),
            ..Self::working()
        }
    }
}

impl SecretVault for FakeVault {
    fn available(&self) -> bool {
        self.available
    }

    fn backend(&self) -> Option<String> {
        self.backend.clone()
    }

    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, VaultError> {
        if self.encrypt_fails {
            return Err(VaultError("encrypt refused".to_string()));
        }
        Ok(STANDARD.encode(plain).into_bytes())
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, VaultError> {
        if self.decrypt_fails {
            return Err(VaultError("decrypt refused".to_string()));
        }
        decode_container(blob)
    }
}

/// Node's base64 decoding: characters outside the alphabet are skipped, the URL-safe alphabet is read too, and the
/// first `=` ends the text. A lone character left over at the end is dropped. The fake reads containers the same way.
fn decode_container(blob: &[u8]) -> Result<Vec<u8>, VaultError> {
    let mut compact: Vec<u8> = blob
        .iter()
        .take_while(|byte| **byte != b'=')
        .filter_map(|byte| match byte {
            b'-' => Some(b'+'),
            b'_' => Some(b'/'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' => Some(*byte),
            _ => None,
        })
        .collect();
    if compact.len() % 4 == 1 {
        compact.pop();
    }
    lenient_base64()
        .decode(compact)
        .map_err(|error| VaultError(error.to_string()))
}

fn lenient_base64() -> GeneralPurpose {
    GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    )
}

fn object(pairs: Value) -> Map<String, Value> {
    pairs.as_object().cloned().unwrap_or_default()
}

fn open_store(dir: &Path, vault: &FakeVault) -> SecretStore<FakeVault> {
    SecretStore::new(dir, vault.clone())
}

#[test]
fn secrets_fixtures_match_the_reference() {
    let mut failures = Vec::new();
    let mut ran = 0;
    for file in files("secrets") {
        for case in cases("secrets", &file) {
            let name = case["name"].as_str().unwrap_or("<unnamed>");
            ran += 1;
            match run_case(&case["input"]) {
                Ok(actual) if actual == case["expected"] => {}
                Ok(actual) => failures.push(format!(
                    "{file} :: {name}: expected {}, got {actual}",
                    case["expected"]
                )),
                Err(error) => failures.push(format!("{file} :: {name}: {error}")),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} secrets fixture case(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        ran > 40,
        "only {ran} secrets cases ran; the fixture files did not load"
    );
}

fn run_case(input: &Value) -> Result<Value, String> {
    if let Some(blob) = input.get("blob").and_then(Value::as_str) {
        return run_v10(
            blob,
            input["password"].as_str().unwrap_or_default(),
            &input["scheme"],
        );
    }

    let dir = tempfile::tempdir().map_err(text)?;
    let vault = fake_vault(input.get("vault").unwrap_or(&Value::Null));
    if let Some(container) = input.get("container").and_then(Value::as_str) {
        fs::write(dir.path().join(STORE), container).map_err(text)?;
    }
    let mut store = open_store(dir.path(), &vault);
    let mut results = Vec::new();
    for entry in input["ops"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let call = entry["call"].as_str().unwrap_or_default();
        let args = entry
            .get("args")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        results.push(run_op(&mut store, dir.path(), &vault, call, &args)?);
    }
    Ok(Value::Array(results))
}

/// One op of a case. `reopen` is a close and a new store over the same file, as the reference's init does.
fn run_op(
    store: &mut SecretStore<FakeVault>,
    dir: &Path,
    vault: &FakeVault,
    call: &str,
    args: &[Value],
) -> Result<Value, String> {
    Ok(match call {
        "set" => json!(store.set(&text_arg(args, 0), &object_arg(args, 1))),
        "get" => store.get(&text_arg(args, 0)),
        "remove" => json!(store.remove(&text_arg(args, 0))),
        "owners" => json!(store.owners()),
        "withSecrets" => Value::Object(store.with_secrets(&text_arg(args, 0), &value_arg(args, 1))),
        "adopt" => {
            let marker = text_arg(args, 1);
            let adopted = store.adopt(&object_arg(args, 0), |field: &str, _owner: &str| {
                field.to_uppercase().contains(&marker)
            });
            json!({"moved": adopted.moved, "records": adopted.records})
        }
        "available" => json!(store.available()),
        "reopen" => {
            store.close();
            *store = open_store(dir, vault);
            Value::Null
        }
        "close" => {
            store.close();
            Value::Null
        }
        "container" => json!(read_container(dir)),
        "fileContains" => {
            json!(read_container(dir).is_some_and(|body| body.contains(&text_arg(args, 0))))
        }
        "writeContainer" => {
            fs::write(dir.join(STORE), text_arg(args, 0)).map_err(text)?;
            Value::Null
        }
        "makeDirectory" => {
            fs::create_dir(dir.join(STORE)).map_err(text)?;
            Value::Null
        }
        other => return Err(format!("unknown call {other}")),
    })
}

fn run_v10(blob: &str, password: &str, scheme: &Value) -> Result<Value, String> {
    let bytes = STANDARD.decode(blob).map_err(text)?;
    let scheme = if scheme.as_str() == Some("macos") {
        SafeStorageScheme::MacOs
    } else {
        SafeStorageScheme::Linux
    };
    Ok(
        match decrypt_safe_storage_v10(&bytes, password.as_bytes(), scheme) {
            Ok(plain) => json!({"plaintext": String::from_utf8(plain).map_err(text)?}),
            Err(error) => json!({"error": error.code()}),
        },
    )
}

/// The fixture's vault spec on the trait: `encryptionAvailable: "throws"` is unavailable, `backend: "throws"` is no backend.
fn fake_vault(spec: &Value) -> FakeVault {
    let available = match spec.get("encryptionAvailable") {
        None => true,
        Some(value) => value.as_bool().unwrap_or(false),
    };
    let backend = match spec.get("backend") {
        Some(Value::String(name)) if name.as_str() != "throws" => Some(name.clone()),
        _ => None,
    };
    FakeVault {
        available,
        backend,
        encrypt_fails: spec.get("encrypt").and_then(Value::as_str) == Some("throws"),
        decrypt_fails: spec.get("decrypt").and_then(Value::as_str) == Some("throws"),
    }
}

/// The store file as text, or None when there is no file.
fn read_container(dir: &Path) -> Option<String> {
    fs::read(dir.join(STORE))
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn text_arg(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn object_arg(args: &[Value], index: usize) -> Map<String, Value> {
    args.get(index)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn value_arg(args: &[Value], index: usize) -> Value {
    args.get(index).cloned().unwrap_or(Value::Null)
}

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[test]
fn a_saved_credential_reads_back_and_survives_a_restart() {
    let dir = tempfile::tempdir().expect("temp dir");
    let vault = FakeVault::working();
    let mut first = open_store(dir.path(), &vault);
    assert!(first.set("github", &object(json!({"GITHUB_TOKEN": SECRET}))));
    assert_eq!(first.get("github"), json!({"GITHUB_TOKEN": SECRET}));

    let mut second = open_store(dir.path(), &vault);
    assert_eq!(second.get("github")["GITHUB_TOKEN"], SECRET);
}

#[test]
fn the_store_file_holds_no_plain_text_and_is_owner_only() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::working());
    store.set("github", &object(json!({"GITHUB_TOKEN": SECRET})));

    let bytes = fs::read(dir.path().join(STORE)).expect("store file");
    assert!(!String::from_utf8_lossy(&bytes).contains(SECRET));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.path().join(STORE))
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn an_unavailable_keystore_writes_nothing_but_keeps_the_value_for_the_run() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::unavailable());
    assert!(!store.available());
    assert!(!store.set("github", &object(json!({"GITHUB_TOKEN": SECRET}))));
    assert!(!dir.path().join(STORE).exists());
    assert_eq!(store.get("github")["GITHUB_TOKEN"], SECRET);
}

#[test]
fn the_basic_text_backend_counts_as_no_keystore() {
    let dir = tempfile::tempdir().expect("temp dir");
    assert!(!open_store(dir.path(), &FakeVault::with_backend("basic_text")).available());
    assert!(open_store(dir.path(), &FakeVault::with_backend("gnome_libsecret")).available());
}

#[test]
fn a_store_it_cannot_read_starts_empty_and_is_replaced_by_the_next_save() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join(STORE), "not encrypted by us").expect("write");
    let mut store = open_store(dir.path(), &FakeVault::working());
    assert!(store.owners().is_empty());
    assert!(store.set("github", &object(json!({"GITHUB_TOKEN": SECRET}))));
    assert_eq!(store.get("github")["GITHUB_TOKEN"], SECRET);
}

#[test]
fn an_unreadable_store_is_kept_beside_the_new_one_and_a_save_leaves_no_temp_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join(STORE), "not encrypted by us").expect("write");
    let mut store = open_store(dir.path(), &FakeVault::working());
    assert!(store.owners().is_empty());
    assert!(store.set("github", &object(json!({"GITHUB_TOKEN": SECRET}))));

    let names: Vec<String> = fs::read_dir(dir.path())
        .expect("dir")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    let kept = names
        .iter()
        .find(|name| name.starts_with("secrets.bin.unreadable-"))
        .expect("the unreadable file is kept");
    assert_eq!(
        fs::read(dir.path().join(kept)).expect("kept file"),
        b"not encrypted by us"
    );
    assert!(
        !names.iter().any(|name| name.ends_with(".tmp")),
        "{names:?}"
    );
}

#[test]
fn adopt_moves_the_credential_fields_and_returns_the_rest() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::working());
    let records = object(json!({
        "github": {
            "enabled": true,
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": SECRET, "GITHUB_HOST": "github.com"},
            "arguments": {"roots": ["C:\\projects"]}
        },
        "filesystem": {"enabled": true, "env": {}, "arguments": {"roots": ["C:\\projects"]}}
    }));

    let adopted = store.adopt(&records, |field: &str, _owner: &str| {
        field.contains("TOKEN")
    });

    assert_eq!(adopted.moved, 1);
    assert_eq!(
        adopted.records["github"]["env"],
        json!({"GITHUB_HOST": "github.com"})
    );
    assert_eq!(
        adopted.records["github"]["arguments"],
        json!({"roots": ["C:\\projects"]})
    );
    assert_eq!(adopted.records["filesystem"], records["filesystem"]);
    assert_eq!(
        store.get("github"),
        json!({"GITHUB_PERSONAL_ACCESS_TOKEN": SECRET})
    );
}

#[test]
fn adopt_leaves_the_records_alone_without_a_keystore() {
    let dir = tempfile::tempdir().expect("temp dir");
    let records = object(json!({"github": {"env": {"GITHUB_TOKEN": SECRET}}}));
    let adopted = open_store(dir.path(), &FakeVault::unavailable()).adopt(&records, |_, _| true);
    assert_eq!(adopted.moved, 0);
    assert_eq!(adopted.records, records);
}

#[test]
fn adopted_records_come_back_in_javascript_key_order() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::working());
    let records: Map<String, Value> = serde_json::from_str(
        r#"{"b":{"enabled":true,"env":{"B":"1","10":"2","2":"3"}},"2":{"enabled":false},"10":{"env":{"Z":"x","A":"y"}}}"#,
    )
    .expect("records");

    let adopted = store.adopt(&records, |_, _| false);

    // The bytes JSON.stringify gives for the reference's adopt on the same records (electron/secrets.cjs).
    assert_eq!(
        serde_json::to_string(&adopted.records).expect("json"),
        r#"{"2":{"enabled":false},"10":{"env":{"Z":"x","A":"y"}},"b":{"enabled":true,"env":{"2":"3","10":"2","B":"1"}}}"#
    );
}

/// A writer that keeps every line in memory, so a test can read what the store logged.
#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut held) = self.0.lock() {
            held.extend_from_slice(buf);
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'writer> tracing_subscriber::fmt::MakeWriter<'writer> for Captured {
    type Writer = Captured;

    fn make_writer(&'writer self) -> Self::Writer {
        self.clone()
    }
}

#[test]
fn no_logged_line_carries_a_credential_or_its_hash() {
    let captured = Captured::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(captured.clone())
        .finish();

    // A store that decrypts to JSON cut short mid-value: the parser's own message must not echo the value.
    let torn = format!(r#"{{"svc":{{"K":"{SECRET}""#);
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join(STORE), STANDARD.encode(torn)).expect("write");

    tracing::subscriber::with_default(subscriber, || {
        let mut store = open_store(dir.path(), &FakeVault::working());
        assert!(store.owners().is_empty());
        store.set("github", &object(json!({"GITHUB_TOKEN": SECRET})));
        store.adopt(
            &object(json!({"svc": {"env": {"API_TOKEN": SECRET}}})),
            |field: &str, _| field.contains("TOKEN"),
        );
        store.remove("svc");
    });

    let logged = String::from_utf8_lossy(&captured.0.lock().expect("log buffer")).into_owned();
    let digest = format!("{:x}", Sha256::digest(SECRET.as_bytes()));
    assert!(
        logged.contains("could not read the store"),
        "expected a log line, got: {logged}"
    );
    assert!(
        !logged.contains(SECRET),
        "a credential reached the logs: {logged}"
    );
    assert!(
        !logged.contains(&digest[..8]),
        "a hash of a credential reached the logs: {logged}"
    );
}

/// The stored credentials the hook sees, in the order they were handed over.
type Seen = Arc<Mutex<Vec<String>>>;

fn watched_store(dir: &Path, vault: &FakeVault) -> (SecretStore<FakeVault>, Seen) {
    let seen: Seen = Arc::default();
    let sink = Arc::clone(&seen);
    let store = SecretStore::new(dir, vault.clone()).with_registrar(move |secret: &str| {
        if let Ok(mut held) = sink.lock() {
            held.push(secret.to_string());
        }
    });
    (store, seen)
}

fn seen_values(seen: &Seen) -> Vec<String> {
    seen.lock().map(|held| held.clone()).unwrap_or_default()
}

#[test]
fn a_credential_reaches_the_log_scrubber_when_kept_and_when_read_back() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut store, seen) = watched_store(dir.path(), &FakeVault::working());
    store.set(
        "github",
        &object(json!({"GITHUB_TOKEN": SECRET, "PORT": "8080"})),
    );
    assert_eq!(seen_values(&seen), vec![SECRET.to_string()]);

    let (mut reread, seen_again) = watched_store(dir.path(), &FakeVault::working());
    assert_eq!(reread.get("github")["GITHUB_TOKEN"], SECRET);
    assert_eq!(seen_values(&seen_again), vec![SECRET.to_string()]);
}

#[test]
fn a_value_shorter_than_the_scrubber_minimum_is_not_registered() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut store, seen) = watched_store(dir.path(), &FakeVault::working());
    store.set("svc", &object(json!({"PORT": "8080"})));
    assert!(seen_values(&seen).is_empty());
}

#[test]
fn credentials_in_a_store_that_is_an_array_reach_the_scrubber_on_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(
        dir.path().join(STORE),
        STANDARD.encode(format!(r#"[{{"GITHUB_TOKEN":"{SECRET}"}}]"#)),
    )
    .expect("write");
    let (mut store, seen) = watched_store(dir.path(), &FakeVault::working());
    assert_eq!(store.owners(), vec!["0".to_string()]);
    assert_eq!(seen_values(&seen), vec![SECRET.to_string()]);
}

#[test]
fn an_unreadable_store_and_a_removal_register_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(dir.path().join(STORE), "not encrypted by us").expect("write");
    let (mut store, seen) = watched_store(dir.path(), &FakeVault::working());
    assert!(store.owners().is_empty());
    store.remove("github");
    assert!(seen_values(&seen).is_empty());
}

#[test]
fn a_v10_blob_from_the_basic_text_password_decodes() {
    // The blob is the fixture's own: decoding it here checks the decoder against the Node-made vector.
    let case = cases("secrets", "safe-storage-v10.json")
        .into_iter()
        .find(|case| case["name"] == "decrypts a basic_text blob")
        .expect("case");
    let blob = STANDARD
        .decode(case["input"]["blob"].as_str().unwrap_or_default())
        .expect("base64");
    let plain =
        decrypt_safe_storage_v10(&blob, b"peanuts", SafeStorageScheme::Linux).expect("decodes");
    assert_eq!(plain, b"fixture-secret-v10-0001");
    assert!(decrypt_safe_storage_v10(&blob, b"not-peanuts", SafeStorageScheme::Linux).is_err());
}

#[test]
fn a_v10_blob_from_the_macos_scheme_decodes_on_every_os() {
    // Chromium on macOS runs 1003 PBKDF2 rounds; the same blob under the Linux single round must not decode.
    let case = cases("secrets", "safe-storage-v10-macos.json")
        .into_iter()
        .find(|case| case["name"] == "decrypts a macOS blob with 1003 rounds")
        .expect("case");
    let blob = STANDARD
        .decode(case["input"]["blob"].as_str().unwrap_or_default())
        .expect("base64");
    let password = case["input"]["password"]
        .as_str()
        .unwrap_or_default()
        .as_bytes();
    let plain =
        decrypt_safe_storage_v10(&blob, password, SafeStorageScheme::MacOs).expect("decodes");
    assert_eq!(plain, b"fixture-keychain-secret-0001");
    assert!(decrypt_safe_storage_v10(&blob, password, SafeStorageScheme::Linux).is_err());
}

/// The depth of nested arrays from the top down, following each first item.
fn array_depth(value: &Value) -> usize {
    let mut depth = 0;
    let mut current = value;
    while let Some(items) = current.as_array() {
        depth += 1;
        match items.first() {
            Some(first) => current = first,
            None => break,
        }
    }
    depth
}

#[test]
fn a_store_nested_well_past_the_serde_default_reads_and_saves_back() {
    // The reference's JSON.parse takes any depth. Parsing goes through js::parse_any, so this depth reads too.
    let depth = 1000;
    let nested = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    let dir = tempfile::tempdir().expect("temp dir");
    let body = format!(r#"{{"github":{{"NOTE":{nested}}}}}"#);
    fs::write(dir.path().join(STORE), STANDARD.encode(body)).expect("write");

    let mut store = open_store(dir.path(), &FakeVault::working());
    assert_eq!(array_depth(&store.get("github")["NOTE"]), depth);
    assert!(store.set("svc", &object(json!({"GITHUB_TOKEN": SECRET}))));
    store.close();
    assert_eq!(array_depth(&store.get("github")["NOTE"]), depth);
}

#[test]
fn the_fake_vault_reads_base64_the_way_node_does() {
    // Each expectation is what Node's Buffer.from(text, "base64") gives for the same text.
    let cases: [(&str, &[u8]); 6] = [
        ("YWJj ZA==", b"abcd"),
        ("YW!Jj", b"abc"),
        ("YW-_8=", &[0x61, 0x6f, 0xbf]),
        ("YQ==YQ==", b"a"),
        ("YWJjY", b"abc"),
        ("Y", b""),
    ];
    for (text, expected) in cases {
        assert_eq!(
            decode_container(text.as_bytes()).expect("decodes"),
            expected,
            "{text}"
        );
    }
}

#[test]
fn the_scrubber_minimum_counts_utf16_units_not_bytes_or_characters() {
    // electron/logScrub.cjs registers a value when `.length >= 6`, and JavaScript's length counts UTF-16 units.
    // Five e-acute are 10 bytes, and two emoji are 4 units but 2 characters: each boundary is pinned on its own side.
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut store, seen) = watched_store(dir.path(), &FakeVault::working());
    store.set(
        "svc",
        &object(json!({
            "FIVE": "\u{e9}".repeat(5),
            "SIX": "\u{e9}".repeat(6),
            "TWO_EMOJI": "\u{1F600}".repeat(2),
            "THREE_EMOJI": "\u{1F600}".repeat(3),
        })),
    );
    assert_eq!(
        seen_values(&seen),
        vec!["\u{e9}".repeat(6), "\u{1F600}".repeat(3)]
    );
}

#[test]
fn a_negative_zero_is_written_as_zero() {
    // The reference's String(-0) is "0". JSON cannot hold -0, so the fixtures cannot pin this and the Rust test does.
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::working());
    store.set("svc", &object(json!({"VALUE": -0.0})));
    assert_eq!(store.get("svc"), json!({"VALUE": "0"}));
}

#[test]
fn a_name_the_prototype_holds_reads_as_empty_when_it_is_a_function() {
    // TS quirk: the reference reads `constructor` as the Object function, which JSON cannot show. It reads empty here.
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = open_store(dir.path(), &FakeVault::working());
    assert_eq!(store.get("constructor"), json!({}));
    assert_eq!(store.get("toString"), json!({}));
}
