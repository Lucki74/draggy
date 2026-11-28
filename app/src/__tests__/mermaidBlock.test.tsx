// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MermaidBlock } from "../chat/MermaidBlock";
import { MermaidStreamingContext } from "../chat/mermaidStreaming";
import { MarkdownCode } from "../chat/CodeBlock";
import { renderMermaid, svgToPng, type MermaidResult } from "../chat/mermaid";

vi.mock("../chat/mermaid", () => ({
  isDarkTheme: () => document.body.classList.contains("dark"),
  renderMermaid: vi.fn(),
  svgDataUrl: (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`,
  svgToPng: vi.fn(),
  svgWithBackground: (svg: string) => svg.replace(/<svg\b[^>]*>/, (open) => `${open}<rect fill="#fff"/>`),
}));

const render_ = vi.mocked(renderMermaid);
const SVG = '<svg viewBox="0 0 10 10"><text>Hello</text></svg>';
const SOURCE = "flowchart TD\nA-->B";

function deferred() {
  let resolve!: (value: MermaidResult) => void;
  const promise = new Promise<MermaidResult>((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  render_.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("dark");
});

describe("MermaidBlock", () => {
  it("draws a valid diagram", async () => {
    render_.mockResolvedValue({ ok: true, svg: SVG });
    render(<MermaidBlock source={SOURCE} />);
    const img = await screen.findByRole("img", { name: /Diagram: flowchart TD/ });
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;base64,${btoa(SVG)}`);
    expect(document.querySelector("[data-mermaid]")?.getAttribute("data-mermaid")).toBe("diagram");
  });

  it("falls back to the source with an error note on bad syntax", async () => {
    render_.mockResolvedValue({ ok: false, error: "Parse error on line 1" });
    render(<MermaidBlock source="not a diagram @@@" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Parse error on line 1");
    expect(screen.getByText("not a diagram @@@", { selector: "pre" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect((screen.getByRole("button", { name: "Source" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("toggles between the diagram and its source", async () => {
    render_.mockResolvedValue({ ok: true, svg: SVG });
    render(<MermaidBlock source={SOURCE} />);
    await screen.findByRole("img");
    const toggle = screen.getByRole("button", { name: "Source" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(document.querySelector("pre")?.textContent).toBe(SOURCE);
    expect(screen.queryByRole("img")).toBeNull();
    const back = screen.getByRole("button", { name: "Diagram" });
    expect(back.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(back);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("redraws when the theme flips between light and dark", async () => {
    render_.mockResolvedValue({ ok: true, svg: SVG });
    render(<MermaidBlock source={SOURCE} />);
    await screen.findByRole("img");
    expect(render_).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.body.classList.add("dark");
    });
    await waitFor(() => expect(render_).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale render that finishes after the source changed", async () => {
    const first = deferred();
    const second = deferred();
    render_.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<MermaidBlock source="flowchart TD\nA-->B" />);
    rerender(<MermaidBlock source="flowchart TD\nC-->D" />);
    await act(async () => second.resolve({ ok: true, svg: '<svg><text>New</text></svg>' }));
    await act(async () => first.resolve({ ok: true, svg: '<svg><text>Old</text></svg>' }));
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;base64,${btoa("<svg><text>New</text></svg>")}`);
  });

  it("keeps the source as plain text while streaming", () => {
    render(
      <MermaidStreamingContext.Provider value={true}>
        <MermaidBlock source={SOURCE} />
      </MermaidStreamingContext.Provider>,
    );
    expect(document.querySelector("pre")?.textContent).toBe(SOURCE);
    expect(render_).not.toHaveBeenCalled();
  });

  it("disables the source and save buttons while loading", () => {
    render_.mockReturnValue(deferred().promise);
    render(<MermaidBlock source={SOURCE} />);
    expect(screen.getByRole("status").textContent).toMatch(/Drawing diagram/);
    for (const name of ["Source", "Save SVG", "Save PNG"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders finished markdown code blocks tagged mermaid", async () => {
    render_.mockResolvedValue({ ok: true, svg: SVG });
    render(<MarkdownCode className="language-mermaid">{`${SOURCE}\n`}</MarkdownCode>);
    await screen.findByRole("img");
    expect(render_).toHaveBeenCalledWith(SOURCE, expect.any(Function));
  });

  it("saves the SVG with its background and the PNG as base64", async () => {
    const exportChat = vi.fn().mockResolvedValue({ saved: true });
    (window as unknown as { draggy: unknown }).draggy = { exportChat };
    render_.mockResolvedValue({ ok: true, svg: SVG });
    vi.mocked(svgToPng).mockResolvedValue("data:image/png;base64,UE5H");
    render(<MermaidBlock source={SOURCE} />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Save SVG" }));
    await waitFor(() => expect(exportChat).toHaveBeenCalledTimes(1));
    expect(exportChat.mock.calls[0][0]).toMatchObject({ ext: "svg", defaultName: "mermaid-diagram.svg" });
    expect(exportChat.mock.calls[0][0].content).toContain("<rect");
    fireEvent.click(screen.getByRole("button", { name: "Save PNG" }));
    await waitFor(() => expect(exportChat).toHaveBeenCalledTimes(2));
    expect(exportChat.mock.calls[1][0]).toMatchObject({ ext: "png", content: "UE5H" });
    delete (window as unknown as { draggy?: unknown }).draggy;
  });

  it("shows a failure note when the save dialog cannot run", async () => {
    (window as unknown as { draggy: unknown }).draggy = { exportChat: vi.fn().mockRejectedValue(new Error("no ipc")) };
    render_.mockResolvedValue({ ok: true, svg: SVG });
    render(<MermaidBlock source={SOURCE} />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Save SVG" }));
    await screen.findByText(/Could not complete that action/);
    delete (window as unknown as { draggy?: unknown }).draggy;
  });
});
