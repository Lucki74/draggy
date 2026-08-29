import { describe, expect, it } from "vitest";
import { createFileProgressTracker } from "../utils";

describe("tracking a multi-file download", () => {
  it("reports a simple single-file download plainly", () => {
    const track = createFileProgressTracker();

    track({ file: "model.onnx", loaded: 0, total: 1000 });
    const percent = track({ file: "model.onnx", loaded: 250, total: 1000 });

    expect(percent).toBeCloseTo(25);
  });

  it("does not fall back to zero when a second file starts", () => {
    const track = createFileProgressTracker();

    // A small tokenizer file finishes first.
    track({ file: "tokenizer.json", loaded: 0, total: 100 });
    track({ file: "tokenizer.json", loaded: 100, total: 100 });

    // The real weights file then starts from nothing. Per-file arithmetic
    // would report 0% of a download that is already partly done.
    const percent = track({ file: "model.onnx", loaded: 0, total: 900 });

    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeCloseTo(10); // 100 of (100 + 900) bytes
  });

  it("measures the whole job as later files land", () => {
    const track = createFileProgressTracker();

    track({ file: "tokenizer.json", loaded: 100, total: 100 });
    track({ file: "model.onnx", loaded: 0, total: 900 });
    const percent = track({ file: "model.onnx", loaded: 900, total: 900 });

    expect(percent).toBeCloseTo(100);
  });

  it("counts a file once, however many times it is reported", () => {
    const track = createFileProgressTracker();

    track({ file: "model.onnx", loaded: 100, total: 1000 });
    track({ file: "model.onnx", loaded: 500, total: 1000 });
    const percent = track({ file: "model.onnx", loaded: 900, total: 1000 });

    expect(percent).toBeCloseTo(90);
  });

  it("never lets the figure run backwards while the job stays the same size", () => {
    const track = createFileProgressTracker();

    track({ file: "model.onnx", loaded: 800, total: 1000 });
    // An out-of-order or repeated event reporting less progress than before.
    const percent = track({ file: "model.onnx", loaded: 100, total: 1000 });

    expect(percent).toBeCloseTo(80);
  });

  it("ignores an event with no size to measure", () => {
    const track = createFileProgressTracker();

    track({ file: "model.onnx", loaded: 400, total: 1000 });
    const percent = track({ file: "model.onnx", loaded: 0, total: 0 });

    expect(percent).toBeCloseTo(40);
    expect(Number.isNaN(percent)).toBe(false);
  });

  it("starts at zero and never goes negative", () => {
    const track = createFileProgressTracker();

    expect(track({ file: "", loaded: 0, total: 0 })).toBe(0);
  });
});
