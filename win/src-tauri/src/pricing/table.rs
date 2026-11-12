//! The table replies are priced from. A refreshed copy wins over the snapshot that ships with the app, but only when
//! it parses and holds enough prices to be believed. Port of electron/pricing/table.cjs.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use draggy_diagnostics::Diagnostics;
use serde_json::Value;

/// A table with fewer prices than this is a broken download, not a price list.
pub const MIN_PRICES: usize = 200;
pub const LIVE_FILE: &str = "prices.live.json";
const BUNDLED_FILE: &str = "prices.json";

/// The snapshot in the resource folder. A debug build with no copy there reads the checkout's copy.
pub fn bundled_path(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(dir) = resource_dir {
        let file = dir.join(BUNDLED_FILE);
        if file.is_file() || !cfg!(debug_assertions) {
            return file;
        }
    }
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../shared/pricing/prices.json"
    ))
}

/// A rate is absent, or a finite number of zero or more.
fn is_rate(value: Option<&Value>) -> bool {
    match value {
        None => true,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x.is_finite() && x >= 0.0),
        Some(_) => false,
    }
}

/// True for a table whose shape and numbers can be priced from.
pub fn is_usable(table: &Value) -> bool {
    let Some(providers) = table.get("providers").and_then(Value::as_object) else {
        return false;
    };
    let mut count = 0;
    for models in providers.values() {
        let Some(models) = models.as_object() else {
            return false;
        };
        for price in models.values() {
            let Some(price) = price.as_object() else {
                return false;
            };
            let number = |key: &str| price.get(key).and_then(Value::as_f64).is_some();
            if !number("inputPerM") || !number("outputPerM") {
                return false;
            }
            let rates = [
                "inputPerM",
                "outputPerM",
                "cacheReadPerM",
                "cacheWritePerM",
                "reasoningPerM",
            ];
            if !rates.iter().all(|key| is_rate(price.get(*key))) {
                return false;
            }
            count += 1;
        }
    }
    count >= MIN_PRICES
}

/// The table in `file`, when it reads, parses and is usable.
pub fn read_table(file: &Path) -> Option<Value> {
    let text = fs::read_to_string(file).ok()?;
    let table: Value = serde_json::from_str(&text).ok()?;
    is_usable(&table).then_some(table)
}

#[derive(Default)]
struct State {
    current: Option<Arc<Value>>,
    origin: &'static str,
}

/// The loader. The table is read once and again only after `reload()`, so pricing a turn never touches the disk.
pub struct PriceTable {
    user_data: Option<PathBuf>,
    bundled: PathBuf,
    log: Option<Arc<Diagnostics>>,
    state: Mutex<State>,
}

impl PriceTable {
    pub fn new(
        user_data: Option<PathBuf>,
        bundled: PathBuf,
        log: Option<Arc<Diagnostics>>,
    ) -> Self {
        Self {
            user_data,
            bundled,
            log,
            state: Mutex::new(State {
                current: None,
                origin: "none",
            }),
        }
    }

    /// The table in use, loading it first when nothing has been read yet.
    pub fn get(&self) -> Option<Arc<Value>> {
        let current = self.state().current.clone();
        current.or_else(|| self.reload())
    }

    /// Reads the refreshed copy, else the snapshot, and makes it the one in use.
    pub fn reload(&self) -> Option<Arc<Value>> {
        let live = self
            .user_data
            .as_deref()
            .and_then(|dir| read_table(&dir.join(LIVE_FILE)));
        let snapshot = if live.is_none() {
            read_table(&self.bundled)
        } else {
            None
        };
        let origin = match (&live, &snapshot) {
            (Some(_), _) => "live",
            (None, Some(_)) => "bundled",
            (None, None) => "none",
        };
        let current = live.or(snapshot).map(Arc::new);
        if let Some(log) = self.log.as_ref().filter(|_| current.is_none()) {
            log.warn(
                "pricing",
                "no usable price table; replies will show no cost",
                None,
            );
        }
        let mut state = self.state();
        state.current = current.clone();
        state.origin = origin;
        current
    }

