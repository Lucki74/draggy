import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, clampPan, clampScale, fitScale, wheelFactor, zoomAt } from "../ui/imageView";

// The viewer keeps zoom within 1% to 800% and never lets the picture be lost off screen.

const box = { width: 800, height: 600 };
const photo = { width: 2000, height: 1000 };

describe("zoom limits", () => {
  it("clamps to 1% and 800%", () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
    expect(MIN_SCALE).toBe(0.01);
    expect(MAX_SCALE).toBe(8);
  });

  it("stops zooming at the limits however far the wheel turns", () => {
    let view = { scale: 1, x: 0, y: 0 };
    for (let i = 0; i < 200; i++) view = zoomAt(view, 1.5, { x: 0, y: 0 }, photo, box);
    expect(view.scale).toBe(MAX_SCALE);
    for (let i = 0; i < 400; i++) view = zoomAt(view, 0.5, { x: 0, y: 0 }, photo, box);
    expect(view.scale).toBe(MIN_SCALE);
  });
});

describe("fit", () => {
  it("shrinks a large picture to the box and leaves a small one alone", () => {
    expect(fitScale(photo, box)).toBeCloseTo(0.4);
    expect(fitScale({ width: 100, height: 50 }, box)).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, box)).toBe(1);
  });
});

describe("zooming toward the cursor", () => {
  it("keeps the point under the cursor where it was", () => {
    const view = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 200, y: 100 };
    const next = zoomAt(view, 2, anchor, photo, box);

    // The picture point under the cursor: (anchor - offset) / scale, before and after.
    expect((anchor.x - view.x) / view.scale).toBeCloseTo((anchor.x - next.x) / next.scale);
    expect((anchor.y - view.y) / view.scale).toBeCloseTo((anchor.y - next.y) / next.scale);
  });

  it("zooms in and back out to where it started", () => {
    const start = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 120, y: -40 };
    const zoomed = zoomAt(start, 2, anchor, photo, box);
    const back = zoomAt(zoomed, 0.5, anchor, photo, box);

    expect(back.scale).toBeCloseTo(1);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
  });

  it("turns the wheel into equal steps either way", () => {
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
  });
});

describe("panning", () => {
  it("keeps a picture smaller than the box centred", () => {
    const view = clampPan({ scale: 0.2, x: 300, y: -300 }, photo, box);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });

  it("lets a larger picture move only until its edge meets the box edge", () => {
    const view = clampPan({ scale: 1, x: 5000, y: -5000 }, photo, box);
    expect(view.x).toBe((2000 - 800) / 2);
    expect(view.y).toBe(-(1000 - 600) / 2);
  });
});
