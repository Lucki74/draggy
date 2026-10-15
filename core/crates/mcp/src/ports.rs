//! What the client reads from its host besides the network and the processes: the secret vault, package provisioning
//! and the clock. Production backs these with the OS store, the install folder and the system time; tests pass fakes.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::provision::InstallCommand;

/// A future the trait methods can return without naming its type.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The encrypted store for per-server secrets. Each value is a JSON object, as the reference stores it.
pub trait Vault: Send + Sync {
    fn get(&self, key: &str) -> Option<Value>;
    fn set(&self, key: &str, value: Value);
    fn remove(&self, key: &str);
}

/// The time in milliseconds since the epoch, as `Date.now()` gives it. Passed in so expiries are deterministic in tests.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> f64;
}

/// Finds and installs the npm packages that stdio servers run. Only `install` starts a process.
pub trait Provisioner: Send + Sync {
    /// Whether the folder servers are installed into has been set. False is "Extensions are not ready yet.".
    fn ready(&self) -> bool;
    /// The npm command an install of `package` runs, or None when npm cannot be found.
    fn install_command(&self, package: &str) -> Option<InstallCommand>;
    /// The entry point of an installed package, when it is installed and says which file to run.
    fn entry_point(&self, package: &str) -> Option<String>;
    /// Runs an install to the end. The error is the text to show: the stderr tail, or why npm could not run.
    fn install(&self, command: &InstallCommand) -> BoxFuture<'_, Result<(), String>>;
}

/// The host's stores and clock, shared by every server a client runs.
#[derive(Clone)]
pub struct Ports {
    pub vault: Arc<dyn Vault>,
    pub provisioner: Arc<dyn Provisioner>,
    pub clock: Arc<dyn Clock>,
}

/// A vault held in memory. Nothing survives the process, so it suits tests and nothing else.
#[derive(Debug, Default)]
pub struct MemoryVault {
    entries: Mutex<HashMap<String, Value>>,
}

impl Vault for MemoryVault {
    fn get(&self, key: &str) -> Option<Value> {
        self.lock().get(key).cloned()
    }

    fn set(&self, key: &str, value: Value) {
        self.lock().insert(key.to_owned(), value);
    }

    fn remove(&self, key: &str) {
        self.lock().remove(key);
    }
}

impl MemoryVault {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Value>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The system clock. Before the epoch it reads as zero rather than failing.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
    }
}
