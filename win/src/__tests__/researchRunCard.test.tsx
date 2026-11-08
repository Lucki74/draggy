// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import ResearchRunCard from "../chat/ResearchRunCard";
import WorkBlock from "../chat/WorkBlock";
import { CitationContext } from "../chat/citationContext";
import { MARKDOWN_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../chat/markdown";
import { createRun, readPlan, type ResearchRun } from "../research/run";
import { openRunBlock, recordReading, recordRead, stopRun } from "../research/session";
import { toRunView, type ResearchRunView } from "../research/runView";
import { FILL_EVENT } from "../chat/mentions";
import type { SearchStep } from "../types";

const t = (key: string) => key;

const view = (patch: Partial<ResearchRunView> = {}): ResearchRunView => ({
  id: "run1",
  depth: "standard",
  startedAt: Date.now() - 65_000,
  wallMs: 600_000,
  gathering: true,
  questions: [
    { text: "Speed", notes: 2 },
    { text: "Cost", notes: 0 },
  ],
  sources: [
    { id: "s1", url: "https://example.com/a", title: "Alpha page", site: "Example", published: "2026-05-01T10:00:00Z", status: "read" },
    { id: "s2", url: "https://other.org/b", title: "https://other.org/b", status: "reading" },
    { id: "s3", url: "https://blocked.net/c", title: "Gamma", status: "blocked" },
  ],
  notes: [{ id: "n1", sourceId: "s1", quote: "It is fast.", verified: true }],
  hosts: ["example.com", "other.org"],
  ...patch,
});

const runStep = (patch: Partial<SearchStep> = {}): SearchStep =>
  ({ id: "r", type: "research_run", content: "", isComplete: false, researchRun: view(), ...patch }) as SearchStep;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ResearchRunCard", () => {
  it("reads as one rail line with the questions and their sources inside", () => {
    render(<ResearchRunCard step={runStep()} t={t} />);
    expect(screen.getByText("researchRunLive")).toBeTruthy();
    expect(screen.getByText(/researchDepthStandard · 1:0\d \/ 10:00 · researchRunSourcesOne · researchRunFailed/)).toBeTruthy();
    expect(screen.getByText("Speed")).toBeTruthy();
    expect(screen.getAllByText("researchRunNotes")).toHaveLength(2);
    expect(screen.getByText("Alpha page")).toBeTruthy();
    expect(screen.getByText("researchRunOtherSources")).toBeTruthy();
    expect(screen.getByText("researchStatusReading")).toBeTruthy();
    expect(screen.getAllByText("researchStatusBlocked").length).toBeGreaterThan(0);
    expect(screen.getByText("researchRunServices")).toBeTruthy();
  });

  it("puts a source under the question its note answers", () => {
    const notes = [{ id: "n1", sourceId: "s1", quote: "q", subQuestion: 2 }];
    render(<ResearchRunCard step={runStep({ researchRun: view({ notes }) })} t={t} />);
    const cost = screen.getByText("Cost").closest("[role=listitem]")!;
    expect(cost.textContent).toContain("Alpha page");
  });

  it("offers Retry on a failed source", () => {
    const heard = vi.fn();
    window.addEventListener(FILL_EVENT, (event) => heard((event as CustomEvent<string>).detail));
    render(<ResearchRunCard step={runStep()} t={(key) => (key === "researchRetryPrompt" ? "Retry reading {url}" : key)} />);
    fireEvent.click(screen.getByRole("button", { name: "researchRetry" }));
    expect(heard).toHaveBeenCalledWith("Retry reading https://blocked.net/c");
  });

  it("folds once done in the normal view and sums up the run", () => {
    render(<ResearchRunCard step={runStep({ isComplete: true, researchRun: view({ endedAt: Date.now(), gathering: false }) })} t={t} />);
    expect(screen.getByText("researchRunDone")).toBeTruthy();
    expect(screen.getByRole("button", { name: /researchRunQuestions/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a source through the external-link handler", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ResearchRunCard step={runStep()} t={t} />);
    fireEvent.click(screen.getByText("Alpha page"));
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank");
  });

  it("hides Stop once the run is finished", () => {
    render(<ResearchRunCard step={runStep({ isComplete: true, researchRun: view({ endedAt: Date.now(), gathering: false }) })} t={t} />);
    expect(screen.queryByRole("button", { name: /researchRunStop/ })).toBeNull();
  });

  it("warns when a finished run kept no sourced notes", () => {
    const ended = { endedAt: Date.now(), gathering: false };
    render(<ResearchRunCard step={runStep({ isComplete: true, researchRun: view({ ...ended, notes: [] }) })} t={t} />);
    expect(screen.getByText("researchRunNoNotes")).toBeTruthy();
    cleanup();
    render(<ResearchRunCard step={runStep({ isComplete: true, researchRun: view(ended) })} t={t} />);
    expect(screen.queryByText("researchRunNoNotes")).toBeNull();
    cleanup();
    render(<ResearchRunCard step={runStep({ researchRun: view({ notes: [] }) })} t={t} />);
    expect(screen.queryByText("researchRunNoNotes")).toBeNull();
  });
});

describe("Stop", () => {
  const build = () => {
    const steps = new Map<string, SearchStep>();
    let n = 0;
    const ctx = {
      memo: new Map<string, unknown>(),
      newId: () => `id${++n}`,
      t,
      pushStep: (s: SearchStep) => steps.set(s.id, s),
      patchStep: (id: string, p: Partial<SearchStep>) => steps.set(id, { ...steps.get(id)!, ...p }),
      syncSteps: () => {},
    };
    const run: ResearchRun = createRun("run9", readPlan({ question: "Q", subQuestions: "A\nB" })!, Date.now());
    ctx.memo.set("research:run", run);
    return { ctx, run, steps };
  };

  it("ends gathering and redraws the block", () => {
    const { ctx, run, steps } = build();
    openRunBlock(ctx as never, run);
    recordReading(ctx as never, "https://example.com/a");
    recordRead(ctx as never, { url: "https://example.com/a", title: "A", ok: true, text: "x" });
    const block = [...steps.values()].find((s) => s.type === "research_run")!;
    expect(block.researchRun?.sources[0].status).toBe("read");
    expect(stopRun("run9")).toBe(true);
    expect(run.status).toBe("writing");
    expect(stopRun("run9")).toBe(false);
    expect([...steps.values()].find((s) => s.type === "research_run")!.researchRun?.gathering).toBe(false);
    expect(toRunView(run, Date.now()).hosts).toEqual(["example.com"]);
  });
});

describe("failed read row", () => {
  const failed = { id: "f", type: "error", content: "Reading **https://example.com/x**", isComplete: true, retryUrl: "https://example.com/x" } as SearchStep;

  it("puts a retry line in the composer", () => {
    const heard = vi.fn();
    window.addEventListener(FILL_EVENT, (event) => heard((event as CustomEvent<string>).detail));
    render(<WorkBlock step={failed} t={(key) => (key === "researchRetryPrompt" ? "Retry reading {url}" : key)} />);
    fireEvent.click(screen.getByRole("button", { name: "researchRetry" }));
    expect(heard).toHaveBeenCalledWith("Retry reading https://example.com/x");
  });

  it("opens the page in the browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WorkBlock step={failed} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "researchOpenInBrowser" }));
    expect(open).toHaveBeenCalledWith("https://example.com/x", "_blank");
  });
});

describe("citation chips", () => {
  const md = (text: string, run: ResearchRunView | null) =>
    render(
      <CitationContext.Provider value={run}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </CitationContext.Provider>,
    );

  it("turns a note id into a numbered chip with a hover card", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    md("It is fast [n1].", view());
    const chip = screen.getByRole("button", { name: /Alpha page/ });
    expect(chip.textContent).toBe("1");
    expect(screen.getByText("It is fast.")).toBeTruthy();
    expect(screen.getByText("Quote found on the page")).toBeTruthy();
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank");
  });

  it("leaves markers alone without a run or for unknown ids", () => {
    md("Plain [n1] and [n9].", null);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Plain \[n1\] and \[n9\]\./)).toBeTruthy();
    cleanup();
    md("Unknown [n9] and code `[n1]`.", view());
    expect(screen.queryByRole("button")).toBeNull();
  });
});
