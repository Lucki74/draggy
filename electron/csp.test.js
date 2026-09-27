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
      "connect-src 'self' app: draggy: draggy-ai: blob: data: http://127.0.0.1:11435 ws://127.0.0.1:5173 http://127.0.0.1:5173",
      "worker-src 'self' app: draggy: blob:",
      "object-src 'none'",
      "frame-src widget:",
      "base-uri 'self'",
      "form-action 'none'",
    ]);
  });

  it("serves the gateway on the app's own session, and nowhere else", () => {
    expect(main.match(/protocol\.handle\(\s*"draggy-ai"/g)).toHaveLength(1);
    expect(main).not.toMatch(/\.protocol\.handle\(\s*"draggy-ai"/);
    const scheme = main.slice(main.indexOf('scheme: "draggy-ai"'));
    expect(scheme.slice(0, scheme.indexOf("}"))).toMatch(/corsEnabled: true.*stream: true/s);
  });
});
