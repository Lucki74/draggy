import { beforeEach, describe, expect, it, vi } from "vitest";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    parse: async () => {},
    render,
  },
}));

import { renderMermaid } from "../chat/mermaid";

describe("mermaid render with a stubbed library", () => {
  beforeEach(() => {
    render.mockReset();
    render.mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 10 10"><style>#${id} text{fill:red}</style></svg>`,
    }));
  });

  it("gives the same diagram a distinct SVG id on each render", async () => {
    const source = "flowchart TD\nIdA-->IdB";
    const first = await renderMermaid(source);
    const second = await renderMermaid(source);
    if (!first.ok || !second.ok) throw new Error("render failed");
    const idOf = (svg: string) => /<svg id="([^"]+)"/.exec(svg)?.[1];
    expect(idOf(first.svg)).toBeTruthy();
    expect(idOf(first.svg)).not.toBe(idOf(second.svg));
    const scoped = (svg: string) => svg.includes(`#${idOf(svg)} text`);
    expect(scoped(first.svg) && scoped(second.svg)).toBe(true);
  });

  it("skips the render when the caller is cancelled before it runs", async () => {
    const result = await renderMermaid("flowchart TD\nCancelA-->CancelB", () => true);
    expect(result).toEqual({ ok: false, error: "Render cancelled" });
    expect(render).not.toHaveBeenCalled();
  });
});
