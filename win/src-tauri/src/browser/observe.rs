//! What the agent sees of a page: an accessibility snapshot with refs (e1, e2, ...), text read from a
//! ref, and screenshots whose points map back onto the page.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{Value, json};

use super::cdp::{Cdp, CdpError};
use super::pages;

const INTERACTIVE: &[&str] = &[
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "menuitem",
    "tab",
    "option",
    "slider",
    "spinbutton",
    "listbox",
    "heading",
];
const MAX_REFS: usize = 200;
const MAX_NAME: usize = 80;
const NO_BOX: &str = "That element has no box on the screen.";

/// A failure the pane reports as `{ ok: false, error }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
}

impl Fail {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn reply(&self) -> Value {
        // An empty message takes the table's text for the code.
        if self.message.is_empty() {
            return pages::failure(self.code, None);
        }
        pages::failure(self.code, Some(&self.message))
    }
}

impl From<CdpError> for Fail {
    fn from(error: CdpError) -> Self {
        Fail::new("script_failed", error.0)
    }
}

/// One element of the last snapshot: its DOM node and what the page calls it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub backend_id: i64,
    pub role: String,
    pub name: String,
}

/// Holds the ref table of the last snapshot and the size of the last screenshot.
#[derive(Default)]
pub struct Observer {
    table: Mutex<HashMap<String, Entry>>,
    shot: Mutex<Option<(f64, f64)>>,
}

/// The JS object behind a DOM node, for the scripts that need the element itself.
pub async fn object_of(cdp: &impl Cdp, backend_id: i64) -> Result<String, Fail> {
    let resolved = cdp
        .call("DOM.resolveNode", json!({ "backendNodeId": backend_id }))
        .await?;
    resolved
        .pointer("/object/objectId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            Fail::new(
                "element_not_found",
                "That element is no longer on the page.",
            )
        })
}

/// True for a ref such as `e12`.
pub fn is_ref(text: &str) -> bool {
    text.len() > 1 && text.starts_with('e') && text[1..].bytes().all(|b| b.is_ascii_digit())
}

