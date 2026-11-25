//! Real input for the pane: keys, clicks, hover, drag, scroll, typing, dropdowns and waits, all over
//! `Cdp`. Typed text and field values are never logged.

use std::time::Duration;

use serde_json::{Value, json};
use tokio::time::sleep;

use super::cdp::Cdp;
use super::keys;
use super::observe::{Fail, parse_int};
use super::pages;

const MAX_REPEAT: i64 = 20;
const MAX_CLICKS: i64 = 3;
const MAX_TYPED: usize = 5000;
const POLL: Duration = Duration::from_millis(250);
const DEFAULT_WAIT_MS: i64 = 10_000;
const MAX_WAIT_MS: i64 = 15_000;
const MAX_PAUSE_MS: i64 = 10_000;
const DRAG_STEPS: usize = 8;
const BUTTONS: &[&str] = &["left", "right", "middle"];

const EDITABLE_FN: &str = "function() { const tag = this.tagName; const kinds = ['checkbox','radio','button','submit','file','image','reset','range','color']; const field = tag === 'TEXTAREA' || (tag === 'INPUT' && !kinds.includes(this.type)); return Boolean((field || this.isContentEditable) && !this.disabled && !this.readOnly); }";
const SELECT_ALL_FN: &str = "function() { if (typeof this.select === 'function') { this.select(); return true; } const range = document.createRange(); range.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(range); return true; }";
const READ_BACK_FN: &str = "function() { if (this.type === 'password') return { hidden: true }; return { value: this.value !== undefined ? this.value : (this.innerText || '') }; }";
const CHOOSE_FN: &str = "function(want) { if (this.tagName !== 'SELECT') return { notSelect: true }; const options = Array.from(this.options); const index = options.findIndex((o) => (want.value !== undefined && o.value === want.value) || (want.label !== undefined && o.text.trim() === want.label)); if (index < 0) return { missing: true, options: options.map((o) => o.text.trim()).slice(0, 30) }; this.selectedIndex = index; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return { chosen: options[index].text.trim(), value: options[index].value }; }";
const ATTRS_FN: &str = "function() { const label = this.labels && this.labels[0] ? this.labels[0].textContent : this.getAttribute('aria-label'); return { type: this.type || '', autocomplete: this.getAttribute('autocomplete') || '', name: this.name || '', id: this.id || '', placeholder: this.placeholder || '', label: label || '' }; }";
const POSITION: &str = "({ y: Math.round(scrollY), max: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight)) })";

fn invalid(message: &str) -> Fail {
    Fail::new("invalid_input", message)
}

/// The CDP modifier bitmask: alt 1, control 2, meta 4, shift 8.
fn modifier_mask(names: &[&str]) -> i64 {
    names.iter().fold(0, |mask, name| {
        mask | match *name {
            "alt" => 1,
            "control" => 2,
            "meta" => 4,
            "shift" => 8,
            _ => 0,
        }
    })
}

async fn pause(ms: u64) {
    sleep(Duration::from_millis(ms)).await;
}

async fn evaluate_value(cdp: &impl Cdp, expression: &str) -> Value {
    pages::evaluate(cdp, expression)
        .await
        .unwrap_or(Value::Null)
}

/// Presses a key spec, optionally repeated. A chord with control or meta types no character.
pub async fn press_key(cdp: &impl Cdp, spec: &str, repeat: Option<&Value>) -> Result<(), Fail> {
    let key = keys::parse_key(spec).map_err(|e| Fail::new(e.code, e.message))?;
    let times = repeat.and_then(parse_int).unwrap_or(1).clamp(1, MAX_REPEAT);
    let mods: Vec<&str> = key.modifiers.clone();
    let mask = modifier_mask(&mods);
    let command = mods.iter().any(|m| *m == "control" || *m == "meta");
    let text = key.char.clone().filter(|_| !command);
    for _ in 0..times {
        let mut down = json!({ "type": "keyDown", "key": key.key_code, "modifiers": mask });
        if let Some(text) = &text {
            down["text"] = json!(text);
        }
        cdp.call("Input.dispatchKeyEvent", down).await?;
        pause(40).await;
        cdp.call(
            "Input.dispatchKeyEvent",
            json!({ "type": "keyUp", "key": key.key_code, "modifiers": mask }),
        )
        .await?;
        pause(40).await;
    }
    Ok(())
}

