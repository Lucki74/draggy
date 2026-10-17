const { log } = require("./logger.cjs");
/** What the agent's browser tools share: the scripts they run in the page, the real input they
 * send, the navigation guard and the shape of a failure. Kept apart from main.cjs so it can be
 * tested without Electron. */

const FAILURES = {
  not_navigated: {
    message: "The browser has not opened a page yet.",
    hint: "Call browser_navigate with a URL first.",
  },
  refused_url: {
    message: "That address is outside what the browser tools may open.",
    hint: "Use a public http or https address. Local and private network addresses are refused.",
  },
  human_verification: {
    message: "The page is behind a human-verification check and cannot be read automatically.",
    hint: "Tell the user. They can open the page themselves, or you can try another source.",
  },
  element_not_found: {
    message: "No element has that index.",
    hint: "Call browser_get_elements again. Indexes change whenever the page does.",
  },
  invalid_index: {
    message: "The element index is not a whole number.",
    hint: "Pass an index shown by browser_get_elements.",
  },
  navigation_failed: {
    message: "The page did not load.",
    hint: "Check the address, or try again in a moment.",
  },
  script_failed: {
    message: "The page did not answer.",
    hint: "The page may have navigated or closed. Call browser_get_elements to see where you are.",
  },
  stale_ref: {
    message: "That ref no longer points at anything on the page.",
    hint: "Call browser_snapshot again and use a ref from the new list. Refs end when the page changes.",
  },
  invalid_input: {
    message: "That input is not one the browser tools accept.",
    hint: "Check the tool's parameters: a ref from browser_snapshot, or x and y from a viewport screenshot.",
  },
  invalid_key: {
    message: "That key is not one the browser knows.",
    hint: "Use a name like Enter, Tab, Escape, ArrowDown, F5, a single character, or a chord like Control+A.",
  },
  not_editable: {
    message: "That element does not take typed text.",
    hint: "Call browser_snapshot and pick a textbox. For a dropdown use browser_select_option.",
  },
  click_blocked: {
    message: "Another element would receive that click.",
    hint: "Close the overlay or banner in the way first, or scroll the target clear of it.",
  },
  dialog_open: {
    message: "A dialog is open on the page and is waiting for an answer.",
    hint: "Call browser_dialog with accept or dismiss before anything else.",
  },
  no_dialog: {
    message: "No dialog is open on the page.",
    hint: "Call browser_snapshot to see the page.",
  },
  tab_limit: {
    message: "Eight tabs are open, which is the most the browser keeps.",
    hint: "Close a tab with browser_tabs before opening another.",
  },
  invalid_tab: {
    message: "There is no tab with that number, or it is the last one.",
    hint: "Call browser_tabs with action list to see the open tabs. The last tab cannot be closed.",
  },
  wait_timeout: {
    message: "What you waited for did not appear in time.",
    hint: "Call browser_snapshot to see where the page is. Do not wait again for the same thing without a reason.",
  },
  screenshot_failed: {
    message: "The screenshot could not be taken.",
    hint: "Use browser_snapshot to read the page instead, or try again in a moment.",
  },
  user_took_over: {
    message: "The user took over the browser, so this step was stopped.",
    hint: "Stop and ask the user what they want next. Do not retry the step unless they say so.",
  },
  pane_unavailable: {
    message: "The browser pane could not be shown.",
    hint: "Tell the user the browser pane did not open. They can open it from the browser button.",
  },
  unknown: {
    message: "The browser step failed.",
    hint: "Call browser_get_elements to see the page, then retry.",
  },
};

/** `{ ok: false, error: { code, message, hint } }`. A caller may replace the message, never the hint. */
function failure(code, message) {
  const known = Object.hasOwn(FAILURES, code) ? code : "unknown";
  const entry = FAILURES[known];
  return { ok: false, error: { code: known, message: message || entry.message, hint: entry.hint } };
}

