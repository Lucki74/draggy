//! The agent's frame and cursor. Painted in an isolated world, so the page cannot see or reach it.
#![cfg_attr(not(windows), allow(dead_code))]

use serde_json::{Value, json};

use super::cdp::{Cdp, CdpError};

const WORLD: &str = "draggy-agent";
const ATTR: &str = "data-draggy-agent-overlay";
pub const DEFAULT_COLOR: &str = "#d55e00";

/// The frame, the cursor and the click ripple. The frame is static: an animated shadow keeps a page repainting.
const PAINT: &str = r##"(() => {
  const color = __COLOR__;
  let host = document.querySelector('[__ATTR__]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('__ATTR__', '');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    window.__draggyAgentRoot = root;
    window.__draggyAgentLast = null;
    root.innerHTML = '<style>'
      + '.wrap{position:absolute;inset:0;}'
      + '.border{position:absolute;inset:0;box-sizing:border-box;border:3px solid var(--c);'
      + 'box-shadow:inset 0 0 18px color-mix(in srgb,var(--c) 45%,transparent);}'
      + '.cursor{position:absolute;left:0;top:0;width:20px;height:20px;margin:-3px 0 0 -5px;opacity:0;will-change:transform;}'
      + '.cursor svg{display:block;width:100%;height:100%;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));}'
      + '.ripple{position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;box-sizing:border-box;'
      + 'border-radius:50%;border:2px solid var(--c);background:color-mix(in srgb,var(--c) 25%,transparent);'
      + 'opacity:0;animation:ripple .5s cubic-bezier(.2,.7,.3,1) forwards;}'
      + '@keyframes ripple{0%{transform:var(--at) scale(.3);opacity:.9}100%{transform:var(--at) scale(1.5);opacity:0}}'
      + '</style><div class="wrap"><div class="border"></div>'
      + '<div class="cursor"><svg viewBox="0 0 24 24"><path d="M5.5 3.2v15.4l4.1-3.7 2.7 6.1 2.5-1.1-2.7-6h5.5z" '
      + 'fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg></div></div>';
    (document.documentElement || document.body).appendChild(host);
  }
  const root = window.__draggyAgentRoot;
  const wrap = root.querySelector('.wrap');
  wrap.style.setProperty('--c', color);
  const cursor = root.querySelector('.cursor');
  const x = __X__;
  const y = __Y__;
  if (x !== null && y !== null) {
    const last = window.__draggyAgentLast;
    const still = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // A cursor new to the page slides in from up and left, one that was here glides from where it stopped.
    const from = last || { x: x - 60, y: y - 40 };
    const distance = Math.hypot(x - from.x, y - from.y);
    if (!last) {
      cursor.style.transition = 'none';
      cursor.style.transform = 'translate(' + from.x + 'px,' + from.y + 'px)';
      void cursor.getBoundingClientRect();
    }
    const ms = still ? 0 : Math.round(Math.min(450, 180 + distance * 0.35));
    cursor.style.opacity = '1';
    cursor.style.transition = ms ? 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1), opacity .15s' : 'none';
    cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    window.__draggyAgentLast = { x, y };
    if (__CLICK__) {
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.setProperty('--at', 'translate(' + x + 'px,' + y + 'px)');
      wrap.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    }
  }
  return true;
})()"##;

const HIDE: &str = "(() => { document.querySelectorAll('[__ATTR__]').forEach((el) => el.remove()); return true; })()";

/// The accent if it is a six-digit hex colour, else the default, as the Electron overlay checks it.
pub fn color_of(raw: &str) -> &str {
    let hex =
        raw.len() == 7 && raw.starts_with('#') && raw[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if hex { raw } else { DEFAULT_COLOR }
}

/// The script that paints the frame, and moves the cursor to a point when one is given.
pub fn paint_script(point: Option<(f64, f64)>, click: bool, color: &str) -> String {
    let (x, y) = match point {
        Some((x, y)) => (x.to_string(), y.to_string()),
        None => ("null".to_owned(), "null".to_owned()),
    };
    PAINT
        .replace("__COLOR__", &json!(color_of(color)).to_string())
        .replace("__ATTR__", ATTR)
        .replace("__X__", &x)
        .replace("__Y__", &y)
        .replace("__CLICK__", if click { "true" } else { "false" })
}

pub fn hide_script() -> String {
    HIDE.replace("__ATTR__", ATTR)
}

/// Runs a script in the agent's isolated world of the page's main frame.
pub async fn run(cdp: &impl Cdp, script: &str) -> Result<(), CdpError> {
    let tree = cdp.call("Page.getFrameTree", json!({})).await?;
    let frame = tree
        .pointer("/frameTree/frame/id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let world = cdp
        .call(
            "Page.createIsolatedWorld",
            json!({ "frameId": frame, "worldName": WORLD }),
        )
        .await?;
    let context = world
        .get("executionContextId")
        .cloned()
        .unwrap_or(Value::Null);
    cdp.call(
        "Runtime.evaluate",
        json!({ "expression": script, "contextId": context, "returnByValue": true }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_must_be_six_digit_hex() {
        assert_eq!(color_of("#00ff7a"), "#00ff7a");
        assert_eq!(color_of("red"), DEFAULT_COLOR);
        assert_eq!(color_of("#00ff7"), DEFAULT_COLOR);
        assert_eq!(color_of("#00ff7g"), DEFAULT_COLOR);
    }

    #[test]
    fn paint_script_fills_every_placeholder() {
        let script = paint_script(Some((10.5, 20.0)), true, "#000000");
        assert!(script.contains("const x = 10.5;"));
        assert!(script.contains("const y = 20;"));
        assert!(script.contains("if (true)"));
        assert!(
            !script.contains("__COLOR__")
                && !script.contains("__X__")
                && !script.contains("__CLICK__")
        );
        let frame_only = paint_script(None, false, "bad");
        assert!(frame_only.contains("const x = null;"));
        assert!(frame_only.contains(DEFAULT_COLOR));
    }
}
