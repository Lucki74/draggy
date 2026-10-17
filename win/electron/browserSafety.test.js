import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const safety = require("./browserSafety.cjs");

describe("origins", () => {
  it("reduces an address to its origin and host", () => {
    expect(safety.originOf("https://shop.example.com:8443/cart?id=7")).toBe("https://shop.example.com:8443");
    expect(safety.hostOf("https://shop.example.com/cart?id=7")).toBe("shop.example.com");
  });

  it("has none for what is not a web address", () => {
    expect(safety.originOf("about:blank")).toBeNull();
    expect(safety.originOf("nonsense")).toBeNull();
    expect(safety.hostOf("")).toBe("");
  });
});

describe("risky actions", () => {
  it.each([
    ["button", "Pay now"],
    ["button", "Buy"],
    ["link", "Delete account"],
    ["button", "Send message"],
    ["button", "Post"],
    ["button", "Payer maintenant"],
    ["button", "Eliminar"],
    ["button", "Enviar"],
    ["button", "立即支付"],
    ["button", "删除"],
  ])("flags %s %s", (role, name) => {
    expect(safety.riskyAction({ role, name })).toBeTruthy();
  });

  it("flags a submit button whatever it says", () => {
    expect(safety.riskyAction({ role: "button", name: "Go", inputType: "submit" })).toBeTruthy();
  });

  it("leaves ordinary controls alone", () => {
    expect(safety.riskyAction({ role: "link", name: "Pricing" })).toBeNull();
    expect(safety.riskyAction({ role: "button", name: "Next page" })).toBeNull();
    expect(safety.riskyAction({ role: "textbox", name: "Send to" })).toBeNull();
    expect(safety.riskyAction({})).toBeNull();
  });
});

describe("sensitive fields", () => {
  it.each([
    [{ type: "password" }],
    [{ autocomplete: "cc-number" }],
    [{ autocomplete: "one-time-code" }],
    [{ name: "card_number" }],
    [{ id: "cvv" }],
    [{ placeholder: "Enter your API key" }],
    [{ name: "ssn" }],
    [{ label: "Security token" }],
  ])("refuses %j", (attrs) => {
    expect(safety.sensitiveField(attrs)).toBeTruthy();
  });

  it("accepts an ordinary field", () => {
    expect(safety.sensitiveField({ type: "text", name: "q", placeholder: "Search" })).toBeNull();
    expect(safety.sensitiveField({ name: "discard" })).toBeNull();
    expect(safety.sensitiveField(null)).toBeNull();
    expect(safety.sensitiveField(true)).toBeNull();
  });
});

describe("site grants", () => {
  it("starts unknown, then follows what the user said", () => {
    const grants = safety.createGrants({ trusted: [] });
    expect(grants.status("https://a.test")).toBe("unknown");
    grants.allowSession("https://a.test");
    expect(grants.status("https://a.test")).toBe("session");
    grants.trust("https://a.test");
    expect(grants.status("https://a.test")).toBe("trusted");
    grants.revoke("https://a.test");
    expect(grants.status("https://a.test")).toBe("unknown");
  });

  it("starts from the trusted sites it was given and reports changes", () => {
    const seen = [];
    const grants = safety.createGrants({ trusted: ["https://b.test"], onChange: (list) => seen.push(list) });
    expect(grants.status("https://b.test")).toBe("trusted");
    grants.trust("https://c.test");
    expect(seen.at(-1)).toEqual(["https://b.test", "https://c.test"]);
    expect(grants.list()).toEqual(["https://b.test", "https://c.test"]);
  });

  it("keeps a session grant out of the saved list", () => {
    const seen = [];
    const grants = safety.createGrants({ trusted: [], onChange: (list) => seen.push(list) });
    grants.allowSession("https://a.test");
    expect(seen).toEqual([]);
    expect(grants.list()).toEqual([]);
  });
});

describe("rate limit", () => {
  it("allows a burst up to the cap, then waits for the window", () => {
    let now = 0;
    const limit = safety.createRateLimit({ max: 3, windowMs: 1000, now: () => now });
    expect([limit.take(), limit.take(), limit.take(), limit.take()]).toEqual([true, true, true, false]);
    now = 1001;
    expect(limit.take()).toBe(true);
  });
});
