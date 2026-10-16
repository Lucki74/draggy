import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const snap = require("./browserSnapshot.cjs");

const ax = (nodeId, role, name, extra = {}) => ({
  nodeId: String(nodeId),
  ignored: false,
  role: { value: role },
  name: { value: name },
  backendDOMNodeId: Number(nodeId) + 100,
  childIds: [],
  ...extra,
});

/** A page of two frames. `box(backendId)` says where each node sits. */
function fakePage({ main, frame = [], box = () => ({ x: 10, y: 10, width: 100, height: 20 }), gone = new Set(), failFrame = false, dpr = 1 } = {}) {
  const calls = [];
  const page = { dpr };
  const send = async (method, params = {}) => {
    calls.push([method, params]);
    switch (method) {
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: { id: "main", url: "https://shop.test/" },
            childFrames: frame.length || failFrame ? [{ frame: { id: "kid", url: "https://pay.test/embed" } }] : [],
          },
        };
      case "Accessibility.getFullAXTree":
        if (params.frameId === "kid") {
          if (failFrame) throw new Error("no such frame");
          return { nodes: frame };
        }
        return { nodes: main };
      case "Page.getLayoutMetrics":
        return {
          cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
          cssContentSize: { width: 800, height: 2400 },
        };
      case "DOM.getBoxModel": {
        if (gone.has(params.backendNodeId)) throw new Error("no node");
        const b = box(params.backendNodeId);
        if (!b) throw new Error("no box");
        const { x, y, width: w, height: h } = b;
        return { model: { content: [x, y, x + w, y, x + w, y + h, x, y + h] } };
      }
      case "DOM.describeNode":
        if (gone.has(params.backendNodeId)) throw new Error("no node");
        return { node: {} };
      case "DOM.scrollIntoViewIfNeeded":
        return {};
      case "Page.captureScreenshot":
        return { data: "JPEGDATA" };
      case "Runtime.evaluate":
        return { result: { value: page.dpr || 1 } };
      case "DOM.resolveNode":
        return { object: { objectId: "obj1" } };
      case "Runtime.callFunctionOn":
        return { result: { value: "Cart total 12" } };
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return { send, calls };
}