/// Clicks a point on the page with a button, one to three times.
pub async fn click_at(
    cdp: &impl Cdp,
    x: f64,
    y: f64,
    button: &str,
    count: Option<&Value>,
    modifiers: &[&str],
) -> Result<(), Fail> {
    if !BUTTONS.contains(&button) {
        return Err(invalid(&format!("\"{button}\" is not a mouse button.")));
    }
    let clicks = count.and_then(parse_int).unwrap_or(1).clamp(1, MAX_CLICKS);
    let mask = modifier_mask(modifiers);
    cdp.call(
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": mask }),
    )
    .await?;
    pause(50).await;
    for i in 1..=clicks {
        for kind in ["mousePressed", "mouseReleased"] {
            cdp.call(
                "Input.dispatchMouseEvent",
                json!({ "type": kind, "x": x, "y": y, "button": button, "clickCount": i, "modifiers": mask }),
            )
            .await?;
            pause(50).await;
        }
    }
    Ok(())
}

/// Moves the pointer onto a point and lets hover states settle.
pub async fn hover(cdp: &impl Cdp, x: f64, y: f64) -> Result<(), Fail> {
    cdp.call(
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseMoved", "x": x, "y": y }),
    )
    .await?;
    pause(150).await;
    Ok(())
}

/// Presses at one point, moves in steps to another and releases there.
pub async fn drag(cdp: &impl Cdp, from: (f64, f64), to: (f64, f64)) -> Result<(), Fail> {
    let mouse = |kind: &str, x: f64, y: f64| json!({ "type": kind, "x": x.round(), "y": y.round(), "button": "left", "clickCount": 1 });
    cdp.call(
        "Input.dispatchMouseEvent",
        mouse("mouseMoved", from.0, from.1),
    )
    .await?;
    pause(60).await;
    cdp.call(
        "Input.dispatchMouseEvent",
        mouse("mousePressed", from.0, from.1),
    )
    .await?;
    for i in 1..=DRAG_STEPS {
        pause(30).await;
        let t = i as f64 / DRAG_STEPS as f64;
        let x = from.0 + (to.0 - from.0) * t;
        let y = from.1 + (to.1 - from.1) * t;
        cdp.call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseMoved", "x": x.round(), "y": y.round(), "button": "left" }),
        )
        .await?;
    }
    pause(60).await;
    cdp.call(
        "Input.dispatchMouseEvent",
        mouse("mouseReleased", to.0, to.1),
    )
    .await?;
    Ok(())
}

/// Scrolls the page by a wheel delta, to the top or bottom, or to an element. Returns the position.
pub async fn scroll(cdp: &impl Cdp, dx: f64, dy: f64, to: Option<&str>) -> Result<Value, Fail> {
    match to {
        Some("top") => {
            cdp.call(
                "Runtime.evaluate",
                json!({ "expression": "window.scrollTo(0, 0)" }),
            )
            .await?;
        }
        Some("bottom") => {
            cdp.call(
                "Runtime.evaluate",
                json!({ "expression": "window.scrollTo(0, document.documentElement.scrollHeight)" }),
            )
            .await?;
        }
        Some(_) => return Err(invalid("\"to\" is top or bottom.")),
        None if dx != 0.0 || dy != 0.0 => {
            let size = evaluate_value(cdp, "[innerWidth, innerHeight]").await;
            let width = size.get(0).and_then(Value::as_f64).unwrap_or(0.0);
            let height = size.get(1).and_then(Value::as_f64).unwrap_or(0.0);
            cdp.call(
                "Input.dispatchMouseEvent",
                json!({ "type": "mouseWheel", "x": (width / 2.0).round(), "y": (height / 2.0).round(), "deltaX": dx, "deltaY": dy }),
            )
            .await?;
        }
        None => {
            return Err(invalid(
                "Say where to scroll: a ref, dy or dx, or to top or bottom.",
            ));
        }
    }
    pause(150).await;
    Ok(position(cdp).await)
}

