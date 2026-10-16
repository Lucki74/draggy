import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const { log } = require("./logger.cjs");

/** Electron is not running under vitest, so the one module that asks for BrowserWindow gets a stand-in. */
const printed = {
  loadError: null,
  printError: null,
  pdf: Buffer.from("%PDF-1.4 /Type /Page /Type /Page /Type /Pages"),
};

class FakeWindow {
  constructor() {
    this.webContents = {
      printToPDF: async () => {
        if (printed.printError) throw printed.printError;
        return printed.pdf;
      },
    };
  }

  async loadFile() {
    if (printed.loadError) throw printed.loadError;
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

let pdfWriter;
let originalLoad;
let workdir;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-pdf-log-"));
  originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    return request === "electron" ? { BrowserWindow: FakeWindow } : originalLoad.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("./pdfWriter.cjs")];
  pdfWriter = require("./pdfWriter.cjs");
});

afterAll(() => {
  Module._load = originalLoad;
  delete require.cache[require.resolve("./pdfWriter.cjs")];
  fs.rmSync(workdir, { recursive: true, force: true });
});

/** Records what each log.time timer was ended or failed with; the logger itself still runs. */
function captureTimers() {
  const timers = [];
  const realTime = log.time;
  vi.spyOn(log, "time").mockImplementation((scope, label, data, options) => {
    const timer = realTime(scope, label, data, options);
    const record = { label, data, end: undefined, fail: undefined };
    timers.push(record);
    return {
      end(extra) {
        record.end = extra ?? {};
        return timer.end(extra);
      },
      fail(error, extra) {
        record.fail = extra ?? {};
        return timer.fail(error, extra);
      },
    };
  });
  return timers;
}

describe("what the log says about a pdf", () => {
  let timers;

  beforeEach(() => {
    printed.loadError = null;
    printed.printError = null;
    timers = captureTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the format, page count, bytes and duration of a written pdf", async () => {
    await pdfWriter.writePdf(path.join(workdir, "log.pdf"), "# Hello");

    expect(timers[0].label).toBe("write pdf");
    expect(timers[0].data).toMatchObject({ format: "pdf" });
    expect(timers[0].end).toEqual({ bytes: printed.pdf.length, pages: 2 });
  });

  it("names the layout step when the document will not lay out", async () => {
    printed.loadError = new Error("layout broke");

    await expect(pdfWriter.writePdf(path.join(workdir, "layout.pdf"), "x")).rejects.toThrow("layout broke");
    expect(timers[0].fail).toEqual({ step: "layout" });
  });

  it("names the print step when Chromium will not print it", async () => {
    printed.printError = new Error("print broke");

    await expect(pdfWriter.writePdf(path.join(workdir, "print.pdf"), "x")).rejects.toThrow("print broke");
    expect(timers[0].fail).toEqual({ step: "print" });
  });

  it("names the save step when the file cannot be written", async () => {
    await expect(pdfWriter.writePdf(path.join(workdir, "no-such-dir", "save.pdf"), "x")).rejects.toThrow();
    expect(timers[0].fail).toEqual({ step: "save" });
  });
});
