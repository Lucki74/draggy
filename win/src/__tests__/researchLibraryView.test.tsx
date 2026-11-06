// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResearchPage } from "../settings/ResearchPage";
import { WebSearchPage } from "../settings/GeneralPages";
import { followUpTarget, reportOf, runsMatching } from "../research/libraryView";
import { defaultSettings } from "../app/settings";
import type { ChatSession } from "../types";

const t = (key: string) => key;

const RUNS = [
  { id: "r1", workspaceId: null, chatId: "c1", question: "How fast is Rust?", depth: "quick", status: "done", startedAt: 1_700_000_000_000, endedAt: null, sourceCount: 3, noteCount: 1 },
  { id: "r2", workspaceId: null, chatId: "gone", question: "What is Zig?", depth: "deep", status: "done", startedAt: 1_700_100_000_000, endedAt: null, sourceCount: 5, noteCount: 0 },
];

const chat = {
  id: "c1",
  title: "t",
  updatedAt: 0,
  isGenerating: false,
  messages: [
    { id: "m1", role: "user", content: "How fast is Rust?" },
    { id: "m2", role: "assistant", content: "Rust is fast.", steps: [{ type: "research_run", researchRun: { id: "r1" } }] },
  ],
} as unknown as ChatSession;

function install(extra: Record<string, unknown> = {}) {
  const research = {
    list: vi.fn(async () => ({ success: true, runs: RUNS })),
    get: vi.fn(async (id: string) => ({
      success: true,
      run: {
        ...RUNS.find((run) => run.id === id),
        plan: { question: "", subQuestions: [], depth: "quick", sources: ["web"] },
        budgetUsed: 0,
        contactedHosts: [],
        reportRef: null,
        sources: [{ id: "s1", url: "https://example.com/a", title: "Rust book", site: "example.com", status: "read" }],
        notes: [{ id: "n1", subQuestion: 1, claim: "Rust is linear", quote: "runs in linear time", sourceId: "s1", confidence: "confirmed", verified: true }],
      },
    })),
    search: vi.fn(async () => ({ success: true, hits: [{ runId: "r2", kind: "run", ref: "r2", snippet: "Zig snippet" }] })),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { research, ...extra };
  return research;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("research library helpers", () => {
  it("follows up in the chat of the run or seeds a new one", () => {
    expect(followUpTarget(RUNS[0] as never, [chat])).toEqual({ kind: "chat", id: "c1" });
    expect(followUpTarget(RUNS[1] as never, [chat])).toEqual({ kind: "new", draft: "What is Zig?" });
  });

  it("finds the report in the chat and none when the chat is gone", () => {
    expect(reportOf(RUNS[0] as never, [chat])).toBe("Rust is fast.");
    expect(reportOf(RUNS[1] as never, [chat])).toBeNull();
  });

  it("orders runs by search rank and drops the rest", () => {
    expect(runsMatching(RUNS, [{ runId: "r2" }, { runId: "r1" }]).map((run) => run.id)).toEqual(["r2", "r1"]);
    expect(runsMatching(RUNS, [{ runId: "r2" }]).map((run) => run.id)).toEqual(["r2"]);
  });
});

describe("research library page", () => {
  it("lists runs with question and depth", async () => {
    install();
    render(<ResearchPage sessions={[chat]} onFollowUp={vi.fn()} t={t} />);
    expect(await screen.findByText("How fast is Rust?")).toBeTruthy();
    expect(screen.getByText(/researchDepthDeep/)).toBeTruthy();
  });

  it("narrows the list through full-text search", async () => {
    const research = install();
    render(<ResearchPage sessions={[chat]} onFollowUp={vi.fn()} t={t} />);
    await screen.findByText("How fast is Rust?");
    fireEvent.change(screen.getByLabelText("researchSearchPlaceholder"), { target: { value: "zig" } });
    await waitFor(() => expect(screen.queryByText("How fast is Rust?")).toBeNull());
    expect(research.search).toHaveBeenCalledWith("zig");
    expect(screen.getByText("Zig snippet")).toBeTruthy();
  });

  it("opens a run to report, sources and notes and follows up in its chat", async () => {
    install();
    const onFollowUp = vi.fn();
    render(<ResearchPage sessions={[chat]} onFollowUp={onFollowUp} t={t} />);
    fireEvent.click(await screen.findByText("How fast is Rust?"));
    expect(await screen.findByText("Rust book")).toBeTruthy();
    expect(screen.getByText("Rust is linear")).toBeTruthy();
    fireEvent.click(screen.getByText("researchFollowUp"));
    expect(onFollowUp).toHaveBeenCalledWith({ kind: "chat", id: "c1" });
  });

  it("seeds a new chat when the chat of the run is gone", async () => {
    install();
    const onFollowUp = vi.fn();
    render(<ResearchPage sessions={[chat]} onFollowUp={onFollowUp} t={t} />);
    fireEvent.click(await screen.findByText("What is Zig?"));
    await screen.findByText("researchReportGone");
    fireEvent.click(screen.getByText("researchFollowUp"));
    expect(onFollowUp).toHaveBeenCalledWith({ kind: "new", draft: "What is Zig?" });
  });
});

describe("web settings", () => {
  it("saves a key through the bridge and shows only that one is set", async () => {
    const status = vi.fn(async () => ({ hasKey: false, keystore: true }));
    const setServiceKey = vi.fn(async () => ({ success: true, kept: true }));
    install({ serviceKeyStatus: status, setServiceKey });
    render(<WebSearchPage settings={defaultSettings} onUpdate={vi.fn()} t={t} />);
    const field = screen.getByLabelText("openAlexKey") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "oa-key" } });
    status.mockResolvedValue({ hasKey: true, keystore: true });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(setServiceKey).toHaveBeenCalledWith("openalex", "oa-key"));
    await waitFor(() => expect(field.placeholder).toBe("••••••••"));
    expect(field.value).toBe("");
    expect(screen.getByLabelText("githubToken")).toBeTruthy();
  });

  it("writes the research defaults to the settings", () => {
    install();
    const onUpdate = vi.fn();
    render(<WebSearchPage settings={defaultSettings} onUpdate={onUpdate} t={t} />);
    fireEvent.click(screen.getByLabelText("researchModelStart"));
    expect(onUpdate).toHaveBeenCalledWith({ researchModelStart: false });
  });
});
