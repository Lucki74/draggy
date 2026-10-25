// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { nextView, TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
import { ThinkingRow } from "../chat/ThinkingRow";
import { WorkGroup } from "../chat/WorkGroup";
import { translations } from "../translations";
import type { SearchStep } from "../types";

/** Normal hides finished reasoning, Thinking shows it folded, Verbose opens everything. */

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

const thought: SearchStep = {
  id: "think",
  type: "thinking",
  content: "Weighing the two options",
  isComplete: true,
  thoughtTime: 3,
};

const read: SearchStep = { id: "read", type: "reading", content: "", filepath: "src/a.ts", isComplete: true };

const inView = (view: TranscriptView, node: React.ReactNode) =>
  render(<TranscriptViewContext.Provider value={view}>{node}</TranscriptViewContext.Provider>);

describe("nextView", () => {
  it("steps through the three views and wraps", () => {
    expect(nextView("normal")).toBe("thinking");
    expect(nextView("thinking")).toBe("verbose");
    expect(nextView("verbose")).toBe("normal");
  });
});

describe("finished reasoning", () => {
  const row = <ThinkingRow step={thought} live={false} isGenerating={false} t={t} />;

  it("is hidden in Normal", () => {
    inView("normal", row);
    expect(screen.queryByText("Thought for 3s")).toBeNull();
  });

  it("shows folded in Thinking and open in Verbose", () => {
    const { container } = inView("thinking", row);
    expect(screen.getByText("Thought for 3s")).toBeTruthy();
    expect(container.querySelector("details")?.open).toBe(false);
    cleanup();

    const verbose = inView("verbose", row);
    expect(verbose.container.querySelector("details")?.open).toBe(true);
  });

  it("stays visible in Normal while it is still thinking", () => {
    inView("normal", <ThinkingRow step={{ ...thought, isComplete: false }} live isGenerating t={t} />);
    expect(screen.getByRole("status").textContent).toBe("Thinking");
  });
});

describe("a finished work group", () => {
  const group = (
    <WorkGroup steps={[read, read]} active={false} language="en" t={t}>
      <p>step detail</p>
      <p>second detail</p>
    </WorkGroup>
  );

  it("is folded in Normal and open in Verbose", () => {
    const normal = inView("normal", group);
    expect(normal.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("false");

    normal.rerender(<TranscriptViewContext.Provider value="verbose">{group}</TranscriptViewContext.Provider>);
    expect(normal.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the work block's steps", () => {
  it("are numbered and fold together with Collapse all", () => {
    const { container, getByRole } = inView(
      "verbose",
      <WorkGroup steps={[read, read]} active={false} language="en" t={t}>
        <details open>
          <summary>output</summary>
        </details>
        <p>second</p>
      </WorkGroup>,
    );

    expect([...container.querySelectorAll("li")].map((item) => item.firstChild?.textContent)).toEqual(["1", "2"]);

    fireEvent.click(getByRole("button", { name: "Collapse all" }));
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("ol")?.hidden).toBe(true);
  });
});
