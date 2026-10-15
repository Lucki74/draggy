import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const draftModel = require("./draftModel.cjs");
const logger = require("./logger.cjs");

let dir;
let info;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-draft-log-"));
  draftModel.resetForTests();
  info = vi.spyOn(logger.log, "info");
});

afterEach(() => {
  info.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

const linesFor = (message) => info.mock.calls.filter(([, text]) => text === message);

describe("draft state changes in the log", () => {
  it("logs a draft chosen once, with the model basename and no directory", () => {
    fs.writeFileSync(path.join(dir, "a-draft.gguf"), "x");
    draftModel.findCompanionDraft(dir, "a.gguf");
    draftModel.findCompanionDraft(dir, "a.gguf");

    expect(linesFor("draft chosen")).toEqual([["engine.draft", "draft chosen", { model: "a.gguf" }]]);
    expect(JSON.stringify(info.mock.calls)).not.toContain(dir);
  });

  it("logs a refusal as marked, and no clear after it", () => {
    const draft = path.join(dir, "a-draft.gguf");
    fs.writeFileSync(draft, "x");
    draftModel.findCompanionDraft(dir, "a.gguf");
    draftModel.markRefused(draft);
    draftModel.findCompanionDraft(dir, "a.gguf");

    expect(linesFor("draft marked refused")).toEqual([["engine.draft", "draft marked refused", { model: "a.gguf" }]]);
    expect(linesFor("draft cleared")).toEqual([]);
  });

  it("logs a clear when the draft file goes away", () => {
    const draft = path.join(dir, "a-draft.gguf");
    fs.writeFileSync(draft, "x");
    draftModel.findCompanionDraft(dir, "a.gguf");
    fs.rmSync(draft);
    expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBeNull();

    expect(linesFor("draft cleared")).toEqual([["engine.draft", "draft cleared", { model: "a.gguf" }]]);
  });
});
