// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { nextView, TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
import { ThinkingRow } from "../chat/ThinkingRow";
import { translations } from "../translations";
import type { SearchStep } from "../types";

/** Normal hides finished reasoning; Thinking and Verbose show it as plain text. */

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
    expect(screen.queryByText("Weighing the two options")).toBeNull();
  });

  it("shows as plain text in Thinking and Verbose, with no disclosure", () => {
    for (const view of ["thinking", "verbose"] as const) {
      const { container } = inView(view, row);
      expect(screen.getByText("Weighing the two options")).toBeTruthy();
      expect(container.querySelector("details")).toBeNull();
      cleanup();
    }
  });

  it("stays visible in Normal while it is still thinking", () => {
    inView("normal", <ThinkingRow step={{ ...thought, isComplete: false }} live={false} isGenerating t={t} />);
    expect(screen.getByText("Weighing the two options")).toBeTruthy();
  });
});
