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
    return JSON.stringify({
      x: Math.round(target.rect.x + target.rect.width / 2),
      y: Math.round(target.rect.y + target.rect.height / 2),
    });
  })();
`;

/** Reads the page without touching it: the chrome is dropped from a copy, not from the live DOM. */
const readTextScript = (limit = 12000) => `
  (() => {
    const title = document.title || '';
    const source = document.querySelector('main, article, [role="main"]') || document.body;
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
async function clickAt(contents, x, y, pause = wait) {
  contents.sendInputEvent({ type: "mouseMove", x, y });
  await pause(50);
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await pause(50);
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

/**
 * Holds every hop of the page the agent drives to the URL policy: server redirects, navigations the
 * page starts itself, and subframes. A refused hop is cancelled and remembered so the caller can
 * say why the page never loaded.
 * @param {object} contents A `webContents`.
 * @param {{ isFetchableUrl: (url: string) => boolean, scope?: string }} options
 */
function guardNavigation(contents, { isFetchableUrl, scope = "browser" }) {
  let refused = null;
  const refuse = (event, hop, what) => {
    event.preventDefault();
    refused = hop;
    log.warn(scope, `${what} refused`);
  };

  contents.on("will-redirect", (event, hop) => {
    if (!isFetchableUrl(hop)) refuse(event, hop, "redirect");
  });
  contents.on("will-navigate", (event, hop) => {
    if (!isFetchableUrl(hop)) refuse(event, hop, "navigation");
  });
  // A subframe's about: or blob: page has no address to check, so only web addresses are held to the policy.
  contents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame || !/^https?:/i.test(details.url)) return;
    if (!isFetchableUrl(details.url)) refuse(details, details.url, "frame navigation");
  });

  return {
    refusedHop: () => refused,
    reset: () => {
      refused = null;
    },
  };
}

module.exports = {
  failure,
  parseElementIndex,
  COLLECT_ELEMENTS_FN,
  listElementsScript,
  clickTargetScript,
  readTextScript,
  clickAt,
  guardNavigation,
};
