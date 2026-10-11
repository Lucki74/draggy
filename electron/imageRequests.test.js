import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { validateImageRequest, outputName, slugFor, parseLora } = require("./imageRequests.cjs");

const valid = (extra = {}) => ({ requestId: "r1", prompt: "a lighthouse at dusk", ...extra });

describe("what the renderer may ask for", () => {
  it("accepts a plain prompt and saves it to the output folder", () => {
    const checked = validateImageRequest(valid());
    expect(checked.ok).toBe(true);
    expect(checked.request.destination).toEqual({ kind: "chat" });
  });

  it("refuses an empty or oversized prompt and a missing id", () => {
    expect(validateImageRequest(valid({ prompt: " " })).ok).toBe(false);
    expect(validateImageRequest(valid({ prompt: "x".repeat(4001) })).ok).toBe(false);
    expect(validateImageRequest(valid({ requestId: "../x" })).ok).toBe(false);
  });

  it("keeps numbers inside their ranges", () => {
    const { request } = validateImageRequest(valid({ width: 99999, height: -4, steps: 9999, cfgScale: 99, strength: 5 }));
    expect([request.width, request.height, request.steps, request.cfgScale, request.strength]).toEqual([2048, 64, 150, 30, 1]);
  });

  it("fits the size to the model only when the tool asked, never on a typed /image", () => {
    expect(validateImageRequest(valid({ width: 1024, fitModel: true })).request.fitModel).toBe(true);
    expect(validateImageRequest(valid({ width: 1024 })).request.fitModel).toBe(false);
  });

  it("only saves into a project as png, jpg or webp", () => {
    expect(validateImageRequest(valid({ destination: { kind: "project", path: "public/favicon.png" } })).ok).toBe(true);
    expect(validateImageRequest(valid({ destination: { kind: "project", path: "run.exe" } })).ok).toBe(false);
    expect(validateImageRequest(valid({ destination: { kind: "project", path: "notes.svg" } })).ok).toBe(false);
  });

  it("takes an attached picture as the starting image, and nothing else", () => {
    expect(validateImageRequest(valid({ init: { kind: "attachment", dataUrl: "data:image/png;base64,AAAA" } })).ok).toBe(true);
    expect(validateImageRequest(valid({ init: { kind: "attachment", dataUrl: "file:///etc/passwd" } })).ok).toBe(false);
    expect(validateImageRequest(valid({ init: { kind: "absolute", path: "C:/x.png" } })).ok).toBe(false);
  });

  it("accepts LoRA names and refuses anything shaped like a path", () => {
    expect(validateImageRequest(valid({ lora: ["watercolor:0.7"] })).request.lora).toEqual([{ name: "watercolor", multiplier: 0.7 }]);
    expect(validateImageRequest(valid({ lora: ["../../evil"] })).ok).toBe(false);
    expect(validateImageRequest(valid({ lora: ["a/b"] })).ok).toBe(false);
    expect(parseLora("style")).toEqual({ name: "style", multiplier: 1 });
  });
});

describe("naming a generated image", () => {
  it("makes a short file name from the prompt", () => {
    expect(slugFor("A Lighthouse, at DUSK!")).toBe("a-lighthouse-at-dusk");
    expect(slugFor("日本の夜景")).toBe("image");
    expect(slugFor("word ".repeat(40)).length).toBeLessThanOrEqual(40);
  });

  it("never overwrites an image already in the folder", () => {
    const date = new Date(2026, 8, 22, 21, 5, 9);
    const taken = new Set(["2026-09-22-210509-cat.png"]);
    expect(outputName("cat", (name) => taken.has(name), date)).toBe("2026-09-22-210509-cat-2.png");
  });
});