/// An integer from a JSON number or a numeric string, or None.
pub fn parse_int(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn ax_text(node: &Value, key: &str) -> String {
    node.get(key)
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn page_url(value: Result<Value, CdpError>) -> String {
    value
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl Observer {
    /// Reads the accessibility tree and numbers its interactive elements e1, e2, ...
    pub async fn snapshot(&self, cdp: &impl Cdp) -> Result<Value, Fail> {
        let tree = cdp.call("Accessibility.getFullAXTree", json!({})).await?;
        let nodes = tree
            .get("nodes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut table = HashMap::new();
        let mut lines = Vec::new();
        let mut total = 0usize;
        for node in &nodes {
            if node
                .get("ignored")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                continue;
            }
            let role = ax_text(node, "role");
            let Some(backend_id) = node.get("backendDOMNodeId").and_then(Value::as_i64) else {
                continue;
            };
            if !INTERACTIVE.contains(&role.as_str()) {
                continue;
            }
            total += 1;
            if table.len() >= MAX_REFS {
                continue;
            }
            let name: String = ax_text(node, "name").chars().take(MAX_NAME).collect();
            let reference = format!("e{}", table.len() + 1);
            lines.push(format!("{reference} {role} \"{name}\""));
            table.insert(
                reference,
                Entry {
                    backend_id,
                    role,
                    name,
                },
            );
        }
        *self.table.lock().unwrap_or_else(|e| e.into_inner()) = table;
        Ok(json!({
            "ok": true,
            "title": pages::title(cdp).await,
            "url": page_url(pages::evaluate(cdp, "location.href").await),
            "text": lines.join("\n"),
            "total": total,
            "omitted": total.saturating_sub(MAX_REFS),
        }))
    }

    /// The entry behind a ref, after checking the element is still in the page.
    pub async fn resolve(&self, cdp: &impl Cdp, reference: &str) -> Result<Entry, Fail> {
        let stale = || {
            Fail::new(
                "stale_ref",
                format!("{reference} is not on the page any more. Call browser_snapshot again."),
            )
        };
        let entry = self
            .table
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(reference)
            .cloned()
            .ok_or_else(stale)?;
        let described = cdp
            .call(
                "DOM.describeNode",
                json!({ "backendNodeId": entry.backend_id }),
            )
            .await
            .map_err(|_| stale())?;
        if described.get("node").is_none() {
            return Err(stale());
        }
        Ok(entry)
    }

    /// The centre of a ref's box, after scrolling it into view.
    pub async fn point_of(&self, cdp: &impl Cdp, reference: &str) -> Result<(f64, f64), Fail> {
        let entry = self.resolve(cdp, reference).await?;
        let id = json!({ "backendNodeId": entry.backend_id });
        let _ = cdp.call("DOM.scrollIntoViewIfNeeded", id.clone()).await;
        let model = cdp
            .call("DOM.getBoxModel", id)
            .await
            .map_err(|_| Fail::new("element_not_found", NO_BOX))?;
        let quad: Vec<f64> = model
            .pointer("/model/content")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        if quad.len() != 8 {
            return Err(Fail::new("element_not_found", NO_BOX));
        }
        Ok((
            (quad[0] + quad[2] + quad[4] + quad[6]) / 4.0,
            (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0,
        ))
    }

    /// The text a ref shows, as the page reports it.
    pub async fn text_of(&self, cdp: &impl Cdp, reference: &str) -> Result<String, Fail> {
        let entry = self.resolve(cdp, reference).await?;
        let resolved = cdp
            .call(
                "DOM.resolveNode",
                json!({ "backendNodeId": entry.backend_id }),
            )
            .await?;
        let object = resolved
            .pointer("/object/objectId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                Fail::new(
                    "element_not_found",
                    "That element is no longer on the page.",
                )
            })?;
        let reply = cdp
            .call(
                "Runtime.callFunctionOn",
                json!({
                    "objectId": object,
                    "functionDeclaration": "function() { return this.innerText || this.value || this.textContent || ''; }",
                    "returnByValue": true,
                }),
            )
            .await?;
        Ok(reply
            .pointer("/result/value")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    /// A PNG of the viewport, in CSS pixels, so a point in it is a point on the page.
    pub async fn screenshot(&self, cdp: &impl Cdp) -> Result<Value, Fail> {
        let metrics = cdp.call("Page.getLayoutMetrics", json!({})).await?;
        let width = metrics
            .pointer("/cssVisualViewport/clientWidth")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let height = metrics
            .pointer("/cssVisualViewport/clientHeight")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let shot = cdp
            .call("Page.captureScreenshot", json!({ "format": "png" }))
            .await?;
        let Some(data) = shot.get("data").and_then(Value::as_str) else {
            return Err(Fail::new(
                "screenshot_failed",
                "The page would not take a screenshot.",
            ));
        };
        *self.shot.lock().unwrap_or_else(|e| e.into_inner()) = Some((width, height));
        Ok(json!({
            "ok": true,
            "data": data,
            "width": width,
            "height": height,
            "scale": 1,
            "url": page_url(pages::evaluate(cdp, "location.href").await),
        }))
    }

    /// Maps a point in the last screenshot onto the page. Needs a screenshot first.
    pub fn shot_point(&self, x: f64, y: f64) -> Result<(f64, f64), Fail> {
        let size = *self.shot.lock().unwrap_or_else(|e| e.into_inner());
        let Some((width, height)) = size else {
            return Err(Fail::new(
                "invalid_input",
                "Take a screenshot first, then click at its x and y.",
            ));
        };
        if x < 0.0 || y < 0.0 || x > width || y > height {
            return Err(Fail::new(
                "invalid_input",
                "That point is outside the last screenshot.",
            ));
        }
        Ok((x, y))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::cdp::fake::FakeCdp;
    use super::*;

    fn tree() -> Value {
        json!({ "nodes": [
            { "nodeId": "1", "role": { "value": "RootWebArea" }, "name": { "value": "Shop" }, "backendDOMNodeId": 1 },
            { "nodeId": "2", "role": { "value": "button" }, "name": { "value": "Buy now" }, "backendDOMNodeId": 7 },
            { "nodeId": "3", "role": { "value": "generic" }, "name": { "value": "" }, "backendDOMNodeId": 8 },
            { "nodeId": "4", "role": { "value": "link" }, "name": { "value": "Home" }, "backendDOMNodeId": 9, "ignored": true },
            { "nodeId": "5", "role": { "value": "link" }, "name": { "value": "Help" }, "backendDOMNodeId": 10 },
        ]})
    }

    #[tokio::test]
    async fn snapshot_numbers_interactive_elements_only() {
        let cdp = FakeCdp::default();
        cdp.answer("Accessibility.getFullAXTree", tree());
        let out = Observer::default().snapshot(&cdp).await.unwrap();
        assert_eq!(out["text"], "e1 button \"Buy now\"\ne2 link \"Help\"");
        assert_eq!(out["total"], 2);
        assert_eq!(out["omitted"], 0);
    }

    #[tokio::test]
    async fn a_ref_missing_from_the_page_is_stale() {
        let cdp = FakeCdp::default();
        cdp.answer("Accessibility.getFullAXTree", tree());
        let observer = Observer::default();
        observer.snapshot(&cdp).await.unwrap();
        cdp.fail("DOM.describeNode", "No node with given id");
        let err = observer.resolve(&cdp, "e1").await.unwrap_err();
        assert_eq!(err.code, "stale_ref");
    }

    #[tokio::test]
    async fn an_unknown_ref_is_stale() {
        let err = Observer::default()
            .resolve(&FakeCdp::default(), "e9")
            .await
            .unwrap_err();
        assert_eq!(err.code, "stale_ref");
    }

    #[tokio::test]
    async fn point_is_the_centre_of_the_box() {
        let cdp = FakeCdp::default();
        cdp.answer("Accessibility.getFullAXTree", tree());
        cdp.answer("DOM.describeNode", json!({ "node": {} }));
        cdp.answer(
            "DOM.getBoxModel",
            json!({ "model": { "content": [10.0, 20.0, 30.0, 20.0, 30.0, 40.0, 10.0, 40.0] } }),
        );
        let observer = Observer::default();
        observer.snapshot(&cdp).await.unwrap();
        assert_eq!(observer.point_of(&cdp, "e1").await.unwrap(), (20.0, 30.0));
    }

    #[test]
    fn click_point_needs_a_screenshot_first() {
        assert_eq!(
            Observer::default().shot_point(5.0, 5.0).unwrap_err().code,
            "invalid_input"
        );
    }

    #[test]
    fn refs_and_ints_parse() {
        assert!(is_ref("e12"));
        assert!(!is_ref("e"));
        assert!(!is_ref("button"));
        assert_eq!(parse_int(&json!("42")), Some(42));
        assert_eq!(parse_int(&json!(3.9)), Some(3));
        assert_eq!(parse_int(&json!(true)), None);
    }
}
