//! The user's own input in the pane. Esc halts the agent for a while; any other press takes the pane over.
//! Input the agent sends goes through `AgentInput`, which marks the page so it is not read as the user's.
#![cfg_attr(not(windows), allow(dead_code))]

use std::future::Future;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::broadcast;

use super::cdp::{Cdp, CdpError};

/// The page binding the listener calls. Runtime.bindingCalled carries its name and payload.
pub const BINDING: &str = "draggyPaneInput";
/// How long the agent stays off after Esc.
pub const HALT: Duration = Duration::from_secs(30);
/// Listens for trusted key and pointer input. Re-armed before every step; a page reload drops it.
pub const WATCH: &str = "(() => { if (!window.__draggyWatch) { window.__draggyWatch = true; \
    const tell = (kind) => { if (window.__draggyAgentSending) return; try { window.draggyPaneInput(kind); } catch (_) {} }; \
    window.addEventListener('keydown', (e) => { if (e.isTrusted) tell(e.key === 'Escape' ? 'escape' : 'input'); }, true); \
    for (const type of ['mousedown', 'mouseup', 'wheel', 'contextmenu']) \
      window.addEventListener(type, (e) => { if (e.isTrusted) tell('input'); }, { capture: true, passive: true }); } \
    return true; })()";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    Escape,
    Takeover,
}

/// The input a binding call reports, or `None` for any other binding or payload.
pub fn classify(params: &Value) -> Option<Input> {
    if params.get("name").and_then(Value::as_str) != Some(BINDING) {
        return None;
    }
    match params.get("payload").and_then(Value::as_str)? {
        "escape" => Some(Input::Escape),
        "input" => Some(Input::Takeover),
        _ => None,
    }
}

const SENDING_ON: &str = "window.__draggyAgentSending = true";
const SENDING_OFF: &str = "window.__draggyAgentSending = false";

/// A page driver that marks the page while the agent sends input, so that input is not the user's.
pub struct AgentInput<C> {
    inner: C,
}

impl<C> AgentInput<C> {
    pub fn new(inner: C) -> Self {
        Self { inner }
    }
}

async fn mark<C: Cdp>(cdp: &C, on: bool) {
    let expression = if on { SENDING_ON } else { SENDING_OFF };
    let _ = cdp
        .call("Runtime.evaluate", json!({ "expression": expression }))
        .await;
}

impl<C: Cdp> Cdp for AgentInput<C> {
    fn call(
        &self,
        method: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, CdpError>> + Send {
        let method = method.to_owned();
        async move {
            if !method.starts_with("Input.") {
                return self.inner.call(&method, params).await;
            }
            mark(&self.inner, true).await;
            let out = self.inner.call(&method, params).await;
            mark(&self.inner, false).await;
            out
        }
    }

    fn subscribe(&self, event: &str) -> broadcast::Receiver<Value> {
        self.inner.subscribe(event)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn classifies_only_the_watch_binding() {
        let esc = json!({ "name": BINDING, "payload": "escape" });
        let press = json!({ "name": BINDING, "payload": "input" });
        assert_eq!(classify(&esc), Some(Input::Escape));
        assert_eq!(classify(&press), Some(Input::Takeover));
        assert_eq!(
            classify(&json!({ "name": "other", "payload": "input" })),
            None
        );
        assert_eq!(
            classify(&json!({ "name": BINDING, "payload": "text" })),
            None
        );
    }
}
