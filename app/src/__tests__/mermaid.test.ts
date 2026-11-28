import { describe, expect, it } from "vitest";
import {
  cachedKeys,
  canvasScale,
  remember,
  removeStrayNodes,
  renderMermaid,
  safeColor,
  svgSize,
  svgWithBackground,
} from "../chat/mermaid";

describe("mermaid", () => {
  it("adds a background rect over the viewBox for SVG export", () => {
    const out = svgWithBackground('<svg viewBox="0 0 320 140"><text>A</text></svg>');
    expect(out).toMatch(/^<svg viewBox="0 0 320 140"><rect x="0" y="0" width="320" height="140" fill="[^"]+"\/><text>/);
  });

  it("reads the size from the viewBox", () => {
    expect(svgSize('<svg viewBox="0 0 320.5 140"></svg>')).toEqual({ width: 320.5, height: 140 });
  });

  it("falls back to width and height when there is no viewBox", () => {
    expect(svgSize('<svg width="200" height="90"></svg>')).toEqual({ width: 200, height: 90 });
  });

  it("reports a syntax error without throwing", async () => {
    const result = await renderMermaid("not a real diagram @@@");
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized diagram source before rendering", async () => {
    const result = await renderMermaid(`flowchart TD\n${"A-->B\n".repeat(20_000)}`);
    expect(result).toEqual({ ok: false, error: "Diagram is too large" });
  });

  it("settles many diagrams queued in one batch", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => renderMermaid(`flowchart TD\nA${i}-->B${i}`)),
    );
    expect(results).toHaveLength(12);
    expect(results.every((r) => typeof r.ok === "boolean")).toBe(true);
  });

  it("never returns script or event handler markup from labels", async () => {
    const hostile = [
      'flowchart TD\nA["<script>alert(1)</script>"]-->B',
      'flowchart TD\nA["<img src=x onerror=alert(1)>"]-->B',
      'flowchart TD\nA["<a href=javascript:alert(1)>x</a>"]-->B',
    ];
    for (const source of hostile) {
      const result = await renderMermaid(source);
      if (result.ok) expect(result.svg).not.toMatch(/<script|\son[a-z]+\s*=|javascript:/i);
    }
  });

  it("keeps strict security when the source sets a loose init directive", async () => {
    const result = await renderMermaid('%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B');
    if (result.ok) expect(result.svg).not.toMatch(/<script|foreignObject|javascript:/i);
  });

  it("drops click href javascript links and foreignObject labels", async () => {
    const source = 'flowchart TD\nA["<b onclick=x>t</b>"]-->B\nclick A href "javascript:alert(1)"';
    const result = await renderMermaid(source);
    if (result.ok) expect(result.svg).not.toMatch(/foreignObject|javascript:|\son[a-z]+\s*=/i);
  });

  it("removes the temp render node without throwing when none exists", () => {
    expect(() => removeStrayNodes("draggy-mermaid-missing")).not.toThrow();
  });

  it("rejects theme colours that could break an SVG attribute", () => {
    expect(safeColor("#1a1e24", "#000")).toBe("#1a1e24");
    expect(safeColor("rgb(10, 20, 30)", "#000")).toBe("rgb(10, 20, 30)");
    expect(safeColor('red" onload="x', "#000")).toBe("#000");
  });

  it("evicts old diagrams once the cache character cap is reached", () => {
    const big = "x".repeat(3_000_000);
    for (let i = 0; i < 5; i++) remember(`k${i}`, big);
    expect(cachedKeys()).not.toContain("k0");
    expect(cachedKeys()).toContain("k4");
  });

  it("scales canvas down to the side and area caps", () => {
    expect(canvasScale(100, 50)).toBe(2);
    expect(canvasScale(8192, 100)).toBeCloseTo(1);
    expect(canvasScale(16384, 100)).toBeCloseTo(0.5);
    const side = 6000 * canvasScale(6000, 6000);
    expect(side * side).toBeLessThanOrEqual(32_000_000 + 1);
  });
});
