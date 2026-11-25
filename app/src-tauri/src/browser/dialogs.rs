//! JavaScript dialogs on the pane's page. A dialog freezes its page, so every step asks first and the
//! model answers it. A page leaving with a "leave this page?" prompt is let go.
//! Dialog text is page content, so only its type and length reach the log.

use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::{Value, json};
use tokio::sync::{Notify, broadcast};

use super::cdp::{Cdp, CdpError};

const MAX_MESSAGE: usize = 500;
const MAX_PROMPT: usize = 200;
const SCOPE: &str = "browser.dialogs";

/// The dialog open on the page, as the model hears it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dialog {
    pub kind: String,
    pub message: String,
    pub default_prompt: String,
}

impl Dialog {
    pub fn to_value(&self) -> Value {
        json!({ "type": self.kind, "message": self.message, "defaultPrompt": self.default_prompt })
    }
}

/// The dialog open on one page, fed by its `Page` events.
#[derive(Default)]
pub struct DialogState {
    pending: Mutex<Option<Dialog>>,
    opened: Notify,
}

impl DialogState {
    /// Feeds an opening dialog. Returns the answer to send at once for a leave-page prompt.
    pub fn open(&self, params: &Value) -> Option<Value> {
        if params.get("type").and_then(Value::as_str) == Some("beforeunload") {
            tracing::debug!(target: SCOPE, "beforeunload auto-accepted");
            return Some(json!({ "accept": true }));
        }
        let dialog = Dialog {
            kind: or_default(params, "type", "alert"),
            message: truncated(&or_default(params, "message", ""), MAX_MESSAGE),
            default_prompt: truncated(&or_default(params, "defaultPrompt", ""), MAX_PROMPT),
        };
        tracing::info!(
            target: SCOPE,
            kind = %dialog.kind,
            message_len = dialog.message.chars().count(),
            "dialog opened"
        );
        *lock(&self.pending) = Some(dialog);
        self.opened.notify_waiters();
        None
    }

    pub fn close(&self) {
        *lock(&self.pending) = None;
    }

    pub fn pending(&self) -> Option<Dialog> {
        lock(&self.pending).clone()
    }

    /// Resolves when a dialog opens, if this is taken before the action that may open one.
    pub fn opened(&self) -> impl Future<Output = ()> + '_ {
        self.opened.notified()
    }
}

/// Answers the open dialog. Returns the dialog answered, or None when none was open.
pub async fn answer(
    state: &DialogState,
    cdp: &impl Cdp,
    accept: bool,
    text: Option<&str>,
) -> Result<Option<Dialog>, CdpError> {
    let Some(closing) = state.pending() else {
        tracing::warn!(target: SCOPE, reason = "no-dialog", "answer refused");
        return Ok(None);
    };
    let mut params = json!({ "accept": accept });
    if let Some(text) = text {
        params["promptText"] = json!(text);
    }
    if let Err(error) = cdp.call("Page.handleJavaScriptDialog", params).await {
        tracing::warn!(target: SCOPE, kind = %closing.kind, accept, "answer failed");
        return Err(error);
    }
    state.close();
    tracing::info!(
        target: SCOPE,
        kind = %closing.kind,
        accept,
        has_text = text.is_some(),
        "dialog answered"
    );
    Ok(Some(closing))
}

/// Follows one page's dialogs from now on. Turns the page's `Page` events on.
pub fn watch<C: Cdp + 'static>(cdp: Arc<C>) -> Arc<DialogState> {
    let state = Arc::new(DialogState::default());
    let opened = cdp.subscribe("Page.javascriptDialogOpening");
    let closed = cdp.subscribe("Page.javascriptDialogClosed");
    tauri::async_runtime::spawn(follow(cdp, state.clone(), opened, closed));
    state
}

async fn follow<C: Cdp>(
    cdp: Arc<C>,
    state: Arc<DialogState>,
    mut opened: broadcast::Receiver<Value>,
    mut closed: broadcast::Receiver<Value>,
) {
    let _ = cdp.call("Page.enable", json!({})).await;
    loop {
        // Once the pane drops its handle for a closed tab, nothing reads this state any more.
        if Arc::strong_count(&state) == 1 {
            break;
        }
        let (is_open, next) = tokio::select! {
            next = opened.recv() => (true, next),
            next = closed.recv() => (false, next),
        };
        match next {
            Ok(params) if is_open => {
                if let Some(reply) = state.open(&params)
                    && cdp
                        .call("Page.handleJavaScriptDialog", reply)
                        .await
                        .is_err()
                {
                    tracing::warn!(target: SCOPE, "beforeunload accept failed");
                }
            }
            Ok(_) => {
                tracing::debug!(target: SCOPE, had_pending = state.pending().is_some(), "dialog closed");
                state.close();
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

fn lock<T>(slot: &Mutex<T>) -> MutexGuard<'_, T> {
    slot.lock().unwrap_or_else(PoisonError::into_inner)
}

fn or_default(params: &Value, key: &str, fallback: &str) -> String {
    match params.get(key).and_then(Value::as_str) {
        Some(text) if !text.is_empty() => text.to_owned(),
        _ => fallback.to_owned(),
    }
}

fn truncated(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::super::cdp::fake::FakeCdp;
    use super::*;

    #[test]
    fn an_open_dialog_is_reported_until_it_closes() {
        let state = DialogState::default();
        assert_eq!(
            state.open(&json!({ "type": "confirm", "message": "Sure?" })),
            None
        );
        let dialog = state.pending().expect("dialog open");
        assert_eq!(dialog.kind, "confirm");
        assert_eq!(dialog.message, "Sure?");
        state.close();
        assert!(state.pending().is_none());
    }

    #[test]
    fn a_leave_page_prompt_is_accepted_without_being_reported() {
        let state = DialogState::default();
        let reply = state.open(&json!({ "type": "beforeunload" }));
        assert_eq!(reply, Some(json!({ "accept": true })));
        assert!(state.pending().is_none());
    }

    #[test]
    fn long_dialog_text_is_cut_short() {
        let state = DialogState::default();
        state.open(&json!({ "message": "x".repeat(900) }));
        assert_eq!(
            state.pending().map(|d| d.message.chars().count()),
            Some(MAX_MESSAGE)
        );
    }

    #[tokio::test]
    async fn answering_sends_the_choice_and_clears_the_dialog() {
        let cdp = FakeCdp::default();
        let state = DialogState::default();
        assert_eq!(answer(&state, &cdp, true, None).await.unwrap(), None);
        state.open(&json!({ "type": "prompt", "message": "Name?", "defaultPrompt": "a" }));
        let closing = answer(&state, &cdp, false, Some("Ada")).await.unwrap();
        assert_eq!(closing.map(|d| d.kind), Some("prompt".to_owned()));
        assert_eq!(
            cdp.params_of("Page.handleJavaScriptDialog"),
            vec![json!({ "accept": false, "promptText": "Ada" })]
        );
        assert!(state.pending().is_none());
    }
}