/// The page's scroll position: how far down it is and how far it can go.
pub async fn position(cdp: &impl Cdp) -> Value {
    evaluate_value(cdp, POSITION).await
}

/// What the page says about a field, so the caller can tell a password or card field apart.
pub async fn field_attrs(cdp: &impl Cdp, object_id: &str) -> Result<Value, Fail> {
    let reply = cdp
        .call(
            "Runtime.callFunctionOn",
            json!({ "objectId": object_id, "functionDeclaration": ATTRS_FN, "returnByValue": true }),
        )
        .await?;
    Ok(reply
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

/// Picks an option in the dropdown behind `object_id`, by value or by label.
pub async fn select_option(
    cdp: &impl Cdp,
    object_id: &str,
    value: Option<&str>,
    label: Option<&str>,
) -> Result<Value, Fail> {
    if value.is_none() && label.is_none() {
        return Err(invalid("Give the value or the label of the option."));
    }
    let want = json!({ "value": value, "label": label });
    let reply = cdp
        .call(
            "Runtime.callFunctionOn",
            json!({ "objectId": object_id, "functionDeclaration": CHOOSE_FN, "arguments": [{ "value": want }], "returnByValue": true }),
        )
        .await?;
    let result = reply
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null);
    if result.get("notSelect").is_some() {
        return Err(Fail::new(
            "not_editable",
            "That element is not a dropdown. Click it instead.",
        ));
    }
    if result.get("missing").is_some() {
        let options: Vec<String> = result
            .get("options")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|o| o.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        return Err(Fail::new(
            "element_not_found",
            format!("No such option. The options are: {}.", options.join(", ")),
        ));
    }
    Ok(json!({ "chosen": result.get("chosen"), "value": result.get("value") }))
}

/// Types into the field behind `object_id`. The caller has already checked the field is not sensitive.
/// Returns what the field now holds and whether the text landed in it.
pub async fn type_into(
    cdp: &impl Cdp,
    object_id: &str,
    text: &str,
    clear: bool,
    submit: bool,
) -> Result<(String, bool), Fail> {
    let editable = call_on(cdp, object_id, EDITABLE_FN).await?;
    if editable.as_bool() != Some(true) {
        return Err(Fail::new(
            "not_editable",
            "That element is not a text field.",
        ));
    }
    cdp.call(
        "Runtime.callFunctionOn",
        json!({ "objectId": object_id, "functionDeclaration": "function() { this.focus(); }" }),
    )
    .await?;
    if clear {
        call_on(cdp, object_id, SELECT_ALL_FN).await?;
        press_key(cdp, "Backspace", None).await?;
    }
    let body: String = text.chars().take(MAX_TYPED).collect();
    if !body.is_empty() {
        cdp.call("Input.insertText", json!({ "text": body }))
            .await?;
    }
    if submit {
        press_key(cdp, "Enter", None).await?;
    }
    let read = call_on(cdp, object_id, READ_BACK_FN).await?;
    if read.get("hidden").is_some() {
        return Ok(("(hidden)".to_owned(), true));
    }
    let value = read
        .get("value")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let landed = if clear {
        value == body
    } else {
        value.contains(&body)
    };
    Ok((value.chars().take(200).collect(), landed))
}

async fn call_on(cdp: &impl Cdp, object_id: &str, function: &str) -> Result<Value, Fail> {
    let reply = cdp
        .call(
            "Runtime.callFunctionOn",
            json!({ "objectId": object_id, "functionDeclaration": function, "returnByValue": true }),
        )
        .await?;
    Ok(reply
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

/// Waits for text or a URL to show up on the page, or for a fixed pause. Returns the time spent.
pub async fn wait(
    cdp: &impl Cdp,
    text: Option<&str>,
    url: Option<&str>,
    ms: Option<&Value>,
    timeout_ms: Option<&Value>,
) -> Result<i64, Fail> {
    if let Some(ms) = ms {
        let spent = parse_int(ms).unwrap_or(0).clamp(0, MAX_PAUSE_MS);
        pause(spent as u64).await;
        return Ok(spent);
    }
    let expression = match (text, url) {
        (Some(text), _) => format!(
            "Boolean(document.body && document.body.innerText.includes({}))",
            json!(text)
        ),
        (None, Some(url)) => format!("location.href.includes({})", json!(url)),
        (None, None) => return Err(invalid("Say what to wait for: text, url or ms.")),
    };
    let limit = timeout_ms
        .and_then(parse_int)
        .unwrap_or(DEFAULT_WAIT_MS)
        .clamp(POLL.as_millis() as i64, MAX_WAIT_MS);
    let mut spent = 0i64;
    while spent <= limit {
        if evaluate_value(cdp, &expression).await.as_bool() == Some(true) {
            return Ok(spent);
        }
        pause(POLL.as_millis() as u64).await;
        spent += POLL.as_millis() as i64;
    }
    Err(Fail::new(
        "wait_timeout",
        format!(
            "Still not there after {} seconds.",
            (limit as f64 / 1000.0).round() as i64
        ),
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::cdp::fake::FakeCdp;
    use super::*;

    #[tokio::test]
    async fn a_bad_key_spec_is_an_invalid_key_failure() {
        let cdp = FakeCdp::default();
        let err = press_key(&cdp, "", None).await.unwrap_err();
        assert_eq!(err.code, "invalid_key");
        assert!(cdp.methods().is_empty());
    }

    #[tokio::test]
    async fn an_unknown_mouse_button_is_refused_before_any_input() {
        let cdp = FakeCdp::default();
        let err = click_at(&cdp, 1.0, 1.0, "wheel", None, &[])
            .await
            .unwrap_err();
        assert_eq!(err.code, "invalid_input");
        assert!(cdp.methods().is_empty());
    }

    #[tokio::test]
    async fn select_needs_a_value_or_a_label() {
        let cdp = FakeCdp::default();
        let err = select_option(&cdp, "obj", None, None).await.unwrap_err();
        assert_eq!(err.code, "invalid_input");
    }

    #[tokio::test]
    async fn selecting_on_a_non_dropdown_is_not_editable() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Runtime.callFunctionOn",
            json!({ "result": { "value": { "notSelect": true } } }),
        );
        let err = select_option(&cdp, "obj", Some("a"), None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "not_editable");
    }

    #[tokio::test]
    async fn typing_into_a_non_field_is_refused() {
        let cdp = FakeCdp::default();
        cdp.answer(
            "Runtime.callFunctionOn",
            json!({ "result": { "value": false } }),
        );
        let err = type_into(&cdp, "obj", "hi", false, false)
            .await
            .unwrap_err();
        assert_eq!(err.code, "not_editable");
        assert!(!cdp.methods().iter().any(|m| m == "Input.insertText"));
    }

    #[tokio::test]
    async fn wait_needs_something_to_wait_for() {
        let err = wait(&FakeCdp::default(), None, None, None, None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "invalid_input");
    }

    #[tokio::test]
    async fn scroll_needs_a_target() {
        let err = scroll(&FakeCdp::default(), 0.0, 0.0, None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "invalid_input");
    }

    #[tokio::test]
    async fn text_wait_finds_text_already_on_the_page() {
        let cdp = FakeCdp::default();
        cdp.answer("Runtime.evaluate", json!({ "result": { "value": true } }));
        assert_eq!(wait(&cdp, Some("Done"), None, None, None).await.unwrap(), 0);
    }

    #[test]
    fn modifier_bits_follow_cdp() {
        assert_eq!(modifier_mask(&["control", "shift"]), 10);
        assert_eq!(modifier_mask(&["meta"]), 4);
    }
}
