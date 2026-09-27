import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");

/** The app's policy as main.cjs builds it, read from the source so no Electron is needed. */
function cspDirectives() {
  const start = main.indexOf("const CSP_DIRECTIVES = [");
  const end = main.indexOf('].join("; ");', start);
  return new Function(`return ${main.slice(start + "const CSP_DIRECTIVES = ".length, end + 1)};`)();
}

describe("the app's content security policy", () => {
  it("changes only on purpose: every directive, exactly", () => {
    expect(cspDirectives()).toEqual([
      "default-src 'self' app: draggy:",
      "script-src 'self' app: draggy: 'wasm-unsafe-eval'",
      "style-src 'self' app: draggy: 'unsafe-inline'",
      "font-src 'self' app: draggy: data:",
      "img-src 'self' app: draggy: data: blob: https:",
      "media-src 'self' app: draggy: data: blob:",
      "connect-src 'self' app: draggy: draggy-ai: blob: data: ws://127.0.0.1:5173 http://127.0.0.1:5173",
      "worker-src 'self' app: draggy: blob:",
      "object-src 'none'",
      "frame-src widget:",
      "base-uri 'self'",
      "form-action 'none'",
    ]);
  });

  it("gives the renderer no road to the engine but the gateway", () => {
    const connect = cspDirectives().find((directive) => directive.startsWith("connect-src ")) ?? "";
    const loopback = connect.split(" ").filter((source) => /127\.0\.0\.1|localhost/.test(source));
    expect(loopback).toEqual(["ws://127.0.0.1:5173", "http://127.0.0.1:5173"]);
    expect(connect).toContain("draggy-ai:");
  });

  it("keeps extension widgets, the one other page on that session, from fetching anything", () => {
    const widgets = fs.readFileSync(path.join(HERE, "widgets.cjs"), "utf8");
    const start = widgets.indexOf('"default-src') + 1;
    const policy = widgets.slice(start, widgets.indexOf(";", start));
    expect(policy).toBe("default-src 'none'");
    expect(widgets).not.toMatch(/connect-src/);
    expect(widgets).not.toContain("draggy-ai");
  });

  it("serves the gateway on the app's own session, and nowhere else", () => {
    expect(main.match(/protocol\.handle\(\s*"draggy-ai"/g)).toHaveLength(1);
    expect(main).not.toMatch(/\.protocol\.handle\(\s*"draggy-ai"/);
    const scheme = main.slice(main.indexOf('scheme: "draggy-ai"'));
    expect(scheme.slice(0, scheme.indexOf("}"))).toMatch(/corsEnabled: true.*stream: true/s);
  });
});
