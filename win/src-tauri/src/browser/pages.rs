//! The browser pane's page steps, written over `Cdp` so they run the same against WebView2 and the
//! fake. Each returns the JSON the renderer receives, failures included, as Electron did.

use std::time::Duration;

use serde_json::{Value, json};

use super::cdp::{Cdp, CdpError};

/// Reads the page as the navigation waits do: title, load state and how much text is there.
const PAGE_STATE_SCRIPT: &str = r#"(() => {
  const body = document.body ? document.body.innerText : "";
  return {
    title: document.title || "",
    readyState: document.readyState,
    textLength: body.trim().length,
    head: body.substring(0, 2000),
  };
})()"#;

const BOT_CHALLENGE_MARKERS: [&str; 4] = [
    "Verify you are human",
    "Checking your browser",
    "I am human",
    "Please verify you are a human",
];

/// Navigation waits give up after this many page reads, each one `pace` apart.
const NAVIGATE_READS: usize = 6;
/// History waits give up after this long, polled every `pace`.
const HISTORY_WAIT: Duration = Duration::from_secs(15);

/// The failure shape the renderer reads: `{ ok: false, error: { code, message, hint } }`.
pub fn failure(code: &str, message: Option<&str>) -> Value {
    let (known, default_message, hint) = FAILURES
        .iter()
        .find(|(name, _, _)| *name == code)
        .copied()
        .unwrap_or(FAILURES[FAILURES.len() - 1]);
    json!({
        "ok": false,
        "error": {
            "code": known,
            "message": message.unwrap_or(default_message),
            "hint": hint,
        }
    })
}

/// Code, message and hint for each failure the pane's own steps can report.
const FAILURES: &[(&str, &str, &str)] = &[
    (
        "not_navigated",
        "The browser has not opened a page yet.",
        "Call browser_navigate with a URL first.",
    ),
    (
        "refused_url",
        "That address is outside what the browser tools may open.",
        "Use a public http or https address. Local and private network addresses are refused.",
    ),
    (
        "human_verification",
        "The page is behind a human-verification check and cannot be read automatically.",
        "Tell the user. They can open the page themselves, or you can try another source.",
    ),
    (
        "navigation_failed",
        "The page did not load.",
        "Check the address, or try again in a moment.",
    ),
    (
        "script_failed",
        "The page did not answer.",
        "The page may have navigated or closed. Call browser_get_elements to see where you are.",
    ),
    (
        "invalid_input",
        "That input is not one the browser tools accept.",
        "Check the tool's parameters: a ref from browser_snapshot, or x and y from a viewport screenshot.",
    ),
    (
        "tab_limit",
        "Eight tabs are open, which is the most the browser keeps.",
        "Close a tab with browser_tabs before opening another.",
    ),
    (
        "invalid_tab",
        "There is no tab with that number, or it is the last one.",
        "Call browser_tabs with action list to see the open tabs. The last tab cannot be closed.",
    ),
    (
        "pane_unavailable",
        "The browser pane could not be shown.",
        "Tell the user the browser pane did not open. They can open it from the browser button.",
    ),
    (
        "invalid_index",
        "The element number is not one the page has.",
        "Call browser_snapshot and use a ref such as e1 instead.",
    ),
    (
        "invalid_key",
        "That key is not one the browser knows.",
        "Use a key such as Enter, Tab, Escape, F5, or a single character, with optional Control+ or Shift+ prefixes.",
    ),
    (
        "needs_confirmation",
        "That action pays, deletes, sends or posts, so the user has to confirm it.",
        "Ask the user to do it themselves in the browser pane.",
    ),
    (
        "click_blocked",
        "Another element would receive the click.",
        "Scroll or close what covers the target, then snapshot again.",
    ),
    (
        "stale_ref",
        "That ref is not on the page any more.",
        "Call browser_snapshot again to get fresh refs.",
    ),
    (
        "element_not_found",
        "The element is not on the page.",
        "Call browser_snapshot to see what is there, then retry.",
    ),
    (
        "not_editable",
        "That element cannot take this action.",
        "Use a text field, a dropdown or a clickable element, as the action needs.",
    ),
    (
        "needs_user",
        "That field needs the user's own input.",
        "Ask the user to fill it in themselves in the browser pane.",
    ),
    (
        "rate_limited",
        "The browser has taken too many actions in a minute.",
        "Wait a minute before acting again.",
    ),
    (
        "site_denied",
        "The agent may not act on this site yet.",
        "Read the page instead, or ask the user to approve the site.",
    ),
    (
        "wait_timeout",
        "The page did not get there in time.",
        "Check the page with browser_snapshot, then wait again or act.",
    ),
    (
        "screenshot_failed",
        "The page would not take a screenshot.",
        "Try again once the page has finished loading.",
    ),
    (
        "dialog_open",
        "A dialog is open on the page and is waiting for an answer.",
        "Call browser_dialog with accept or dismiss before anything else.",
    ),
    (
        "no_dialog",
        "No dialog is open on the page.",
        "Call browser_snapshot to see the page.",
    ),
    (
        "halted",
        "The user pressed Esc to stop the browser.",
        "Stop and ask the user whether to continue.",
    ),
    (
        "user_took_over",
        "The user took over the browser, so this step was stopped.",
        "Stop and ask the user what they want next. Do not retry the step unless they say so.",
    ),
    (
        "unknown",
        "The browser step failed.",
        "Call browser_get_elements to see the page, then retry.",
    ),
];

