//! Where the API key is kept: the desktop's Secret Service (GNOME Keyring, KWallet) and nowhere else. With no keyring
//! running the key is refused rather than written to a file.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

pub const NO_KEYRING_HELP: &str = "No keyring is running, so the key was not stored. Install and start GNOME Keyring or KWallet (the org.freedesktop.secrets service), then try again.";

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    /// There is no Secret Service to talk to, or it is locked and could not be unlocked.
    NoKeyring,
    /// The service answered with an error.
    Failed(String),
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoKeyring => f.write_str(NO_KEYRING_HELP),
            Self::Failed(message) => write!(f, "The keyring refused the request: {message}"),
        }
    }
}

impl std::error::Error for SecretError {}

/// Keeps one secret per name, such as the key of a model server.
pub trait SecretStore: Send + Sync {
    fn get<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<String>, SecretError>>;
    fn set<'a>(&'a self, name: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), SecretError>>;
    fn clear<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), SecretError>>;
}

/// A store that lives in memory, for tests.
#[derive(Default)]
pub struct MemoryStore {
    values: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn get<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<String>, SecretError>> {
        Box::pin(async move {
            let values = self.values.lock().unwrap_or_else(|e| e.into_inner());
            Ok(values.get(name).cloned())
        })
    }

    fn set<'a>(&'a self, name: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), SecretError>> {
        Box::pin(async move {
            let mut values = self.values.lock().unwrap_or_else(|e| e.into_inner());
            values.insert(name.to_owned(), value.to_owned());
            Ok(())
        })
    }

    fn clear<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), SecretError>> {
        Box::pin(async move {
            let mut values = self.values.lock().unwrap_or_else(|e| e.into_inner());
            values.remove(name);
            Ok(())
        })
    }
}

/// The Secret Service over D-Bus. The portal's file backend is not used on purpose: it would put the key on disk.
pub struct KeyringStore;

fn attributes(name: &str) -> HashMap<&str, &str> {
    HashMap::from([("application", "com.draggy.Draggy"), ("name", name)])
}

fn failed(error: impl std::fmt::Display) -> SecretError {
    SecretError::Failed(error.to_string())
}

impl KeyringStore {
    async fn collection() -> Result<oo7::dbus::Collection, SecretError> {
        let service = oo7::dbus::Service::new()
            .await
            .map_err(|_| SecretError::NoKeyring)?;
        let collection = service
            .default_collection()
            .await
            .map_err(|_| SecretError::NoKeyring)?;
        if collection.is_locked().await.map_err(failed)? {
            collection
                .unlock(None)
                .await
                .map_err(|_| SecretError::NoKeyring)?;
        }
        Ok(collection)
    }
}

impl SecretStore for KeyringStore {
    fn get<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<String>, SecretError>> {
        Box::pin(async move {
            let collection = Self::collection().await?;
            let items = collection
                .search_items(&attributes(name))
                .await
                .map_err(failed)?;
            let Some(item) = items.first() else {
                return Ok(None);
            };
            let secret = item.secret().await.map_err(failed)?;
            Ok(Some(String::from_utf8_lossy(&secret).into_owned()))
        })
    }

    fn set<'a>(&'a self, name: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), SecretError>> {
        Box::pin(async move {
            let collection = Self::collection().await?;
            collection
                .create_item(
                    &format!("Draggy: {name}"),
                    &attributes(name),
                    value.as_bytes(),
                    true,
                    None,
                )
                .await
                .map_err(failed)?;
            Ok(())
        })
    }

    fn clear<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), SecretError>> {
        Box::pin(async move {
            let collection = Self::collection().await?;
            for item in collection
                .search_items(&attributes(name))
                .await
                .map_err(failed)?
            {
                item.delete(None).await.map_err(failed)?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_memory_store_keeps_and_forgets() {
        let store = MemoryStore::default();
        assert_eq!(store.get("server").await, Ok(None));
        store.set("server", "k1").await.expect("set");
        assert_eq!(store.get("server").await, Ok(Some("k1".to_owned())));
        store.clear("server").await.expect("clear");
        assert_eq!(store.get("server").await, Ok(None));
    }

    #[test]
    fn the_missing_keyring_message_says_what_to_do() {
        let text = SecretError::NoKeyring.to_string();
        assert!(text.contains("GNOME Keyring"));
        assert!(text.contains("not stored"));
    }
}
