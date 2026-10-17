import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const input = require("./browserInput.cjs");

const ENTRY = { backendNodeId: 103, frameId: "main", role: "textbox" };

/** A page that records every command. `onCall(declaration)` answers `Runtime.callFunctionOn`. */
function fakeRig({ onCall = () => true, hit = 103, viewport = [800, 600], evaluate = () => 0 } = {}) {
  const calls = [];
  const events = [];
  const send = async (method, params = {}) => {
    calls.push([method, params]);
    switch (method) {
      case "DOM.resolveNode":
        return { object: { objectId: `obj${params.backendNodeId}` } };
      case "Runtime.callFunctionOn": {
        const value = onCall(params.functionDeclaration, params);
        return { result: { value } };
      }
      case "DOM.getNodeForLocation":
        return { backendNodeId: hit };
      case "DOM.describeNode":
        return { node: { nodeName: "DIV", attributes: ["id", "cookie-banner"] } };
      case "Runtime.evaluate": {
        if (params.expression.includes("innerWidth")) return { result: { value: viewport } };
        return { result: { value: evaluate(params.expression) } };
      }
      default:
        return {};
    }
  };
  const observer = {
    resolve: async () => ENTRY,
    pointOf: async (ref) => (ref === "e9" ? { x: 300, y: 200 } : { x: 60, y: 20 }),
    shotPoint: (x, y) => ({ x: x / 2, y: y / 2 }),
  };
  const contents = { sendInputEvent: (e) => events.push(e) };
  const api = input.createInput({ send, observer, contents, pause: async () => {} });
  return { api, calls, events };
}

describe("parseKey", () => {
  it("maps names and chords", () => {
    expect(input.parseKey("Enter")).toMatchObject({ keyCode: "Return", modifiers: [] });
    expect(input.parseKey("Control+A")).toMatchObject({ keyCode: "A", modifiers: ["control"] });
    expect(input.parseKey("Meta+Shift+Enter")).toMatchObject({ keyCode: "Return", modifiers: ["meta", "shift"] });
    expect(input.parseKey("ArrowDown").keyCode).toBe("Down");
    expect(input.parseKey("F5").keyCode).toBe("F5");
  });

  it("rejects a key it does not know", () => {
    expect(() => input.parseKey("Banana")).toThrowError(/key/i);
    expect(() => input.parseKey("Hyper+A")).toThrowError(/key/i);
  });
});

describe("pressKey", () => {
  it("sends down, char and up for a letter", async () => {
    const { api, events } = fakeRig();
    await api.pressKey("a");
    expect(events.map((e) => e.type)).toEqual(["keyDown", "char", "keyUp"]);
  });

  it("sends no char for a chord and carries the modifiers", async () => {
    const { api, events } = fakeRig();
    await api.pressKey("Control+A");
    expect(events.map((e) => e.type)).toEqual(["keyDown", "keyUp"]);
    expect(events[0].modifiers).toEqual(["control"]);
  });

  it("repeats, with a cap", async () => {
    const { api, events } = fakeRig();
    await api.pressKey("Tab", 3);
    expect(events.filter((e) => e.type === "keyDown")).toHaveLength(3);
    events.length = 0;
    await api.pressKey("Tab", 500);
    expect(events.filter((e) => e.type === "keyDown").length).toBeLessThanOrEqual(20);
  });
});

