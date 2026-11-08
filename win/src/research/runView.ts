/** The part of a research run the screen needs: plain data, safe to keep on a step and in the saved chat. */
import { budgetOf, coverage, type Depth, type ResearchRun, type SourceStatus } from "./run";

export interface RunViewSource {
  id: string;
  url: string;
  title: string;
  site?: string;
  published?: string;
  status: SourceStatus;
}

export interface RunViewNote {
  id: string;
  sourceId: string;
  quote: string;
  verified?: boolean;
  /** 1-based; absent in chats saved before notes carried it. */
  subQuestion?: number;
}

export interface ResearchRunView {
  id: string;
  depth: Depth;
  startedAt: number;
  endedAt?: number;
  wallMs: number;
  /** True while the model may still search; false once Stop was pressed or the report is being written. */
  gathering: boolean;
  questions: { text: string; notes: number }[];
  sources: RunViewSource[];
  notes: RunViewNote[];
  hosts: string[];
}

export function toRunView(run: ResearchRun, now: number): ResearchRunView {
  return {
    id: run.id,
    depth: run.plan.depth,
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    wallMs: budgetOf(run, now).wallMs,
    gathering: run.status === "gathering",
    questions: coverage(run).map((entry) => ({ text: entry.text, notes: entry.notes })),
    sources: run.sources.map((source) => ({
      id: source.id,
      url: source.url,
      title: source.title,
      status: source.status,
      ...(source.site ? { site: source.site } : {}),
      ...(source.published ? { published: source.published } : {}),
    })),
    notes: run.notes.map((note) => ({
      id: note.id,
      sourceId: note.sourceId,
      quote: note.quote,
      subQuestion: note.subQuestion,
      ...(note.verified !== undefined ? { verified: note.verified } : {}),
    })),
    hosts: [...run.contactedHosts],
  };
}

/** Dates arrive as the page wrote them; a full timestamp is cut to its day. */
export function dayOf(published: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : published;
}

export interface ResolvedCitation {
  /** The number shown on the chip: the source's place in the list of sources that have notes. */
  n: number;
  source: RunViewSource;
  quote: string;
  verified: boolean;
}

/** Sources that have at least one note, in the order they were read: the report's source list. */
export function citedSources(view: ResearchRunView): RunViewSource[] {
  const withNotes = new Set(view.notes.map((note) => note.sourceId));
  return view.sources.filter((source) => withNotes.has(source.id));
}

/** `n3` is a note id; a bare `2` is the second source in the report's list. Unknown refs give null. */
export function resolveCitation(view: ResearchRunView, ref: string): ResolvedCitation | null {
  const cited = citedSources(view);
  const noteRef = /^n\d+$/.test(ref);
  const note = noteRef
    ? view.notes.find((entry) => entry.id === ref)
    : view.notes.find((entry) => entry.sourceId === cited[Number(ref) - 1]?.id);
  const source = note && cited.find((entry) => entry.id === note.sourceId);
  if (!note || !source) return null;
  return { n: cited.indexOf(source) + 1, source, quote: note.quote, verified: note.verified === true };
}
