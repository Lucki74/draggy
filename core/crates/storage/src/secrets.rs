//! The credential store behind `secrets.bin`: credentials encrypted by the OS keystore, never plain text on disk.
//! Port of electron/secrets.cjs. The shells supply the keystore through `SecretVault`, and the migration reads
//! the `v10` blobs Electron's safeStorage wrote.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use aes::Aes128;
use cbc::Decryptor;
use cbc::cipher::block_padding::Pkcs7;
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use serde_json::{Map, Value};
use sha1::Sha1;

use crate::js::{is_truthy, js_text, key_order, parse_any};

const STORE_FILE: &str = "secrets.bin";
const BASIC_TEXT: &str = "basic_text";
/// The owner name that JavaScript's `__proto__` setter swallows when no own key of that name exists.
const PROTO: &str = "__proto__";
/// The shortest value the log scrubber redacts. `registerSecret` in electron/logScrub.cjs ignores shorter ones.
const MIN_KNOWN_SECRET: usize = 6;
/// The largest array index JavaScript allows, below 2^32 - 1.
const MAX_INDEX: usize = (u32::MAX - 1) as usize;

/// Keys that `in` finds on every plain object. The reference's `field in secrets` is true for them too.
// TS quirk: an env field named like one of these is dropped from the cleaned env whenever a secret moves.
const PROTOTYPE_KEYS: [&str; 12] = [
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
];

/// The OS keystore that encrypts the store file. The shells implement it: Keychain on macOS, Secret Service on Linux.
pub trait SecretVault {
    /// Whether the keystore can encrypt now. A failed check reads as unavailable.
    fn available(&self) -> bool;

    /// The keystore's backend name, or `None` where the platform has no such call. A failed call reads as `None`.
    fn backend(&self) -> Option<String>;

    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, VaultError>;

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, VaultError>;
}

/// A keystore call that failed. The message stays out of the logs, so it may say only what failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the keystore failed: {0}")]
pub struct VaultError(pub String);

/// A `v10` blob that could not be decoded. `code` is the stable name the fixtures pin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SecretsError {
    #[error("the blob has no v10 prefix")]
    NotV10,
    #[error("the blob is not a whole number of AES blocks")]
    BadLength,
    #[error("the blob has wrong padding")]
    BadPadding,
}

impl SecretsError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotV10 => "not_v10",
            Self::BadLength => "bad_length",
            Self::BadPadding => "bad_padding",
        }
    }
}

/// Which platform wrote a `v10` blob. The two schemes differ only in their PBKDF2 round count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeStorageScheme {
    /// Chromium on Linux derives the key in a single round.
    Linux,
    /// Chromium on macOS derives the key in 1003 rounds.
    MacOs,
}

impl SafeStorageScheme {
    fn rounds(self) -> u32 {
        match self {
            Self::Linux => 1,
            Self::MacOs => 1003,
        }
    }
}

/// What `adopt` returns: how many credentials moved, and the records with those fields taken out.
#[derive(Debug, Clone, PartialEq)]
pub struct Adopted {
    pub moved: usize,
    pub records: Map<String, Value>,
}

/// Receives each credential the log scrubber must redact, so that no stored value reaches a log line.
type KnownSecret = Box<dyn Fn(&str) + Send + Sync>;

/// The store as the reference holds it: an object, or the array the file was written as.
#[derive(Default)]
struct Cache {
    owners: Map<String, Value>,
    /// The length of a store that was an array, which a set past the end grows and a remove never shortens.
    array_len: Option<usize>,
    /// The object a `__proto__` assignment left as the prototype. JSON never persists it.
    proto: Option<Map<String, Value>>,
}

/// The credential store. The file is read on first use and cached until `close`, as the reference does.
pub struct SecretStore<V> {
    path: PathBuf,
    vault: V,
    cache: Option<Cache>,
    known: Option<KnownSecret>,
}

impl<V: SecretVault> SecretStore<V> {
    /// A store over `secrets.bin` in `user_data`. Nothing is read until the first call.
    pub fn new(user_data: &Path, vault: V) -> Self {
        Self {
            path: user_data.join(STORE_FILE),
            vault,
            cache: None,
            known: None,
        }
    }

