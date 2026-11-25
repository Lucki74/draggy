// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { nextView, TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
import { ThinkingRow } from "../chat/ThinkingRow";
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
