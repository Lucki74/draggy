//! Keys for the search providers, kept in the keystore. Port of electron/searchKey.cjs. The renderer only
//! writes a key and reads back whether one is set (Brave also gets the last four characters).

use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use draggy_diagnostics::Diagnostics;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::AppState;
use crate::secrets::Keystore;

/// The field each owner keeps its key under, as Electron does.
const FIELD: &str = "apiKey";

/// One key: the owner it is stored under, and the value kept for this run when no keystore holds it.
pub struct Slot {
    owner: &'static str,
    this_run: Mutex<String>,
}

pub static BRAVE: Slot = Slot::new("search:brave");
pub static OPENALEX: Slot = Slot::new("search:openalex");
pub static GITHUB: Slot = Slot::new("search:github");

/// Opened on first use. `None` when the keystore cannot start, so keys last for this run only.
static STORE: OnceLock<Option<Mutex<Keystore>>> = OnceLock::new();

impl Slot {
    const fn new(owner: &'static str) -> Self {
        Self {
            owner,
            this_run: Mutex::new(String::new()),
        }
    }

    /// The stored key, else the one kept for this run. Empty when neither is set.
    pub fn key(&self, app: &AppHandle) -> String {
        match with_store(app, |store| store.get(self.owner, FIELD)).flatten() {
            Some(key) if !key.is_empty() => key,
            _ => self
                .this_run
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
        }
    }

    /// Write-only. An empty value removes the key. `kept` says whether it survives a restart.
    pub fn set(&self, app: &AppHandle, value: &str) -> Value {
        let key = value.trim().to_owned();
        let saved =
            with_store(app, |store| store.set(self.owner, FIELD, &key).is_ok()).unwrap_or(false);
        let mut this_run = self.this_run.lock().unwrap_or_else(PoisonError::into_inner);
        let diag = diag(app);
        if saved {
            this_run.clear();
            diag.info(
                "settings.secrets",
                if key.is_empty() {
                    "search key removed"
                } else {
                    "search key saved"
                },
                Some(json!({ "owner": self.owner, "keystore": true })),
            );
            json!({ "success": true, "kept": true })
        } else {
            *this_run = key;
            diag.warn(
                "settings.secrets",
                "search key kept for this run only",
                Some(json!({ "owner": self.owner, "keystore": with_store(app, |_| ()).is_some() })),
            );
            json!({ "success": true, "kept": false })
        }
    }

    /// Whether a key is set and whether a keystore is open. `with_hint` adds the last four characters (Brave).
    pub fn status(&self, app: &AppHandle, with_hint: bool) -> Value {
        let key = self.key(app);
        let mut out = json!({
            "hasKey": !key.is_empty(),
            "keystore": with_store(app, |_| ()).is_some(),
        });
        if with_hint {
            out["keyHint"] = json!(hint(&key));
        }
        out
    }
}

fn hint(key: &str) -> String {
    let tail: Vec<char> = key.chars().rev().take(4).collect();
    tail.into_iter().rev().collect()
}

fn diag(app: &AppHandle) -> Arc<Diagnostics> {
    Arc::clone(&app.state::<AppState>().diag)
}

/// Runs `use_store` on the open keystore. `None` when it is not open.
pub(crate) fn with_store<T>(
    app: &AppHandle,
    use_store: impl FnOnce(&mut Keystore) -> T,
) -> Option<T> {
    let store = STORE.get_or_init(|| open(app)).as_ref()?;
    let mut guard = store.lock().unwrap_or_else(PoisonError::into_inner);
    Some(use_store(&mut guard))
}

fn open(app: &AppHandle) -> Option<Mutex<Keystore>> {
    let diag = diag(app);
    let Ok(dir) = crate::paths::data_dir(std::env::var_os("APPDATA")) else {
        diag.warn("settings.secrets", "keystore unavailable", None);
        return None;
    };
    let sink = Arc::clone(&diag);
    match Keystore::open(&dir, move |value: &str| sink.register_secret(value)) {
        Ok(store) => Some(Mutex::new(store)),
        Err(error) => {
            diag.warn(
                "settings.secrets",
                "keystore unavailable",
                Some(json!({ "error": error.to_string() })),
            );
            None
        }
    }
}

/// The key kept under an owner with no slot of its own, such as a provider's. Empty when none is kept.
pub fn stored(app: &AppHandle, owner: &str) -> String {
    with_store(app, |store| store.get(owner, FIELD))
        .flatten()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::hint;

    #[test]
    fn hint_is_the_last_four_characters() {
        assert_eq!(hint("abcdefgh"), "efgh");
        assert_eq!(hint("abc"), "abc");
        assert_eq!(hint(""), "");
    }
}