    /// Hands every stored credential to `register` as it is read or kept, so the log scrubber can redact it.
    pub fn with_registrar(mut self, register: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.known = Some(Box::new(register));
        self
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Whether credentials may be kept: the keystore can encrypt, and it is not Linux's plain-text `basic_text` backend.
    pub fn available(&self) -> bool {
        self.vault.available() && self.vault.backend().as_deref() != Some(BASIC_TEXT)
    }

    /// Everything held for one owner, as the reference reads it: the stored value, or an empty object when none is held.
    pub fn get(&mut self, owner: &str) -> Value {
        let cache = self.cache_mut();
        match cache.owners.get(owner) {
            Some(Value::Null) => empty_object(),
            Some(value) => value.clone(),
            None => cache.unowned(owner),
        }
    }

    /// Replaces an owner's values. Null and empty values are dropped, and an owner left with none is forgotten.
    /// Returns whether the file was written. Without a keystore the values still last for this run, in memory.
    pub fn set(&mut self, owner: &str, values: &Map<String, Value>) -> bool {
        let kept = kept_fields(values);
        if kept.is_empty() {
            self.cache_mut().owners.shift_remove(owner);
        } else {
            self.register_strings(kept.values());
            self.cache_mut().put_owner(owner, kept);
        }
        self.write()
    }

    pub fn remove(&mut self, owner: &str) -> bool {
        self.cache_mut().owners.shift_remove(owner);
        self.write()
    }

    pub fn owners(&mut self) -> Vec<String> {
        key_order(&self.cache_mut().owners)
            .into_iter()
            .map(|(owner, _)| owner.clone())
            .collect()
    }

    /// The env a server starts with: its configured env, with its stored secrets laid over it.
    pub fn with_secrets(&mut self, owner: &str, env: &Value) -> Map<String, Value> {
        let mut merged: Map<String, Value> = js_entries(env).into_iter().collect();
        merged.extend(js_entries(&self.get(owner)));
        merged
    }

    /// Moves the credential fields out of old records into the store. `is_secret` decides per field, and the
    /// records come back with those fields removed. Without a keystore nothing moves and the records come back as given.
    pub fn adopt(
        &mut self,
        records: &Map<String, Value>,
        is_secret: impl Fn(&str, &str) -> bool,
    ) -> Adopted {
        if !self.available() {
            return Adopted {
                moved: 0,
                records: records.clone(),
            };
        }

        let mut moved = 0;
        let mut cleaned = Map::new();
        for (owner, record) in key_order(records) {
            let mut rest: Map<String, Value> = js_entries(record).into_iter().collect();
            let env = match record.as_object().and_then(|fields| fields.get("env")) {
                Some(env) if is_truthy(env) => js_entries(env),
                _ => Vec::new(),
            };

            let mut secrets = Map::new();
            for (field, value) in &env {
                if !is_secret(field, owner) || is_blank(value) {
                    continue;
                }
                moved += 1;
                // TS quirk: assigning `__proto__` on a plain object is ignored, so the field counts but is never kept.
                if field != PROTO {
                    secrets.insert(field.clone(), Value::String(js_text(value)));
                }
            }

            if !secrets.is_empty() {
                let mut merged: Map<String, Value> =
                    js_entries(&self.get(owner)).into_iter().collect();
                merged.extend(secrets.clone());
                // When the store cannot take them, the values stay in the record: the only other copy is in memory.
                let stored = self.set(owner, &merged);

                let kept_env: Map<String, Value> = env
                    .into_iter()
                    .filter(|(field, _)| !stored || !js_has_key(&secrets, field))
                    .collect();
                rest.insert("env".to_string(), Value::Object(kept_env));
            }

            // TS quirk: `cleaned[owner] = rest` with an owner named `__proto__` sets the prototype, so that record is absent.
            if owner != PROTO {
                cleaned.insert(owner.clone(), Value::Object(rest));
            }
        }

        if moved > 0 {
            tracing::info!(target: "storage.secrets", moved, "moved credentials into the store");
        }
        Adopted {
            moved,
            records: js_order_map(&cleaned),
        }
    }

    /// Drops the cache, so the next call reads the file again.
    pub fn close(&mut self) {
        self.cache = None;
    }

    /// The cache, read from the file on first use.
    fn cache_mut(&mut self) -> &mut Cache {
        if self.cache.is_none() {
            let loaded = self.load();
            self.cache = Some(loaded);
        }
        self.cache.get_or_insert_with(Cache::default)
    }

    /// The stored map, or an empty one when there is no file, no keystore, or nothing readable in the file.
    fn load(&self) -> Cache {
        if !self.path.exists() || !self.available() {
            return Cache::default();
        }
        let blob = match fs::read(&self.path) {
            Ok(blob) => blob,
            Err(_) => {
                tracing::warn!(target: "storage.secrets", stage = "read", "could not read the store");
                return Cache::default();
            }
        };
        let plain = match self.vault.decrypt(&blob) {
            Ok(plain) => plain,
            Err(_) => {
                tracing::warn!(target: "storage.secrets", stage = "decrypt", "could not read the store");
                self.set_aside();
                return Cache::default();
            }
        };
        // A store written by another machine or install is lost, not fatal: its credentials are entered again.
        // Electron's keystore hands back text, so bytes that are not UTF-8 read as replacement characters.
        let text = String::from_utf8_lossy(&plain);
        match parse_any::<Value>(&text) {
            Ok(parsed @ (Value::Object(_) | Value::Array(_))) => {
                for owner_values in js_values(&parsed) {
                    self.register_strings(js_values(owner_values));
                }
                Cache::from_value(parsed)
            }
            Ok(_) => Cache::default(),
            Err(_) => {
                tracing::warn!(target: "storage.secrets", stage = "parse", "could not read the store");
                self.set_aside();
                Cache::default()
            }
        }
    }

    /// Moves a file that could not be read out of the way, so the next save does not overwrite credentials a later
    /// run (or a repaired keystore) might still open.
    fn set_aside(&self) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis());
        let mut name = self.path.as_os_str().to_owned();
        name.push(format!(".unreadable-{stamp}"));
        if fs::rename(&self.path, PathBuf::from(name)).is_err() {
            tracing::warn!(target: "storage.secrets", stage = "set-aside", "could not keep the unreadable store");
        }
    }

    /// Writes the cache, encrypted, with owner and field order as JavaScript keeps them. False when nothing is written.
    fn write(&self) -> bool {
        if !self.available() {
            return false;
        }
        let Some(cache) = self.cache.as_ref() else {
            return false;
        };
        let plain = match serde_json::to_vec(&cache.to_value()) {
            Ok(plain) => plain,
            Err(_) => {
                tracing::error!(target: "storage.secrets", stage = "serialize", "could not write the store");
                return false;
            }
        };
        let sealed = match self.vault.encrypt(&plain) {
            Ok(sealed) => sealed,
            Err(_) => {
                tracing::error!(target: "storage.secrets", stage = "encrypt", "could not write the store");
                return false;
            }
        };
        match write_private(&self.path, &sealed) {
            Ok(()) => true,
            Err(error) => {
                tracing::error!(target: "storage.secrets", stage = "write", error = %error, "could not write the store");
                false
            }
        }
    }

    /// Passes each string of at least the scrubber's length to the hook, as `registerSecret` does.
    fn register_strings<'a>(&self, values: impl IntoIterator<Item = &'a Value>) {
        let Some(known) = self.known.as_ref() else {
            return;
        };
        for value in values {
            let Value::String(secret) = value else {
                continue;
            };
            if secret.encode_utf16().count() >= MIN_KNOWN_SECRET {
                known(secret.as_str());
            }
        }
    }
}