describe("typeInto", () => {
  it("focuses, inserts the text in one go and reads the field back", async () => {
    const rig = fakeRig({ onCall: (d) => (d.includes("readOnly") ? true : { value: "hello" }) });
    const result = await rig.api.typeInto("e1", "hello");
    const methods = rig.calls.map(([m]) => m);
    expect(methods).toContain("DOM.focus");
    expect(rig.calls.find(([m]) => m === "Input.insertText")[1]).toEqual({ text: "hello" });
    expect(result).toMatchObject({ value: "hello", landed: true });
  });

  it("never assigns the value itself", async () => {
    const rig = fakeRig({ onCall: () => ({ value: "x" }) });
    await rig.api.typeInto("e1", "x");
    const sent = rig.calls.filter(([m]) => m === "Runtime.callFunctionOn").map(([, p]) => p.functionDeclaration);
    for (const decl of sent) expect(decl).not.toMatch(/\.value\s*=[^=]/);
  });

  it("clears first when asked: select, then backspace", async () => {
    const rig = fakeRig({ onCall: () => ({ value: "new" }) });
    await rig.api.typeInto("e1", "new", { clear: true });
    const order = rig.calls.map(([m]) => m);
    expect(rig.events.some((e) => e.type === "keyDown" && e.keyCode === "Backspace")).toBe(true);
    expect(order.indexOf("Input.insertText")).toBeGreaterThan(-1);
  });

  it("types one character at a time when slowly", async () => {
    const rig = fakeRig({ onCall: () => ({ value: "abc" }) });
    await rig.api.typeInto("e1", "abc", { slowly: true });
    expect(rig.calls.filter(([m]) => m === "Input.insertText").map(([, p]) => p.text)).toEqual(["a", "b", "c"]);
  });

  it("presses Enter when asked to submit", async () => {
    const rig = fakeRig({ onCall: () => ({ value: "q" }) });
    await rig.api.typeInto("e1", "q", { submit: true });
    expect(rig.events.some((e) => e.type === "keyDown" && e.keyCode === "Return")).toBe(true);
  });

  it("says when the text did not land", async () => {
    const rig = fakeRig({ onCall: () => ({ value: "" }) });
    expect(await rig.api.typeInto("e1", "hello")).toMatchObject({ landed: false });
  });

  it("does not echo a password back", async () => {
    const rig = fakeRig({ onCall: () => ({ hidden: true }) });
    const result = await rig.api.typeInto("e1", "s3cret");
    expect(result.value).toBe("(hidden)");
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("refuses a field that cannot be edited", async () => {
    const rig = fakeRig({ onCall: (d) => (d.includes("readOnly") ? false : {}) });
    await expect(rig.api.typeInto("e1", "x")).rejects.toMatchObject({ code: "not_editable" });
  });
});

describe("click", () => {
  it("sends one press and release per count, with the button and modifiers", async () => {
    const { api, events } = fakeRig();
    await api.clickAt(10, 20, { button: "right", count: 2, modifiers: ["ctrl", "shift"] });
    const downs = events.filter((e) => e.type === "mouseDown");
    expect(downs).toHaveLength(2);
    expect(downs[1]).toMatchObject({ button: "right", clickCount: 2, modifiers: ["control", "shift"] });
    expect(events.filter((e) => e.type === "mouseUp")).toHaveLength(2);
  });

  it("rejects a button or modifier it does not know", async () => {
    const { api } = fakeRig();
    await expect(api.clickAt(1, 1, { button: "side" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.clickAt(1, 1, { modifiers: ["hyper"] })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("names the element that would take the click instead", async () => {
    const rig = fakeRig({ hit: 777, onCall: () => false });
    expect(await rig.api.blockedBy("e1", 60, 20)).toContain("cookie-banner");
  });

  it("lets a click through when the target or a child is hit", async () => {
    const rig = fakeRig({ hit: 777, onCall: () => true });
    expect(await rig.api.blockedBy("e1", 60, 20)).toBeNull();
  });
});

describe("coordinates", () => {
  it("converts screenshot pixels to page pixels", async () => {
    const { api } = fakeRig();
    expect(await api.where({ x: 100, y: 40 })).toMatchObject({ x: 50, y: 20 });
  });

  it("resolves a ref through the observer", async () => {
    const { api } = fakeRig();
    expect(await api.where("e9")).toMatchObject({ x: 300, y: 200 });
  });

  it("rejects a target that is neither", async () => {
    const { api } = fakeRig();
    await expect(api.where(undefined)).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("hover, drag, scroll", () => {
  it("hover is a single move", async () => {
    const { api, events } = fakeRig();
    await api.hover("e9");
    expect(events).toEqual([{ type: "mouseMove", x: 300, y: 200 }]);
  });

  it("drag presses at the start, moves in steps and releases at the end", async () => {
    const { api, events } = fakeRig();
    await api.drag("e1", "e9");
    expect(events[0]).toMatchObject({ type: "mouseMove", x: 60, y: 20 });
    expect(events.find((e) => e.type === "mouseDown")).toMatchObject({ x: 60, y: 20 });
    expect(events.filter((e) => e.type === "mouseMove").length).toBeGreaterThan(3);
    expect(events.at(-1)).toMatchObject({ type: "mouseUp", x: 300, y: 200 });
  });

  it("scrolls by wheel in the page's own direction", async () => {
    const rig = fakeRig({ evaluate: () => ({ y: 400, max: 2000 }) });
    const result = await rig.api.scroll({ dy: 400 });
    const wheel = rig.calls.find(([m, p]) => m === "Input.dispatchMouseEvent" && p.type === "mouseWheel")[1];
    expect(wheel).toMatchObject({ deltaY: 400, deltaX: 0, x: 400, y: 300 });
    expect(result).toMatchObject({ y: 400, max: 2000 });
  });

  it("jumps to the top or bottom", async () => {
    const rig = fakeRig({ evaluate: () => ({ y: 2000, max: 2000 }) });
    await rig.api.scroll({ to: "bottom" });
    const expr = rig.calls.filter(([m]) => m === "Runtime.evaluate").map(([, p]) => p.expression).join("\n");
    expect(expr).toContain("scrollTo");
  });

  it("brings a ref into view", async () => {
    const rig = fakeRig({ evaluate: () => ({ y: 0, max: 10 }) });
    await rig.api.scroll({ ref: "e9" });
    expect(rig.events).toEqual([]);
  });
});

describe("selectOption", () => {
  it("reports the option that is now chosen", async () => {
    const rig = fakeRig({ onCall: () => ({ chosen: "Large", value: "l" }) });
    expect(await rig.api.selectOption("e1", { label: "Large" })).toMatchObject({ chosen: "Large" });
  });

  it("says when there is no such option", async () => {
    const rig = fakeRig({ onCall: () => ({ missing: true, options: ["S", "M"] }) });
    await expect(rig.api.selectOption("e1", { label: "XL" })).rejects.toMatchObject({ code: "element_not_found" });
  });
});

describe("wait", () => {
  it("returns as soon as the text shows up", async () => {
    let polls = 0;
    const rig = fakeRig({ evaluate: () => (++polls >= 3 ? true : false) });
    expect(await rig.api.wait({ text: "Done" })).toMatchObject({ waited: true });
    expect(polls).toBe(3);
  });

  it("gives up at the timeout", async () => {
    const rig = fakeRig({ evaluate: () => false });
    await expect(rig.api.wait({ text: "Never", timeoutMs: 600 })).rejects.toMatchObject({ code: "wait_timeout" });
  });

  it("caps a plain pause", async () => {
    const rig = fakeRig();
    const result = await rig.api.wait({ ms: 999999 });
    expect(result.ms).toBeLessThanOrEqual(10000);
  });

  it("needs something to wait for", async () => {
    const rig = fakeRig();
    await expect(rig.api.wait({})).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("what changed", () => {
  const sig = (over = {}) => ({ url: "https://a.test/", title: "A", nodes: 100, text: 500, ...over });

  it("says when nothing changed", () => {
    expect(input.summarizeChange(sig(), sig())).toMatch(/nothing/i);
  });

  it("says when the page moved on", () => {
    expect(input.summarizeChange(sig(), sig({ url: "https://a.test/b" }))).toContain("https://a.test/b");
  });

  it("says when the page changed in place", () => {
    expect(input.summarizeChange(sig(), sig({ nodes: 140 }))).toMatch(/changed/i);
  });
});
