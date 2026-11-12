//! Numbered elements: the buttons, links and fields a page lists for the model, which a number in
//! `browser_click` or `browser_type` points at. The page scripts mirror the Electron pane's.

use serde_json::Value;

/// Page-side helper that lists the buttons, links and inputs the agent can act on, in order.
const COLLECT: &str = r##"
  function __draggyCollect() {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      const text = (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 80);
      if (!text || seen.has(text)) return;
      seen.add(text);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) items.push({ el, rect, type: 'button', text });
    });
    document.querySelectorAll('a[href]').forEach((el) => {
      const text = (el.innerText || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 80);
      if (!text || seen.has(text)) return;
      seen.add(text);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) items.push({ el, rect, type: 'link', text, href: el.href });
    });
    document.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName;
      items.push({
        el,
        rect,
        type: el.tagName === 'SELECT' ? 'select' : 'input',
        text: String(label).substring(0, 80),
        value: el.value || '',
      });
    });
    return items;
  }
"##;

const LIST: &str = r#"
  (() => {
    __COLLECT__
    return JSON.stringify(__draggyCollect().slice(0, 50).map((it, index) => ({
      index,
      type: it.type,
      text: it.text,
      href: it.href,
      value: it.value,
      x: Math.round(it.rect.x + it.rect.width / 2),
      y: Math.round(it.rect.y + it.rect.height / 2),
    })));
  })();
"#;

const CLICK_TARGET: &str = r#"
  (() => {
    __COLLECT__
    const target = __draggyCollect()[__INDEX__];
    if (!target) return JSON.stringify({ missing: true });
    // The real click lands where the pixel is, so the element has to be on screen first.
    if (typeof target.el.scrollIntoView === 'function') target.el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.el.getBoundingClientRect();
    return JSON.stringify({
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    });
  })();
"#;

const INDEX_INFO: &str = r#"
  (() => {
    __COLLECT__
    const target = __draggyCollect()[__INDEX__];
    if (!target) return JSON.stringify({ missing: true });
    const el = target.el;
    const label = el.labels && el.labels[0] ? el.labels[0].textContent : el.getAttribute('aria-label');
    return JSON.stringify({
      role: target.type === 'link' ? 'link' : target.type === 'button' ? 'button' : 'textbox',
      name: target.text,
      inputType: el.tagName === 'INPUT' && el.type === 'submit' ? 'submit' : '',
      attrs: {
        type: el.type || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        label: label || '',
      },
    });
  })();
"#;

const TYPE_INTO: &str = r#"
  (() => {
    __COLLECT__
    const target = __draggyCollect()[__INDEX__];
    if (!target) return false;
    target.el.focus();
    const val = __TEXT__;
    if (target.el.isContentEditable || target.el.getAttribute('contenteditable') === 'true') {
      target.el.innerText = val;
    } else {
      target.el.value = val;
    }
    target.el.dispatchEvent(new Event('input', { bubbles: true }));
    target.el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })();
"#;

fn with_index(template: &str, index: i64) -> String {
    template
        .replace("__COLLECT__", COLLECT)
        .replace("__INDEX__", &index.to_string())
}

/// The numbered elements on the page, as the model sees them.
pub fn list_script() -> String {
    with_index(LIST, 0)
}

/// Where the numbered element is on the screen, or `{ missing }`.
pub fn click_target_script(index: i64) -> String {
    with_index(CLICK_TARGET, index)
}

/// What the numbered element is, for the safety checks, or `{ missing }`.
pub fn index_info_script(index: i64) -> String {
    with_index(INDEX_INFO, index)
}

/// Sets the numbered field's value and fires its input and change events.
pub fn type_into_script(index: i64, text: &str) -> String {
    let literal = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_owned());
    with_index(TYPE_INTO, index).replace("__TEXT__", &literal)
}

/// The number a target names, read the way `parseInt(value, 10)` reads it, or None.
pub fn parse_index(value: &Value) -> Option<i64> {
    let index = match value {
        Value::Number(number) => {
            let raw = number.as_f64()?;
            raw.is_finite().then(|| raw.trunc() as i64)?
        }
        Value::String(text) => {
            let trimmed = text.trim_start();
            let (sign, rest) = match trimmed.strip_prefix('-') {
                Some(rest) => (-1, rest),
                None => (1, trimmed.strip_prefix('+').unwrap_or(trimmed)),
            };
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            rest[..digits].parse::<i64>().ok()?.checked_mul(sign)?
        }
        _ => return None,
    };
    (index >= 0).then_some(index)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn numbers_and_numeric_text_name_an_element() {
        assert_eq!(parse_index(&json!(3)), Some(3));
        assert_eq!(parse_index(&json!("12")), Some(12));
        assert_eq!(parse_index(&json!("4abc")), Some(4));
        assert_eq!(parse_index(&json!(-1)), None);
        assert_eq!(parse_index(&json!("e3")), None);
        assert_eq!(parse_index(&json!(null)), None);
    }

    #[test]
    fn scripts_name_the_index_and_carry_the_helper() {
        let script = click_target_script(7);
        assert!(script.contains("__draggyCollect()[7]"));
        assert!(script.contains("function __draggyCollect"));
        assert!(!script.contains("__INDEX__"));
    }

    #[test]
    fn typed_text_is_a_js_string_literal() {
        let script = type_into_script(2, "a\"b");
        assert!(script.contains(r#"const val = "a\"b";"#));
    }
}