impl Cache {
    fn from_value(value: Value) -> Self {
        match value {
            Value::Object(owners) => Self {
                owners,
                ..Self::default()
            },
            Value::Array(items) => {
                let len = items.len();
                Self {
                    owners: items
                        .into_iter()
                        .enumerate()
                        .map(|(index, item)| (index.to_string(), item))
                        .collect(),
                    array_len: Some(len),
                    proto: None,
                }
            }
            _ => Self::default(),
        }
    }

    /// The value the file holds. An array keeps its shape: a missing index is null, and named owners are not written.
    fn to_value(&self) -> Value {
        let Some(len) = self.array_len else {
            return js_order(&Value::Object(self.owners.clone()));
        };
        Value::Array(
            (0..len)
                .map(|index| {
                    self.owners
                        .get(&index.to_string())
                        .map_or(Value::Null, js_order)
                })
                .collect(),
        )
    }

    /// What a name that no owner holds reads as: the array's length, or the prototype a `__proto__` set left.
    // TS quirk: a name the prototype holds reads as its value, and `__proto__` reads the prototype itself.
    // TS quirk: `constructor` and other Object.prototype names read as functions, which JSON cannot hold, so they read empty.
    fn unowned(&self, owner: &str) -> Value {
        match (owner, self.array_len, &self.proto) {
            ("length", Some(len), _) => Value::from(len),
            (PROTO, _, Some(fields)) => Value::Object(fields.clone()),
            (name, _, Some(fields)) => fields.get(name).cloned().unwrap_or_else(empty_object),
            _ => empty_object(),
        }
    }

