// @vitest-environment jsdom
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { indexInfoScript } = require("./browserControl.cjs");
const { riskyAction, sensitiveField } = require("./browserSafety.cjs");

/** The legacy index paths have no ref table, so the page itself says what an index points at. */
const info = (index) => JSON.parse((0, eval)(indexInfoScript(index)));

beforeEach(() => {
  // jsdom has no layout, so innerText is the text content here.
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; } });
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 50, height: 20 });
  document.body.innerHTML = `
    <button>Pay now</button>
    <a href="/home">Home</a>
    <input type="password" name="pw" />
    <input type="submit" value="Save" />`;
});

describe("indexInfoScript", () => {
  it("names a risky button so the click can be confirmed", () => {
    const item = info(0);
    expect(riskyAction({ role: item.role, name: item.name, inputType: item.inputType })).toBeTruthy();
  });

  it("leaves a plain link alone", () => {
    const item = info(2);
    expect(riskyAction({ role: item.role, name: item.name })).toBeNull();
  });

  it("reports a password field as sensitive", () => {
    expect(sensitiveField(info(3).attrs)).toBe("a password field");
  });

  it("reports a submit input", () => {
    expect(info(1).inputType).toBe("submit");
  });

  it("says when the index is gone", () => {
    expect(info(9)).toEqual({ missing: true });
  });
});
