//! Handlers for the pricing channels. The table and rates live in the app data folder. The network is touched only
//! by the refresher: on the schedule when the setting is on, or when the user asks for an update.

use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use draggy_web::http::ReqwestClient;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::pricing::refresh::Refresher;
use crate::pricing::table::{PriceTable, bundled_path};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "pricing:table" => pricing_table);
    register!(registry, "pricing:configure" => pricing_configure);
    register!(registry, "pricing:refresh" => pricing_refresh);
    register!(registry, "pricing:status" => pricing_status);
    register!(registry, "pricing:rates" => pricing_rates);
}

struct Pricing {
    table: Arc<PriceTable>,
    refresher: Arc<Refresher<ReqwestClient>>,
}

static PRICING: OnceLock<Pricing> = OnceLock::new();

/// The table and refresher, made on first use. Their status pushes go to the window as `pricing-updated`.
fn pricing(app: &AppHandle) -> Result<&'static Pricing, String> {
    if let Some(pricing) = PRICING.get() {
        return Ok(pricing);
    }
    let state = app.state::<AppState>();
    let client = ReqwestClient::new().map_err(|error| error.to_string())?;
    let user_data = state.storage.data_dir().to_path_buf();
    let resource_dir = app.path().resource_dir().ok();
    let table = Arc::new(PriceTable::new(
        Some(user_data.clone()),
        bundled_path(resource_dir.as_deref()),
        Some(Arc::clone(&state.diag)),
    ));
    let window = app.clone();
    let on_update: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(move |status: Value| {
        emit(&window, "pricing-updated", status);
    });
    let clock: Arc<dyn Fn() -> i64 + Send + Sync> = Arc::new(now_ms);
    let refresher = Arc::new(Refresher::new(
        client,
        user_data,
        Arc::clone(&table),
        Some(Arc::clone(&state.diag)),
        clock,
        Some(on_update),
    ));
    Ok(PRICING.get_or_init(|| Pricing { table, refresher }))
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// Zero, empty, null and false are off; anything else is on.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

fn failure(error: &str) -> Value {
    json!({ "success": false, "error": error })
}

async fn pricing_table(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let pricing = match pricing(&app) {
        Ok(pricing) => pricing,
        Err(error) => return Ok(failure(&error)),
    };
    Ok(match pricing.table.get() {
        Some(table) => {
            json!({ "success": true, "table": &*table, "origin": pricing.table.origin() })
        }
        None => json!({ "success": false }),
    })
}

/// The schedule is the only automatic request. The renderer turns it on from the setting.
async fn pricing_configure(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let pricing = match pricing(&app) {
        Ok(pricing) => pricing,
        Err(error) => return Ok(failure(&error)),
    };
    let automatic = truthy(args.first().and_then(|options| options.get("automatic")));
    Refresher::set_automatic(&pricing.refresher, automatic);
    Ok(json!({ "success": true }))
}

/// "Update now" is the user asking, so it ignores the schedule setting.
async fn pricing_refresh(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let pricing = match pricing(&app) {
        Ok(pricing) => pricing,
        Err(error) => return Ok(failure(&error)),
    };
    let outcome = pricing.refresher.refresh(true).await;
    Ok(json!({
        "success": true,
        "prices": outcome["prices"],
        "rates": outcome["rates"],
        "status": pricing.refresher.snapshot(),
    }))
}

async fn pricing_status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let pricing = match pricing(&app) {
        Ok(pricing) => pricing,
        Err(error) => return Ok(failure(&error)),
    };
    Ok(json!({ "success": true, "status": pricing.refresher.snapshot() }))
}

async fn pricing_rates(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let pricing = match pricing(&app) {
        Ok(pricing) => pricing,
        Err(error) => return Ok(failure(&error)),
    };
    Ok(json!({ "success": true, "rates": pricing.refresher.rates().unwrap_or(Value::Null) }))
}