function parseElementIndex(value) {
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Page-side helper that lists the buttons, links and inputs the agent can act on. */
const COLLECT_ELEMENTS_FN = `
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
`;

const listElementsScript = () => `
  (() => {
    ${COLLECT_ELEMENTS_FN}
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
`;

/** Where to click, and nothing more. The click itself is real input, sent once by `clickAt`. */
const clickTargetScript = (index) => `
  (() => {
    ${COLLECT_ELEMENTS_FN}
    const target = __draggyCollect()[${Number(index)}];
    if (!target) return JSON.stringify({ missing: true });
    // The real click lands where the pixel is, so the element has to be on screen first.
    if (typeof target.el.scrollIntoView === 'function') target.el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.el.getBoundingClientRect();
    return JSON.stringify({
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    });
  })();
`;

/** Reads the page without touching it: the chrome is dropped from a copy, not from the live DOM. */
const readTextScript = (limit = 12000, selector = "") => `
  (() => {
    const title = document.title || '';
    let source;
    if (${JSON.stringify(String(selector))}) {
      try {
        source = document.querySelector(${JSON.stringify(String(selector))});
      } catch (e) {
        source = null;
      }
      if (!source) return JSON.stringify({ missing: true });
    } else {
      source = document.querySelector('main, article, [role="main"]') || document.body;
    }
    const copy = source.cloneNode(true);
    copy.querySelectorAll('script, style, nav, footer, header, aside, .ad, .ads, [role="banner"], [role="navigation"]')
      .forEach((el) => el.remove());
    const text = (copy.innerText || copy.textContent || '')
      .replace(/[ \\t]+/g, ' ')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim()
      .substring(0, ${Number(limit)});
    return JSON.stringify({ title, text, url: window.location.href });
  })();
`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One move, one press, one release. Nothing else may click on the agent's behalf. */
async function clickAt(contents, x, y, pause = wait, stopped = () => false) {
  contents.sendInputEvent({ type: "mouseMove", x, y });
  await pause(50);
  if (stopped()) return;
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await pause(50);
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

/**
 * Holds every hop of the page the agent drives to the URL policy: server redirects, navigations the
 * page starts itself, and subframes. A refused hop is cancelled and remembered so the caller can
 * say why the page never loaded.
 * @param {object} contents A `webContents`.
 * @param {{ isFetchableUrl: (url: string) => boolean, scope?: string, enabled?: () => boolean }} options
 * `enabled` lets the user browse freely in the pane while the agent is not driving it.
 */
function guardNavigation(contents, { isFetchableUrl, scope = "browser", enabled = () => true }) {
  let refused = null;
  const refuse = (event, hop, what) => {
    event.preventDefault();
    refused = hop;
    log.warn(scope, `${what} refused`);
  };

  contents.on("will-redirect", (event, hop) => {
    if (enabled() && !isFetchableUrl(hop)) refuse(event, hop, "redirect");
  });
  contents.on("will-navigate", (event, hop) => {
    if (enabled() && !isFetchableUrl(hop)) refuse(event, hop, "navigation");
  });
  // A subframe's about: or blob: page has no address to check, so only web addresses are held to the policy.
  contents.on("will-frame-navigate", (details) => {
    if (!enabled() || details.isMainFrame || !/^https?:/i.test(details.url)) return;
    if (!isFetchableUrl(details.url)) refuse(details, details.url, "frame navigation");
  });

  return {
    refusedHop: () => refused,
    reset: () => {
      refused = null;
    },
  };
}

const OVERLAY_ATTR = "data-draggy-agent-overlay";

/** Lives in an isolated world, so page script cannot see or move it. Animates the cursor to a point. */
const overlayScript = ({ x, y } = {}) => `
  (() => {
    let host = document.querySelector('[${OVERLAY_ATTR}]');
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('${OVERLAY_ATTR}', '');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      window.__draggyAgentRoot = root;
      root.innerHTML = '<style>'
        + '.border{position:absolute;inset:0;box-sizing:border-box;border:3px solid #6d5efc;box-shadow:inset 0 0 18px rgba(109,94,252,.45);}'
        + '.cursor{position:absolute;left:0;top:0;width:18px;height:18px;margin:-2px 0 0 -2px;'
        + 'transition:transform .35s cubic-bezier(.2,.8,.2,1);display:none;}'
        + '.cursor svg{width:100%;height:100%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));}'
        + '</style><div class="border"></div>'
        + '<div class="cursor"><svg viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#6d5efc" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>';
      (document.documentElement || document.body).appendChild(host);
    }
    const cursor = window.__draggyAgentRoot.querySelector('.cursor');
    const x = ${Number.isFinite(x) ? Number(x) : "null"};
    const y = ${Number.isFinite(y) ? Number(y) : "null"};
    if (x !== null && y !== null) {
      cursor.style.display = 'block';
      cursor.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    }
    return true;
  })();
`;

const hideOverlayScript = () => `
  (() => {
    document.querySelectorAll('[${OVERLAY_ATTR}]').forEach((el) => el.remove());
    return true;
  })();
`;

const INPUT_THAT_TAKES_OVER = new Set(["mouseDown", "mouseUp", "mouseWheel", "contextMenu"]);

/**
 * The agent's hold on the visible pane. One step runs at a time; any user input in the view while a
 * step runs ends it with `user_took_over`. Input the agent sends itself is flagged and ignored.
 * @param {{ pane: object, requestOpen: () => void, onStatus?: (status: object) => void, openWaitMs?: number }} options
 */
function createDriver({ pane, requestOpen, onStatus = () => {}, openWaitMs = 4000 }) {
  let current = null;
  let sendingDepth = 0;
  const watched = new WeakSet();

  const emit = (step) => onStatus({ active: Boolean(step), step: step || null });

  const userInput = () => {
    if (current && sendingDepth === 0) takeOver();
  };

  function takeOver() {
    if (!current) return;
    current.stopped = true;
    current.resolveTakeover(failure("user_took_over"));
  }

  function watch(contents) {
    if (watched.has(contents)) return;
    watched.add(contents);
    contents.on("before-input-event", userInput);
    contents.on("before-mouse-event", (_event, input) => {
      if (INPUT_THAT_TAKES_OVER.has(input && input.type)) userInput();
    });
  }

  /** `prepare(view)` runs only when the pane has to be opened: a blank pane is never shown, so the
   * page has to start loading before the wait. */
  async function ensureTab({ prepare } = {}) {
    const view = pane.ensure();
    if (!view) return { failed: failure("pane_unavailable") };
    watch(view.webContents);
    if (!pane.isShown()) {
      if (prepare) prepare(view);
      requestOpen();
      if (!(await pane.whenShown(openWaitMs))) return { failed: failure("pane_unavailable") };
    }
    return { view };
  }

  async function run(label, fn) {
    const state = { stopped: false, resolveTakeover: null };
    const taken = new Promise((resolve) => {
      state.resolveTakeover = resolve;
    });
    current = state;
    emit(label);
    try {
      return await Promise.race([taken, fn({ stopped: () => state.stopped })]);
    } finally {
      if (current === state) current = null;
      emit(null);
    }
  }

  async function sending(fn) {
    sendingDepth += 1;
    try {
      return await fn();
    } finally {
      sendingDepth -= 1;
    }
  }

  return {
    ensureTab,
    watch,
    run,
    sending,
    takeOver,
    active: () => current !== null,
    end: () => {
      current = null;
      emit(null);
    },
  };
}

module.exports = {
  createDriver,
  overlayScript,
  hideOverlayScript,
  failure,
  parseElementIndex,
  COLLECT_ELEMENTS_FN,
  listElementsScript,
  clickTargetScript,
  readTextScript,
  clickAt,
  guardNavigation,
};
