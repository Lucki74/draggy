import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { DOCUMENT_HEADERS, RESOURCE_HEADERS } = require("./isolation.cjs");
const { modelFileHeaders } = require("./modelCache.cjs");

describe("cross-origin isolation", () => {
  it("opens the document isolated without blocking remote images", () => {
    expect(DOCUMENT_HEADERS).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    });
  });

  it("marks model files as loadable from the app's page", () => {
    expect(modelFileHeaders("m/a.onnx", 10)).toMatchObject(RESOURCE_HEADERS);
  });

  it("is applied to the renderer and widget responses, and leaves the CSP alone", () => {
    const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");
    const widgets = fs.readFileSync(path.join(HERE, "widgets.cjs"), "utf8");
    expect(main).toContain("...DOCUMENT_HEADERS");
    expect(widgets).toContain("...RESOURCE_HEADERS");
    expect(main).not.toMatch(/Cross-Origin-Embedder-Policy.*require-corp/);
  });
});
