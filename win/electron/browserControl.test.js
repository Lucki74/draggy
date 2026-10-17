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

  it("scrolls a hidden element into view before measuring it", () => {
    const dom = page(`<button>Below the fold</button>`);
    let scrolled = false;
    dom.window.HTMLElement.prototype.scrollIntoView = () => {
      scrolled = true;
    };
    dom.window.Element.prototype.getBoundingClientRect = () =>
      scrolled ? { x: 10, y: 20, width: 100, height: 40 } : { x: 10, y: 900, width: 100, height: 40 };
    expect(evaluate(dom, control.clickTargetScript(0))).toEqual({ x: 60, y: 40 });
  });
});

describe("readTextScript with a selector", () => {
  const html = `<nav>Menu</nav><section id="cart"><p>Total 12</p><p>Tax 2</p></section><footer>Legal</footer>`;

  it("reads only the part of the page the selector names, without touching the page", () => {
    const dom = page(html);
    const before = dom.window.document.body.innerHTML;
    const result = evaluate(dom, control.readTextScript(12000, "#cart"));
    expect(result.text).toContain("Total 12");
    expect(result.text).not.toContain("Menu");
    expect(dom.window.document.body.innerHTML).toBe(before);
  });

  it("says so when nothing matches, or the selector is not valid", () => {
    const dom = page(html);
    expect(evaluate(dom, control.readTextScript(12000, "#nope"))).toEqual({ missing: true });
    expect(evaluate(dom, control.readTextScript(12000, "!!"))).toEqual({ missing: true });
  });

  it("keeps a selector from breaking out of the script", () => {
    const dom = page(html);
    const result = evaluate(dom, control.readTextScript(12000, `"]); window.hacked = 1; ("`));
    expect(result).toEqual({ missing: true });
    expect(dom.window.hacked).toBeUndefined();
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

describe("input failures", () => {
  it.each(["invalid_input", "invalid_key", "not_editable", "click_blocked", "wait_timeout"])("%s keeps its code and a hint", (code) => {
    const result = control.failure(code);
    expect(result.error.code).toBe(code);
    expect(result.error.hint.length).toBeGreaterThan(10);
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

  it("tells the model to take a new snapshot when a ref went stale", () => {
    const result = control.failure("stale_ref");
    expect(result.error.code).toBe("stale_ref");
    expect(result.error.hint).toMatch(/browser_snapshot/);
  });

  it("names a screenshot that could not be taken", () => {
    expect(control.failure("screenshot_failed").error.code).toBe("screenshot_failed");
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

  it("sends no press once the user took over", async () => {
    const sent = [];
    const contents = { sendInputEvent: (event) => sent.push(event) };
    let stopped = false;
    await control.clickAt(contents, 1, 2, async () => { stopped = true; }, () => stopped);
    expect(sent.map((event) => event.type)).toEqual(["mouseMove"]);
  });
});

describe("guardNavigation while the agent is not driving", () => {
  it("leaves the user's own navigation alone", () => {
    const contents = fakeContents();
    let driving = false;
    const guard = control.guardNavigation(contents, {
      isFetchableUrl: () => false,
      enabled: () => driving,
    });
    const event = { preventDefault: vi.fn() };
    contents.handlers["will-navigate"](event, "http://localhost:3000/");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(guard.refusedHop()).toBeNull();

    driving = true;
    contents.handlers["will-navigate"](event, "http://localhost:3000/");
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

function fakePane({ shown = true, appears = true } = {}) {
  const state = { shown };
  const view = { webContents: fakeContents() };
  return {
    state,
    view,
    ensure: vi.fn(() => view),
    isShown: () => state.shown,
    whenShown: vi.fn(async () => {
      if (appears) state.shown = true;
      return appears;
    }),
  };
}

describe("driver.ensureTab", () => {
  it("returns the pane view without asking for anything when the pane is showing", async () => {
    const pane = fakePane();
    const requestOpen = vi.fn();
    const driver = control.createDriver({ pane, requestOpen });
    const result = await driver.ensureTab();
    expect(result.view).toBe(pane.view);
    expect(requestOpen).not.toHaveBeenCalled();
  });

  it("asks the renderer to open the pane and waits for it to be on screen", async () => {
    const pane = fakePane({ shown: false });
    const requestOpen = vi.fn();
    const driver = control.createDriver({ pane, requestOpen, openWaitMs: 1234 });
    const result = await driver.ensureTab();
    expect(requestOpen).toHaveBeenCalledTimes(1);
    expect(pane.whenShown).toHaveBeenCalledWith(1234);
    expect(result.view).toBe(pane.view);
  });

  it("lets the caller start a page load before waiting, since a blank pane is never shown", async () => {
    const pane = fakePane({ shown: false });
    const order = [];
    pane.whenShown = vi.fn(async () => {
      order.push("wait");
      return true;
    });
    const driver = control.createDriver({ pane, requestOpen: () => order.push("open") });
    await driver.ensureTab({ prepare: () => order.push("prepare") });
    expect(order).toEqual(["prepare", "open", "wait"]);
  });

  it("does not prepare when the pane is already showing", async () => {
    const driver = control.createDriver({ pane: fakePane(), requestOpen: vi.fn() });
    const prepare = vi.fn();
    await driver.ensureTab({ prepare });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("fails with a reason when the pane never appears", async () => {
    const pane = fakePane({ shown: false, appears: false });
    const driver = control.createDriver({ pane, requestOpen: vi.fn() });
    const result = await driver.ensureTab();
    expect(result.failed.error.code).toBe("pane_unavailable");
  });
});

describe("driver steps and takeover", () => {
  const setup = () => {
    const statuses = [];
    const driver = control.createDriver({
      pane: fakePane(),
      requestOpen: vi.fn(),
      onStatus: (status) => statuses.push(status),
    });
    const contents = fakeContents();
    driver.watch(contents);
    return { driver, contents, statuses };
  };

  it("reports a step as active while it runs and idle after", async () => {
    const { driver, statuses } = setup();
    expect(driver.active()).toBe(false);
    const result = await driver.run("clicking", async () => {
      expect(driver.active()).toBe(true);
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(driver.active()).toBe(false);
    expect(statuses[0]).toMatchObject({ active: true, step: "clicking" });
    expect(statuses.at(-1)).toMatchObject({ active: false, step: null });
  });

  it("ends the step with user_took_over when the user presses a key mid-step", async () => {
    const { driver, contents } = setup();
    const result = await driver.run("typing", () => new Promise(() => {
      setTimeout(() => contents.handlers["before-input-event"]({}, { type: "keyDown" }), 0);
    }));
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("user_took_over");
    expect(result.error.hint).toBeTruthy();
  });

  it("treats a click or the wheel as the user, but not a mouse move", async () => {
    for (const [type, takes] of [["mouseDown", true], ["mouseWheel", true], ["mouseMove", false]]) {
      const { driver, contents } = setup();
      const result = await driver.run("reading", async () => {
        contents.handlers["before-mouse-event"]({}, { type });
        return { ok: true };
      });
      expect(result.ok).toBe(!takes);
    }
  });

  it("ignores the input the agent sends itself", async () => {
    const { driver, contents } = setup();
    const result = await driver.run("clicking", async () => {
      await driver.sending(async () => {
        contents.handlers["before-mouse-event"]({}, { type: "mouseDown" });
        contents.handlers["before-input-event"]({}, { type: "keyDown" });
      });
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
  });

  it("halts on Esc: the step ends and later steps are refused for a while", async () => {
    let clock = 1000;
    const driver = control.createDriver({ pane: fakePane(), requestOpen: vi.fn(), now: () => clock });
    const contents = fakeContents();
    driver.watch(contents);
    const running = driver.run("clicking", () => new Promise(() => {}));
    contents.handlers["before-input-event"]({}, { type: "keyDown", key: "Escape" });
    expect((await running).error.code).toBe("user_took_over");
    expect((await driver.run("clicking", async () => ({ ok: true }))).error.code).toBe("halted");
    clock += 31000;
    expect(await driver.run("clicking", async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("does not halt on an Esc the agent sent itself", async () => {
    const driver = control.createDriver({ pane: fakePane(), requestOpen: vi.fn() });
    const contents = fakeContents();
    driver.watch(contents);
    const result = await driver.run("pressing", () =>
      driver.sending(async () => {
        contents.handlers["before-input-event"]({}, { type: "keyDown", key: "Escape" });
        return { ok: true };
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(await driver.run("clicking", async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("ignores user input between steps", async () => {
    const { driver, contents } = setup();
    contents.handlers["before-input-event"]({}, { type: "keyDown" });
    const result = await driver.run("reading", async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it("stops on the Take over button and lets the next step start fresh", async () => {
    const { driver } = setup();
    const result = await driver.run("navigating", () => new Promise(() => {
      setTimeout(() => driver.takeOver(), 0);
    }));
    expect(result.error.code).toBe("user_took_over");

    const next = await driver.run("reading", async (step) => ({ ok: !step.stopped() }));
    expect(next).toEqual({ ok: true });
  });

  it("tells a running step it has been stopped", async () => {
    const { driver } = setup();
    let seen = null;
    await driver.run("clicking", async (step) => {
      driver.takeOver();
      seen = step.stopped();
      return { ok: true };
    });
    expect(seen).toBe(true);
  });

  it("goes idle on end", () => {
    const { driver, statuses } = setup();
    driver.end();
    expect(statuses.at(-1)).toMatchObject({ active: false });
  });
});

describe("the agent overlay", () => {
  const dom = () => new JSDOM(`<body><button>Go</button></body>`, { runScripts: "outside-only" });
  const hosts = (d) => d.window.document.querySelectorAll("[data-draggy-agent-overlay]");

  it("draws one host however often it is shown, and moves the cursor", () => {
    const d = dom();
    d.window.eval(control.overlayScript({ x: 10, y: 20 }));
    d.window.eval(control.overlayScript({ x: 30, y: 40 }));
    expect(hosts(d)).toHaveLength(1);
    const root = d.window.__draggyAgentRoot;
    const cursor = root.querySelector(".cursor");
    expect(cursor.style.transform).toContain("30px");
    expect(cursor.style.transform).toContain("40px");
    expect(root.querySelectorAll(".border")).toHaveLength(1);
  });

  it("keeps its insides closed to the page", () => {
    const d = dom();
    d.window.eval(control.overlayScript({ x: 1, y: 2 }));
    expect(hosts(d)[0].shadowRoot).toBeNull();
  });

  it("lets every click through to the page", () => {
    const d = dom();
    d.window.eval(control.overlayScript({}));
    const host = hosts(d)[0];
    expect(host.style.pointerEvents).toBe("none");
    expect(host.style.position).toBe("fixed");
  });

  it("is gone when hidden", () => {
    const d = dom();
    d.window.eval(control.overlayScript({}));
    d.window.eval(control.hideOverlayScript());
    expect(hosts(d)).toHaveLength(0);
  });
});
