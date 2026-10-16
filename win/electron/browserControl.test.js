import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const control = require("./browserControl.cjs");

/** A page with layout stubbed in, since jsdom measures nothing and lacks innerText. */
function page(html) {
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  // jsdom has no innerText, so the page reads its text content instead.
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
  });
  dom.window.Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 40 });
  return dom;
}

const evaluate = (dom, script) => JSON.parse(dom.window.eval(script));

describe("clickTargetScript", () => {
  it("only locates the element, so the real click is the only click", () => {
    const dom = page(`<button onclick="window.clicks = (window.clicks || 0) + 1">Buy</button>`);
    const result = evaluate(dom, control.clickTargetScript(0));
    expect(result).toEqual({ x: 60, y: 40 });
    expect(dom.window.clicks).toBeUndefined();
  });

  it("does not steal focus from the page", () => {
    const dom = page(`<input aria-label="a"><button>Go</button>`);
    dom.window.document.querySelector("input").focus();
    evaluate(dom, control.clickTargetScript(1));
    expect(dom.window.document.activeElement.tagName).toBe("INPUT");
  });

  it("names a missing element instead of throwing", () => {
    const dom = page(`<button>Go</button>`);
    expect(evaluate(dom, control.clickTargetScript(5))).toEqual({ missing: true });
  });
});

describe("readTextScript", () => {
  const html = `<header>Site header</header><nav>Menu links</nav>
    <main><h1>Title</h1><p>Body   text here</p><aside>Related</aside></main><footer>Legal</footer>`;

  it("leaves the page exactly as it found it", () => {
    const dom = page(html);
    const before = dom.window.document.body.innerHTML;
    evaluate(dom, control.readTextScript());
    expect(dom.window.document.body.innerHTML).toBe(before);
  });

  it("still returns the readable content without the chrome around it", () => {
    const dom = page(html);
    const { text } = evaluate(dom, control.readTextScript());
    expect(text).toContain("Title");
    expect(text).toContain("Body text here");
    expect(text).not.toContain("Menu links");
    expect(text).not.toContain("Related");
  });

  it("is repeatable, because nothing was removed the first time", () => {
    const dom = page(html);
    const first = evaluate(dom, control.readTextScript());
    const second = evaluate(dom, control.readTextScript());
    expect(second.text).toBe(first.text);
  });
});

function fakeContents() {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((name, handler) => {
      handlers[name] = handler;
    }),
  };
}

describe("guardNavigation", () => {
  const allow = (url) => url.startsWith("https://ok.test");
  const prevent = () => ({ preventDefault: vi.fn() });

  it("cancels a redirect to a refused address and remembers it", () => {
    const contents = fakeContents();
    const guard = control.guardNavigation(contents, { isFetchableUrl: allow });
    const event = prevent();
    contents.handlers["will-redirect"](event, "http://127.0.0.1/admin");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(guard.refusedHop()).toBe("http://127.0.0.1/admin");
  });

  it("cancels a page-started navigation to a refused address", () => {
    const contents = fakeContents();
    const guard = control.guardNavigation(contents, { isFetchableUrl: allow });
    const event = prevent();
    contents.handlers["will-navigate"](event, "file:///etc/passwd");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(guard.refusedHop()).toBe("file:///etc/passwd");
  });

  it("lets an allowed hop through untouched", () => {
    const contents = fakeContents();
    const guard = control.guardNavigation(contents, { isFetchableUrl: allow });
    const event = prevent();
    contents.handlers["will-navigate"](event, "https://ok.test/next");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(guard.refusedHop()).toBeNull();
  });

  it("holds a subframe to the policy but ignores the main frame and addressless frames", () => {
    const contents = fakeContents();
    const guard = control.guardNavigation(contents, { isFetchableUrl: allow });
    const main = { isMainFrame: true, url: "http://10.0.0.1/", preventDefault: vi.fn() };
    const blank = { isMainFrame: false, url: "about:blank", preventDefault: vi.fn() };
    const bad = { isMainFrame: false, url: "http://10.0.0.1/", preventDefault: vi.fn() };
    contents.handlers["will-frame-navigate"](main);
    contents.handlers["will-frame-navigate"](blank);
    expect(main.preventDefault).not.toHaveBeenCalled();
    expect(blank.preventDefault).not.toHaveBeenCalled();
    contents.handlers["will-frame-navigate"](bad);
    expect(bad.preventDefault).toHaveBeenCalled();
    expect(guard.refusedHop()).toBe("http://10.0.0.1/");
  });

  it("clears the remembered hop between navigations", () => {
    const contents = fakeContents();
    const guard = control.guardNavigation(contents, { isFetchableUrl: allow });
    contents.handlers["will-redirect"](prevent(), "http://127.0.0.1/");
    guard.reset();
    expect(guard.refusedHop()).toBeNull();
  });
});

describe("failure", () => {
  it("carries a code, a message and a hint the model can act on", () => {
    const result = control.failure("not_navigated");
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("not_navigated");
    expect(result.error.message).toMatch(/not.*page/i);
    expect(result.error.hint).toMatch(/browser_navigate/);
  });

  it("lets the caller replace the message and keeps the default hint", () => {
    const result = control.failure("script_failed", "boom");
    expect(result.error.message).toBe("boom");
    expect(result.error.hint).toBeTruthy();
  });

  it("falls back to a generic code for one it does not know", () => {
    expect(control.failure("nope").error.code).toBe("unknown");
  });
});

describe("clickAt", () => {
  it("sends one move, one press and one release, and nothing else", async () => {
    const sent = [];
    const contents = { sendInputEvent: (event) => sent.push(event) };
    await control.clickAt(contents, 5, 6, async () => {});
    expect(sent.map((event) => event.type)).toEqual(["mouseMove", "mouseDown", "mouseUp"]);
    expect(sent.filter((event) => event.type === "mouseDown")).toHaveLength(1);
  });
});