    fn put_owner(&mut self, owner: &str, fields: Map<String, Value>) {
        // TS quirk: assigning `__proto__` with no own key of that name swaps the prototype, which JSON never writes.
        if owner == PROTO && !self.owners.contains_key(owner) {
            self.proto = Some(fields);
            return;
        }
        // An array grows to take in an index past its end, and removing that index later does not shorten it.
        if let (Some(len), Some(index)) = (self.array_len, index_of(owner)) {
            self.array_len = Some(len.max(index + 1));
        }
        self.owners.insert(owner.to_string(), Value::Object(fields));
    }
}

/// Decodes an Electron safeStorage `v10` blob: AES-128-CBC, a 16-byte key from PBKDF2-HMAC-SHA1 over `password`,
/// salt `saltysalt`, and an IV of sixteen spaces. The scheme sets the rounds; the basic_text password is `peanuts`.
pub fn decrypt_safe_storage_v10(
    blob: &[u8],
    password: &[u8],
    scheme: SafeStorageScheme,
) -> Result<Vec<u8>, SecretsError> {
    const BLOCK: usize = 16;
    let body = blob.strip_prefix(b"v10").ok_or(SecretsError::NotV10)?;
    if body.is_empty() || !body.len().is_multiple_of(BLOCK) {
        return Err(SecretsError::BadLength);
    }

    let mut key = [0u8; BLOCK];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", scheme.rounds(), &mut key);
    let iv = [b' '; BLOCK];
    Decryptor::<Aes128>::new(&key.into(), &iv.into())
        .decrypt_padded_vec_mut::<Pkcs7>(body)
        .map_err(|_| SecretsError::BadPadding)
}

/// What `set` keeps of its values: null and the empty string are dropped and anything else is kept as text.
fn kept_fields(values: &Map<String, Value>) -> Map<String, Value> {
    let mut kept = Map::new();
    for (key, value) in values {
        if is_blank(value) {
            continue;
        }
        // TS quirk: assigning `__proto__` on a plain object is ignored, so that field is never kept.
        if key != PROTO {
            kept.insert(key.clone(), Value::String(js_text(value)));
        }
    }
    kept
}

/// A value the store does not keep: null, or the empty string.
fn is_blank(value: &Value) -> bool {
    matches!(value, Value::Null) || matches!(value, Value::String(text) if text.is_empty())
}

/// The empty object the reference falls back to when an owner holds nothing.
fn empty_object() -> Value {
    Value::Object(Map::new())
}

/// JavaScript `key in secrets` for a map built from plain keys: an own key, or a name inherited from Object.prototype.
fn js_has_key(secrets: &Map<String, Value>, key: &str) -> bool {
    secrets.contains_key(key) || PROTOTYPE_KEYS.contains(&key)
}

/// JavaScript `Object.entries` for a JSON value: an object's keys, an array's indices, and a text's code units.
fn js_entries(value: &Value) -> Vec<(String, Value)> {
    match value {
        Value::Object(fields) => key_order(fields)
            .into_iter()
            .map(|(key, item)| (key.clone(), item.clone()))
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item.clone()))
            .collect(),
        Value::String(text) => text
            .encode_utf16()
            .enumerate()
            .map(|(index, unit)| {
                (
                    index.to_string(),
                    Value::String(String::from_utf16_lossy(&[unit])),
                )
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// JavaScript `Object.values` for the parts of a store that hold credentials: an object's or an array's items.
fn js_values(value: &Value) -> Vec<&Value> {
    match value {
        Value::Object(fields) => fields.values().collect(),
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

/// A canonical array index, as JavaScript reads an own key when it sizes or lists an array.
fn index_of(key: &str) -> Option<usize> {
    key.parse::<usize>()
        .ok()
        .filter(|index| index.to_string() == key && *index <= MAX_INDEX)
}

/// The same value with every object's keys in JavaScript order, so the bytes match `JSON.stringify`.
fn js_order(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(js_order_map(map)),
        Value::Array(items) => Value::Array(items.iter().map(js_order).collect()),
        other => other.clone(),
    }
}

fn js_order_map(map: &Map<String, Value>) -> Map<String, Value> {
    key_order(map)
        .into_iter()
        .map(|(key, item)| (key.clone(), js_order(item)))
        .collect()
}

/// Writes the file with owner-only permissions. The bytes go to a sibling file that is flushed and then renamed over
/// the target, so a crash or a full disk leaves the old store intact instead of a half-written one.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    let temp = PathBuf::from(name);
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = (|| {
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = written.and_then(|()| fs::rename(&temp, path)) {
        drop(fs::remove_file(&temp));
        return Err(error);
    }
    Ok(())
}
