import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const widgets = require("./widgets.cjs");

/**
 * The wall around an extension's widget. The markup came from somebody else's
 * server, so what matters is the policy it is served under, the origin it is
 * served from, and the fact that nothing else on disk is reachable through it.
 */

afterEach(() => widgets.forgetAll());

describe("the policy a widget is served under", () => {
  it("forbids everything by default", () => {
    expect(widgets.WIDGET_POLICY).toContain("default-src 'none'");
  });

  it("leaves no way to reach the network", () => {
    expect(widgets.WIDGET_POLICY).not.toContain("connect-src");
    expect(widgets.WIDGET_POLICY).not.toContain("https:");
    expect(widgets.WIDGET_POLICY).not.toContain("http://localhost");
  });

  it("will not let a form or a base tag point somewhere", () => {
    expect(widgets.WIDGET_POLICY).toContain("form-action 'none'");
    expect(widgets.WIDGET_POLICY).toContain("base-uri 'none'");
  });

  it("only lets Draggy itself put a widget in a frame", () => {
    expect(widgets.WIDGET_POLICY).toContain("frame-ancestors app: draggy:");
  });

  it("goes into the document too, minus the rule a meta tag cannot carry", () => {
    const page = widgets.wrapWidget("<p>hello</p>");

    expect(page).toContain(widgets.WIDGET_BODY_POLICY);
    expect(page).not.toContain("frame-ancestors");
    expect(page).toContain("<p>hello</p>");
    expect(page).toContain("<!doctype html>");
  });
});

describe("staging a widget", () => {
  it("gives each one an origin of its own", () => {
    const first = widgets.stage("<p>one</p>");
    const second = widgets.stage("<p>two</p>");

    expect(first.url.startsWith("widget://")).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(second.url).not.toBe(first.url);
  });

  it("serves what was staged", async () => {
    const staged = widgets.stage("<p>hello</p>");
    const response = widgets.serve({ url: staged.url });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe(widgets.WIDGET_POLICY);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<p>hello</p>");
  });

  it("serves nothing for a token nobody staged", () => {
    expect(widgets.serve({ url: "widget://deadbeef/" }).status).toBe(404);
  });

  it("stops serving a widget once it is released", () => {
    const staged = widgets.stage("<p>hello</p>");

    expect(widgets.release(staged.token)).toBe(true);
    expect(widgets.serve({ url: staged.url }).status).toBe(404);
  });

  it("refuses an empty widget", () => {
    expect(widgets.stage("")).toBeNull();
    expect(widgets.stage("   ")).toBeNull();
  });

  it("refuses a widget too large to be meant seriously", () => {
    expect(widgets.stage("x".repeat(widgets.MAX_WIDGET_CHARS + 1))).toBeNull();
  });

  it("forgets the oldest rather than growing without end", () => {
    const first = widgets.stage("<p>first</p>");

    for (let index = 0; index < widgets.MAX_STAGED; index += 1) {
      widgets.stage(`<p>${index}</p>`);
    }

    expect(widgets.serve({ url: first.url }).status).toBe(404);
  });
});

describe("reading a widget address", () => {
  it("takes the token from the host", () => {
    expect(widgets.tokenFromUrl("widget://abc123/")).toBe("abc123");
  });

  it("refuses anything that is not a widget address", () => {
    expect(widgets.tokenFromUrl("app://index.html")).toBeNull();
    expect(widgets.tokenFromUrl("file:///etc/passwd")).toBeNull();
    expect(widgets.tokenFromUrl("https://example.com")).toBeNull();
    expect(widgets.tokenFromUrl("not a url")).toBeNull();
    expect(widgets.tokenFromUrl(undefined)).toBeNull();
  });

  it("has no path to walk, so a traversal reaches nothing", () => {
    const staged = widgets.stage("<p>hello</p>");

    expect(widgets.serve({ url: `${staged.url}../../secrets` }).status).toBe(200);
    expect(widgets.serve({ url: "widget://../../secrets" }).status).toBe(404);
  });
});
