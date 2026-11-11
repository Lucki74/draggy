//! Provider keys and other secrets at rest on Windows.
//! Reads and writes Electron's `secrets.bin` in the same `v10` AES-GCM layout and key location, so an
//! Electron rollback still reads what this wrote.

mod dpapi;
mod local_state;
mod vault;

use std::fmt;
use std::path::Path;

use draggy_storage::secrets::SecretStore;
use serde_json::{Map, Value};

pub use vault::WindowsVault;

/// Why the keystore could not open or save. Names the owner or field at most, never a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeystoreError(String);

impl fmt::Display for KeystoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for KeystoreError {}

/// The Windows keystore. Credentials are grouped by owner (a server id, or `search:brave`) and each owner
/// holds named fields, as in Electron's store. Dropping it wipes the AES key it holds.
pub struct Keystore {
    store: SecretStore<WindowsVault>,
}

impl Keystore {
    /// Opens the store in `user_data`, creating the `Local State` key on first use. `register` receives every
    /// stored value so the log scrubber can drop it.
    pub fn open(
        user_data: &Path,
        register: impl Fn(&str) + Send + Sync + 'static,
    ) -> Result<Self, KeystoreError> {
        let key = local_state::load_or_create(user_data).map_err(KeystoreError)?;
        let store = SecretStore::new(user_data, WindowsVault::new(key)).with_registrar(register);
        Ok(Self { store })
    }

    pub fn available(&self) -> bool {
        self.store.available()
    }

    /// The value of `field` under `owner`, if one is stored.
    pub fn get(&mut self, owner: &str, field: &str) -> Option<String> {
        match self.store.get(owner) {
            Value::Object(fields) => fields.get(field)?.as_str().map(str::to_owned),
            _ => None,
        }
    }

    /// Stores `value` under `field`, keeping the owner's other fields. An empty value removes the field.
    pub fn set(&mut self, owner: &str, field: &str, value: &str) -> Result<(), KeystoreError> {
        let mut fields = match self.store.get(owner) {
            Value::Object(fields) => fields,
            _ => Map::new(),
        };
        fields.insert(field.to_owned(), Value::String(value.to_owned()));
        if self.store.set(owner, &fields) {
            Ok(())
        } else {
            Err(KeystoreError(format!("could not save {owner}.{field}")))
        }
    }

    /// Forgets every field of `owner`. Returns an error only when the file could not be rewritten.
    pub fn delete(&mut self, owner: &str) -> Result<(), KeystoreError> {
        if self.store.remove(owner) {
            Ok(())
        } else {
            Err(KeystoreError(format!("could not remove {owner}")))
        }
    }

    /// The owners that hold at least one stored field, in file order.
    pub fn list_names(&mut self) -> Vec<String> {
        self.store.owners()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Mutex};

    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    /// Made with Node's aes-256-gcm under the key 00..1f: `{"github":{"GITHUB_TOKEN":"ghp_test"}}`.
    const ELECTRON_SECRETS_BIN: &str = "7631300102030405060708090a0b0c7ec83dbc98fc85e46e981865575abe601701beaad826158b8365db43f6c629b1e197effd13c881570622b564422aa835a49c03ddee51";

    fn no_register() -> impl Fn(&str) + Send + Sync + 'static {
        |_: &str| {}
    }

    fn open(dir: &Path) -> Keystore {
        Keystore::open(dir, no_register()).expect("open")
    }

    #[test]
    fn reads_a_store_and_local_state_written_in_the_electron_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        // Local State wraps the 00..1f key with DPAPI, as Chromium writes it.
        let key: Vec<u8> = (0u8..32).collect();
        let mut wrapped = b"DPAPI".to_vec();
        wrapped.extend(dpapi::protect(&key).expect("protect"));
        let local = format!(
            r#"{{"os_crypt":{{"encrypted_key":"{}"}}}}"#,
            STANDARD.encode(wrapped)
        );
        fs::write(dir.path().join("Local State"), local).expect("local state");
        let bytes: Vec<u8> = (0..ELECTRON_SECRETS_BIN.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&ELECTRON_SECRETS_BIN[i..i + 2], 16).expect("hex"))
            .collect();
        fs::write(dir.path().join("secrets.bin"), bytes).expect("secrets.bin");

        let mut store = open(dir.path());

        assert_eq!(
            store.get("github", "GITHUB_TOKEN").as_deref(),
            Some("ghp_test")
        );
        assert_eq!(store.list_names(), vec!["github".to_string()]);
    }

    #[test]
    fn reads_back_what_it_was_given() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = open(dir.path());

        store
            .set("github", "GITHUB_TOKEN", "ghp_secret")
            .expect("set");

        assert_eq!(
            store.get("github", "GITHUB_TOKEN").as_deref(),
            Some("ghp_secret")
        );
    }

    #[test]
    fn does_not_leave_it_readable_on_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = open(dir.path());

        store
            .set("github", "GITHUB_TOKEN", "ghp_secret")
            .expect("set");

        let raw = fs::read(dir.path().join("secrets.bin")).expect("file");
        assert!(raw.starts_with(b"v10"));
        assert!(!String::from_utf8_lossy(&raw).contains("ghp_secret"));
    }

    #[test]
    fn survives_a_restart_and_keeps_other_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        {
            let mut store = open(dir.path());
            store
                .set("github", "GITHUB_TOKEN", "ghp_secret")
                .expect("set");
            store.set("github", "GITHUB_USER", "someone").expect("set");
        }

        let mut store = open(dir.path());
        assert_eq!(
            store.get("github", "GITHUB_TOKEN").as_deref(),
            Some("ghp_secret")
        );
        assert_eq!(
            store.get("github", "GITHUB_USER").as_deref(),
            Some("someone")
        );
    }

    #[test]
    fn drops_a_field_that_was_emptied_and_an_owner_left_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = open(dir.path());
        store
            .set("github", "GITHUB_TOKEN", "ghp_secret")
            .expect("set");

        store.set("github", "GITHUB_TOKEN", "").expect("clear");

        assert_eq!(store.get("github", "GITHUB_TOKEN"), None);
        assert!(store.list_names().is_empty());
    }

    #[test]
    fn forgets_a_deleted_owner() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = open(dir.path());
        store.set("github", "GITHUB_TOKEN", "x").expect("set");
        store.set("gitlab", "GITLAB_TOKEN", "y").expect("set");

        store.delete("github").expect("delete");

        assert_eq!(store.get("github", "GITHUB_TOKEN"), None);
        assert_eq!(store.get("gitlab", "GITLAB_TOKEN").as_deref(), Some("y"));
    }

    #[test]
    fn registers_each_stored_value_with_the_scrubber() {
        let dir = tempfile::tempdir().expect("tempdir");
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = Arc::clone(&seen);
        let mut store = Keystore::open(dir.path(), move |value: &str| {
            sink.lock().expect("lock").push(value.to_owned());
        })
        .expect("open");

        store
            .set("github", "GITHUB_TOKEN", "ghp_secret")
            .expect("set");

        assert!(seen.lock().expect("lock").iter().any(|v| v == "ghp_secret"));
    }
}