describe("snapshot", () => {
  const main = [
    ax(1, "RootWebArea", "Shop"),
    ax(2, "heading", "Basket", { properties: [{ name: "level", value: { value: 2 } }] }),
    ax(3, "button", "Add to cart"),
    ax(4, "button", "Add to cart"),
    ax(5, "link", "Terms", { properties: [{ name: "url", value: { value: "https://legal.test/terms?id=9" } }] }),
    ax(6, "checkbox", "Gift", { properties: [{ name: "checked", value: { value: true } }] }),
    ax(7, "textbox", "Email", { value: { value: "a@b.c" } }),
    ax(8, "generic", "wrapper"),
    { ...ax(9, "button", "Hidden"), ignored: true },
  ];

  it("lists controls with refs and keeps two identical buttons apart", async () => {
    const page = fakePage({ main });
    const result = await snap.createObserver(page).snapshot();
    const buttons = result.items.filter((i) => i.name === "Add to cart");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].ref).not.toBe(buttons[1].ref);
    expect(result.items.map((i) => i.role)).toEqual(["heading", "button", "button", "link", "checkbox", "textbox"]);
  });

  it("reports states, values and only the host of a link", async () => {
    const result = await snap.createObserver(fakePage({ main })).snapshot();
    const text = snap.formatSnapshot({ ...result, title: "Shop", url: "https://shop.test/" });
    expect(text).toContain('checkbox "Gift" (checked)');
    expect(text).toContain('textbox "Email" value="a@b.c"');
    expect(text).toContain("link \"Terms\" -> legal.test");
    expect(text).not.toContain("terms?id=9");
    expect(text).toContain('heading L2 "Basket"');
  });

  it("marks what is below the fold and what has no box", async () => {
    const box = (id) => (id === 103 ? { x: 0, y: 900, width: 50, height: 20 } : id === 104 ? null : { x: 5, y: 5, width: 50, height: 20 });
    const result = await snap.createObserver(fakePage({ main, box })).snapshot();
    const states = result.items.filter((i) => i.name === "Add to cart").map((i) => i.visibility);
    expect(states).toEqual(["offscreen", "hidden"]);
  });

  it("caps the list and says how many were left out", async () => {
    const result = await snap.createObserver(fakePage({ main })).snapshot({ maxItems: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.omitted).toBe(4);
    expect(snap.formatSnapshot({ ...result, title: "t", url: "u" })).toContain("4 more not shown");
  });

  it("reads same-process iframes and labels them", async () => {
    const frame = [ax(11, "RootWebArea", "Pay"), ax(12, "button", "Pay now")];
    const result = await snap.createObserver(fakePage({ main, frame })).snapshot();
    const pay = result.items.find((i) => i.name === "Pay now");
    expect(pay.frame).toBe("pay.test");
    expect(snap.formatSnapshot({ ...result, title: "t", url: "u" })).toContain("-- frame pay.test --");
  });

  it("counts a frame it could not read instead of failing", async () => {
    const result = await snap.createObserver(fakePage({ main, failFrame: true })).snapshot();
    expect(result.skippedFrames).toBe(1);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("limits a scoped snapshot to the subtree of a ref", async () => {
    const tree = [
      ax(1, "RootWebArea", "Shop", { childIds: ["2", "5"] }),
      ax(2, "generic", "form", { childIds: ["3", "4"] }),
      ax(3, "textbox", "Name"),
      ax(4, "button", "Save"),
      ax(5, "button", "Elsewhere"),
    ];
    const observer = snap.createObserver(fakePage({ main: tree }));
    const all = await observer.snapshot();
    expect(all.items.map((i) => i.name)).toContain("Name");
    // The generic wrapper is not listed, so a dialog stands in as the scope.
    const tree2 = [
      ax(1, "RootWebArea", "Shop", { childIds: ["2", "5"] }),
      ax(2, "dialog", "Sign in", { childIds: ["3", "4"] }),
      ax(3, "textbox", "Name"),
      ax(4, "button", "Save"),
      ax(5, "button", "Elsewhere"),
    ];
    const o2 = snap.createObserver(fakePage({ main: tree2 }));
    const first = await o2.snapshot();
    const dialog = first.items.find((i) => i.role === "dialog");
    const scoped = await o2.snapshot({ scope: dialog.ref });
    expect(scoped.items.map((i) => i.name)).toEqual(["Sign in", "Name", "Save"]);
  });
});

describe("refs", () => {
  const main = [ax(1, "RootWebArea", "Shop"), ax(3, "button", "Buy")];

  it("point at the node that was listed, even after another snapshot adds more", async () => {
    const observer = snap.createObserver(fakePage({ main }));
    const first = await observer.snapshot();
    const ref = first.items[0].ref;
    const pt = await observer.pointOf(ref);
    expect(pt).toMatchObject({ x: 60, y: 20 });
  });

  it("go stale when a newer snapshot replaced them", async () => {
    const observer = snap.createObserver(fakePage({ main }));
    const first = await observer.snapshot();
    await observer.snapshot();
    await expect(observer.resolve(first.items[0].ref)).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("go stale when the node left the page", async () => {
    const gone = new Set();
    const observer = snap.createObserver(fakePage({ main, gone }));
    const first = await observer.snapshot();
    gone.add(103);
    await expect(observer.pointOf(first.items[0].ref)).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("go stale after a navigation", async () => {
    const observer = snap.createObserver(fakePage({ main }));
    const first = await observer.snapshot();
    observer.forget();
    await expect(observer.resolve(first.items[0].ref)).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("scroll the node into view before measuring it", async () => {
    const page = fakePage({ main });
    const observer = snap.createObserver(page);
    const first = await observer.snapshot();
    page.calls.length = 0;
    await observer.pointOf(first.items[0].ref);
    const order = page.calls.map(([m]) => m);
    expect(order.indexOf("DOM.scrollIntoViewIfNeeded")).toBeGreaterThan(-1);
    expect(order.indexOf("DOM.scrollIntoViewIfNeeded")).toBeLessThan(order.lastIndexOf("DOM.getBoxModel"));
  });

  it("read the text of one element", async () => {
    const observer = snap.createObserver(fakePage({ main }));
    const first = await observer.snapshot();
    expect(await observer.textOf(first.items[0].ref)).toBe("Cart total 12");
  });
});

describe("screenshot", () => {
  const main = [ax(1, "RootWebArea", "Shop"), ax(3, "button", "Buy")];

  it("captures the viewport as a bounded jpeg", async () => {
    const page = fakePage({ main });
    const shot = await snap.createObserver(page).screenshot();
    const call = page.calls.find(([m]) => m === "Page.captureScreenshot")[1];
    expect(call.format).toBe("jpeg");
    expect(call.clip).toMatchObject({ width: 800, height: 600, scale: 1 });
    expect(shot.data).toBe("JPEGDATA");
  });

  it("scales a wide page down and caps a very tall one", async () => {
    const send = async (method, params) => {
      if (method === "Page.getLayoutMetrics") {
        return { cssVisualViewport: { clientWidth: 2560, clientHeight: 600, pageX: 0, pageY: 0 }, cssContentSize: { width: 2560, height: 30000 } };
      }
      return fakePage({ main }).send(method, params);
    };
    const full = await snap.createObserver({ send }).screenshot({ mode: "full" });
    expect(full.width).toBe(1280);
    expect(full.height).toBeLessThanOrEqual(2000);
  });

  it("asks for one pixel per css pixel on a high-density screen", async () => {
    const page = fakePage({ main, dpr: 2 });
    const shot = await snap.createObserver(page).screenshot();
    const call = page.calls.find(([m]) => m === "Page.captureScreenshot")[1];
    expect(call.clip.scale).toBe(0.5);
    expect(shot.width).toBe(800);
  });

  it("clips to an element with a margin", async () => {
    const page = fakePage({ main });
    const observer = snap.createObserver(page);
    const first = await observer.snapshot();
    await observer.screenshot({ mode: "element", ref: first.items[0].ref });
    const call = page.calls.filter(([m]) => m === "Page.captureScreenshot").pop()[1];
    expect(call.clip.width).toBe(116);
    expect(call.captureBeyondViewport).toBe(true);
  });

  it("will not clip to a ref that is stale", async () => {
    const observer = snap.createObserver(fakePage({ main }));
    await expect(observer.screenshot({ mode: "element", ref: "e999" })).rejects.toMatchObject({ code: "stale_ref" });
  });
});

describe("marks", () => {
  it("draws one labelled box per mark in a closed shadow root and can be removed", () => {
    const dom = new JSDOM("<!doctype html><body><p>hi</p></body>", { runScripts: "outside-only" });
    dom.window.eval(snap.marksScript([{ ref: "e1", x: 1, y: 2, width: 30, height: 10 }]));
    const host = dom.window.document.querySelector("[data-draggy-marks]");
    expect(host).not.toBeNull();
    expect(host.shadowRoot).toBeNull();
    dom.window.eval(snap.hideMarksScript());
    expect(dom.window.document.querySelector("[data-draggy-marks]")).toBeNull();
  });
});