#[derive(Debug, PartialEq)]
pub struct PageState {
    pub title: String,
    pub ready_state: String,
    pub text_length: u64,
    pub head: String,
}

impl PageState {
    fn from_value(value: &Value) -> Self {
        Self {
            title: text_of(value, "title"),
            ready_state: text_of(value, "readyState"),
            text_length: value.get("textLength").and_then(Value::as_u64).unwrap_or(0),
            head: text_of(value, "head"),
        }
    }

    /// A challenge is not something to wait out, so it is named at once.
    pub fn is_bot_challenge(&self) -> bool {
        self.title.contains("Just a moment")
            || BOT_CHALLENGE_MARKERS.iter().any(|m| self.head.contains(m))
    }
}

fn text_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Runs an expression in the page and returns its value. A thrown error is a failure.
pub async fn evaluate(cdp: &impl Cdp, expression: &str) -> Result<Value, CdpError> {
    let reply = cdp
        .call(
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true }),
        )
        .await?;
    if let Some(details) = reply.get("exceptionDetails") {
        let text = details
            .pointer("/exception/description")
            .or_else(|| details.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("the page script threw");
        return Err(CdpError(text.to_owned()));
    }
    Ok(reply
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

pub async fn page_state(cdp: &impl Cdp) -> Result<PageState, CdpError> {
    let value = evaluate(cdp, PAGE_STATE_SCRIPT).await?;
    Ok(PageState::from_value(&value))
}

/// The page's title, or empty when the page cannot answer.
pub async fn title(cdp: &impl Cdp) -> String {
    match evaluate(cdp, "document.title || ''").await {
        Ok(value) => value.as_str().unwrap_or_default().to_owned(),
        Err(_) => String::new(),
    }
}

async fn location(cdp: &impl Cdp) -> String {
    match evaluate(cdp, "location.href").await {
        Ok(value) => value.as_str().unwrap_or_default().to_owned(),
        Err(_) => String::new(),
    }
}

async fn success(cdp: &impl Cdp) -> Value {
    json!({ "ok": true, "title": title(cdp).await, "url": location(cdp).await })
}

/// Loads `url` in the pane and waits for the text to show. `pace` is the wait between page reads.
pub async fn navigate(cdp: &impl Cdp, url: &str, pace: Duration) -> Value {
    let reply = match cdp.call("Page.navigate", json!({ "url": url })).await {
        Ok(reply) => reply,
        Err(error) => return failure("navigation_failed", Some(&error.0)),
    };
    if let Some(text) = reply.get("errorText").and_then(Value::as_str) {
        return failure("navigation_failed", Some(text));
    }
    for _ in 0..NAVIGATE_READS {
        let state = match page_state(cdp).await {
            Ok(state) => state,
            Err(error) => return failure("navigation_failed", Some(&error.0)),
        };
        if state.is_bot_challenge() {
            return failure("human_verification", None);
        }
        if state.ready_state == "complete" && state.text_length > 50 {
            break;
        }
        tokio::time::sleep(pace).await;
    }
    success(cdp).await
}

/// Back, forward or reload the pane's page. Anything else is invalid input.
pub async fn history(cdp: &impl Cdp, action: &str, pace: Duration) -> Value {
    if !matches!(action, "back" | "forward" | "reload") {
        return failure(
            "invalid_input",
            Some("The history action is back, forward or reload."),
        );
    }
    match step_history(cdp, action).await {
        Ok(None) => {}
        Ok(Some(refusal)) => return refusal,
        Err(error) => return failure("navigation_failed", Some(&error.0)),
    }
    tokio::time::sleep(pace).await;
    let started = std::time::Instant::now();
    while started.elapsed() < HISTORY_WAIT {
        match evaluate(cdp, "document.readyState").await {
            Ok(state) if state == "complete" => break,
            Ok(_) => tokio::time::sleep(pace).await,
            Err(_) => break,
        }
    }
    success(cdp).await
}

/// Whether the pane's history has an entry after the current one.
pub async fn can_go_forward(cdp: &impl Cdp) -> bool {
    match cdp.call("Page.getNavigationHistory", json!({})).await {
        Ok(list) => forward_available(&list),
        Err(_) => false,
    }
}

fn forward_available(list: &Value) -> bool {
    let current = list
        .get("currentIndex")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let count = list
        .get("entries")
        .and_then(Value::as_array)
        .map_or(0, Vec::len) as u64;
    current + 1 < count
}

/// `Ok(None)` once the step is sent; `Ok(Some)` for a step the page cannot take.
async fn step_history(cdp: &impl Cdp, action: &str) -> Result<Option<Value>, CdpError> {
    if action == "reload" {
        cdp.call("Page.reload", json!({})).await?;
        return Ok(None);
    }
    let list = cdp.call("Page.getNavigationHistory", json!({})).await?;
    let current = list
        .get("currentIndex")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let entries = list
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let target = if action == "back" {
        if current == 0 {
            return Ok(Some(failure(
                "navigation_failed",
                Some("There is no earlier page."),
            )));
        }
        current - 1
    } else {
        if current + 1 >= entries.len() {
            return Ok(Some(failure(
                "navigation_failed",
                Some("There is no later page."),
            )));
        }
        current + 1
    };
    let id = entries
        .get(target)
        .and_then(|entry| entry.get("id"))
        .cloned()
        .unwrap_or(Value::Null);
    cdp.call("Page.navigateToHistoryEntry", json!({ "entryId": id }))
        .await?;
    Ok(None)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::cdp::fake::FakeCdp;
    use super::*;

    const LONG_TEXT: &str =
        "A paragraph of plain page text that is comfortably longer than fifty characters.";

    fn page(ready: &str, title: &str, text: &str, length: u64) -> Value {
        json!({ "result": { "type": "object", "value": {
            "title": title, "readyState": ready, "textLength": length, "head": text,
        } } })
    }

    fn string(value: &str) -> Value {
        json!({ "result": { "type": "string", "value": value } })
    }

    #[tokio::test]
    async fn navigate_reports_title_and_url_once_the_text_is_there() {
        let cdp = FakeCdp::default();
        cdp.answer("Page.navigate", json!({ "frameId": "f" }));
        cdp.answer("Runtime.evaluate", page("complete", "Docs", LONG_TEXT, 80));
        let got = navigate(&cdp, "https://example.com/docs", Duration::ZERO).await;
        assert_eq!(got["ok"], true);
        assert_eq!(
            cdp.params_of("Page.navigate")[0]["url"],
            "https://example.com/docs"
        );
        assert_eq!(
            cdp.methods()
                .iter()
                .filter(|m| *m == "Runtime.evaluate")
                .count(),
            3
        );
    }

    #[tokio::test]
    async fn navigate_names_a_bot_challenge_at_once() {
        let cdp = FakeCdp::default();
        cdp.answer("Page.navigate", json!({}));
        cdp.answer(
            "Runtime.evaluate",
            page("loading", "Just a moment...", "", 0),
        );
        let got = navigate(&cdp, "https://example.com/", Duration::ZERO).await;
        assert_eq!(got["error"]["code"], "human_verification");
        assert_eq!(
            cdp.methods()
                .iter()
                .filter(|m| *m == "Runtime.evaluate")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn navigate_keeps_the_network_error_text() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Page.navigate",
            json!({ "errorText": "net::ERR_NAME_NOT_RESOLVED" }),
        );
        let got = navigate(&cdp, "https://nowhere.example/", Duration::ZERO).await;
        assert_eq!(got["error"]["code"], "navigation_failed");
        assert_eq!(got["error"]["message"], "net::ERR_NAME_NOT_RESOLVED");
        assert_eq!(
            got["error"]["hint"],
            "Check the address, or try again in a moment."
        );
    }

    #[tokio::test]
    async fn back_at_the_first_page_is_a_failure_with_the_electron_sentence() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Page.getNavigationHistory",
            json!({ "currentIndex": 0, "entries": [{ "id": 1, "url": "https://a.example/" }] }),
        );
        let got = history(&cdp, "back", Duration::ZERO).await;
        assert_eq!(got["error"]["message"], "There is no earlier page.");
        assert!(cdp.params_of("Page.navigateToHistoryEntry").is_empty());
    }

    #[tokio::test]
    async fn forward_goes_to_the_next_entry_id() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Page.getNavigationHistory",
            json!({ "currentIndex": 0, "entries": [{ "id": 7 }, { "id": 9 }] }),
        );
        cdp.answer("Runtime.evaluate", string("complete"));
        let got = history(&cdp, "forward", Duration::ZERO).await;
        assert_eq!(got["ok"], true);
        assert_eq!(
            cdp.params_of("Page.navigateToHistoryEntry")[0]["entryId"],
            9
        );
    }

    #[tokio::test]
    async fn reload_and_unknown_actions() {
        let cdp = FakeCdp::default();
        cdp.answer("Runtime.evaluate", string("complete"));
        assert_eq!(history(&cdp, "reload", Duration::ZERO).await["ok"], true);
        assert_eq!(cdp.methods()[0], "Page.reload");
        let sent = cdp.methods().len();
        let bad = history(&cdp, "stop", Duration::ZERO).await;
        assert_eq!(bad["error"]["code"], "invalid_input");
        assert_eq!(cdp.methods().len(), sent, "an unknown action sends nothing");
    }

    #[tokio::test]
    async fn title_is_empty_when_the_page_cannot_answer() {
        let cdp = FakeCdp::default();
        cdp.fail("Runtime.evaluate", "page gone");
        assert_eq!(title(&cdp).await, "");
    }

    #[test]
    fn failures_fall_back_to_unknown_for_an_unlisted_code() {
        let got = failure("made_up", None);
        assert_eq!(got["error"]["code"], "unknown");
        assert_eq!(got["ok"], false);
    }

    #[tokio::test]
    async fn a_throwing_page_script_is_an_error_not_a_value() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Runtime.evaluate",
            json!({ "exceptionDetails": { "text": "Uncaught" } }),
        );
        let error: CdpError = evaluate(&cdp, "1+").await.unwrap_err();
        assert_eq!(error.0, "Uncaught");
    }

    #[test]
    fn forward_follows_the_history_cursor() {
        let at_end = json!({ "currentIndex": 1, "entries": [{ "id": 1 }, { "id": 2 }] });
        let mid = json!({ "currentIndex": 0, "entries": [{ "id": 1 }, { "id": 2 }] });
        assert!(!forward_available(&at_end));
        assert!(forward_available(&mid));
        assert!(!forward_available(&json!({})));
    }
}
