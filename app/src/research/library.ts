/** The renderer side of the research library: the saved shapes and the record a finished run becomes. */
import type { ResearchNote, ResearchPlan, ResearchRun, ResearchSource, RunStatus } from "./run";

export interface RunSummary {
  id: string;
  workspaceId: string | null;
  chatId: string | null;
  question: string;
  depth: ResearchPlan["depth"];
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  sourceCount: number;
  noteCount: number;
}

export interface SavedSource {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  site: string | null;
  author: string | null;
  published: string | null;
  fetchedAt: number | null;
  status: ResearchSource["status"];
  snapshotHash: string | null;
}

export interface SavedRun extends RunSummary {
  plan: ResearchPlan;
  budgetUsed: number;
  contactedHosts: string[];
  reportRef: string | null;
  sources: SavedSource[];
  notes: ResearchNote[];
}

export interface RunHit {
  runId: string;
  kind: "run" | "source" | "note";
  ref: string;
  snippet: string;
}

export interface RunRecord {
  id: string;
  workspaceId?: string;
  chatId?: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  budgetUsed: number;
  contactedHosts: string[];
  reportRef?: string;
  plan: ResearchPlan;
  sources: (ResearchSource & { text?: string })[];
  notes: ResearchNote[];
}

/** Builds what the library stores from a run and the page texts read during it. */
export function toRecord(
  run: ResearchRun,
  pages: Map<string, string>,
  extra: { workspaceId?: string; chatId?: string; reportRef?: string; budgetUsed: number; now: number },
): RunRecord {
  return {
    id: run.id,
    ...(extra.workspaceId ? { workspaceId: extra.workspaceId } : {}),
    ...(extra.chatId ? { chatId: extra.chatId } : {}),
    ...(extra.reportRef ? { reportRef: extra.reportRef } : {}),
    status: run.status === "cancelled" ? "cancelled" : "done",
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? extra.now,
    budgetUsed: extra.budgetUsed,
    contactedHosts: run.contactedHosts,
    plan: run.plan,
    sources: run.sources.map((source) => {
      const text = pages.get(source.id);
      return text ? { ...source, text } : source;
    }),
    notes: run.notes,
  };
}