    /// Where the table in use came from: "live", "bundled" or "none".
    pub fn origin(&self) -> &'static str {
        self.state().origin
    }

    /// The refreshed copy's path, or none when there is no data folder.
    pub fn live_file(&self) -> Option<PathBuf> {
        self.user_data.as_ref().map(|dir| dir.join(LIVE_FILE))
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn table_of(count: usize, extra: Value) -> Value {
        let mut models = serde_json::Map::new();
        for i in 0..count {
            let mut price = json!({ "inputPerM": 1, "outputPerM": 2 });
            if let (Value::Object(base), Value::Object(more)) = (&mut price, &extra) {
                base.extend(more.clone());
            }
            models.insert(format!("model-{i}"), price);
        }
        json!({ "version": 1, "generatedAt": "2026-10-01T00:00:00.000Z", "providers": { "openai": models } })
    }

    fn write(file: &Path, value: &Value) {
        fs::write(file, value.to_string()).expect("write");
    }

    #[test]
    fn accepts_a_table_with_enough_well_formed_prices() {
        assert!(is_usable(&table_of(MIN_PRICES, json!({}))));
    }

    #[test]
    fn rejects_a_table_too_small_to_be_a_price_list() {
        assert!(!is_usable(&table_of(MIN_PRICES - 1, json!({}))));
    }

    #[test]
    fn rejects_missing_or_malformed_shapes() {
        assert!(!is_usable(&Value::Null));
        assert!(!is_usable(&json!("prices")));
        assert!(!is_usable(&json!({})));
        assert!(!is_usable(&json!({ "providers": null })));
        assert!(!is_usable(&json!({ "providers": { "openai": null } })));
    }

    #[test]
    fn rejects_negative_missing_or_non_numeric_rates() {
        assert!(!is_usable(&table_of(
            MIN_PRICES,
            json!({ "inputPerM": -1 })
        )));
        assert!(!is_usable(&table_of(
            MIN_PRICES,
            json!({ "outputPerM": "2" })
        )));
        assert!(!is_usable(&table_of(
            MIN_PRICES,
            json!({ "cacheReadPerM": null })
        )));
        let mut missing = table_of(MIN_PRICES, json!({}));
        missing["providers"]["openai"]["model-0"]
            .as_object_mut()
            .expect("object")
            .remove("outputPerM");
        assert!(!is_usable(&missing));
    }

    #[test]
    fn accepts_the_snapshot_that_ships_with_the_app() {
        assert!(read_table(&bundled_path(None)).is_some());
    }

    #[test]
    fn the_snapshot_sits_beside_the_resources_when_present() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(
            &dir.path().join(BUNDLED_FILE),
            &table_of(MIN_PRICES, json!({})),
        );
        assert_eq!(
            bundled_path(Some(dir.path())),
            dir.path().join(BUNDLED_FILE)
        );
    }

    #[test]
    fn reads_the_bundled_snapshot_when_nothing_was_refreshed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join(BUNDLED_FILE);
        write(
            &bundled,
            &json!({ "generatedAt": "bundled", "providers": table_of(MIN_PRICES, json!({}))["providers"] }),
        );
        let loader = PriceTable::new(Some(dir.path().join("user")), bundled, None);
        assert_eq!(loader.get().expect("table")["generatedAt"], "bundled");
        assert_eq!(loader.origin(), "bundled");
    }

    #[test]
    fn prefers_a_refreshed_copy_over_the_snapshot() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join(BUNDLED_FILE);
        write(
            &bundled,
            &json!({ "generatedAt": "bundled", "providers": table_of(MIN_PRICES, json!({}))["providers"] }),
        );
        write(
            &dir.path().join(LIVE_FILE),
            &json!({ "generatedAt": "live", "providers": table_of(MIN_PRICES, json!({}))["providers"] }),
        );
        let loader = PriceTable::new(Some(dir.path().to_path_buf()), bundled, None);
        assert_eq!(loader.get().expect("table")["generatedAt"], "live");
        assert_eq!(loader.origin(), "live");
    }

    #[test]
    fn falls_back_to_the_snapshot_when_the_refreshed_copy_is_corrupt_or_small() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join(BUNDLED_FILE);
        write(&bundled, &table_of(MIN_PRICES, json!({})));
        fs::write(dir.path().join(LIVE_FILE), "{ not json").expect("write");
        let loader = PriceTable::new(Some(dir.path().to_path_buf()), bundled.clone(), None);
        assert_eq!(loader.origin(), "none");
        assert!(loader.get().is_some());
        assert_eq!(loader.origin(), "bundled");

        write(
            &dir.path().join(LIVE_FILE),
            &table_of(MIN_PRICES - 1, json!({})),
        );
        let loader = PriceTable::new(Some(dir.path().to_path_buf()), bundled, None);
        assert_eq!(loader.origin(), "none");
        loader.reload();
        assert_eq!(loader.origin(), "bundled");
    }

    #[test]
    fn returns_nothing_when_neither_copy_is_usable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let loader = PriceTable::new(None, dir.path().join(BUNDLED_FILE), None);
        assert!(loader.get().is_none());
        assert_eq!(loader.origin(), "none");
    }

    #[test]
    fn reads_the_disk_once_and_again_only_after_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join(BUNDLED_FILE);
        let providers = table_of(MIN_PRICES, json!({}))["providers"].clone();
        write(
            &bundled,
            &json!({ "generatedAt": "bundled", "providers": providers }),
        );
        let loader = PriceTable::new(Some(dir.path().to_path_buf()), bundled, None);
        assert_eq!(loader.get().expect("table")["generatedAt"], "bundled");

        write(
            &dir.path().join(LIVE_FILE),
            &json!({ "generatedAt": "live", "providers": providers }),
        );
        assert_eq!(loader.get().expect("table")["generatedAt"], "bundled");

        loader.reload();
        assert_eq!(loader.get().expect("table")["generatedAt"], "live");
    }

    #[test]
    fn names_the_refreshed_copy_file() {
        let loader = PriceTable::new(Some(PathBuf::from("data")), PathBuf::from("p.json"), None);
        assert_eq!(
            loader.live_file(),
            Some(PathBuf::from("data").join(LIVE_FILE))
        );
        assert_eq!(
            PriceTable::new(None, PathBuf::new(), None).live_file(),
            None
        );
    }
}
