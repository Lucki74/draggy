/** Ties a research run to one turn's tool context, so search_web and read_url can feed it.
 * The run lives in ctx.memo and is gone with the turn; the library keeps the finished record. */
import type { ToolContext } from "../tools/registry";
import {
  addSource,
  budgetOf,
  finish,
  findRepeat,
  logSearch,
  recordHost,
  renderRunState,
  tick,
  type ResearchRun,
  type ResearchSource,
  type SourceKind,
} from "./run";
import { toRunView } from "./runView";
import { verifyCitations } from "./citations";
import { toRecord, type SavedRun } from "./library";
import { swallowed } from "../logger";

const RUN_KEY = "research:run";
const PAGES_KEY = "research:pages";
const STEP_KEY = "research:step";
/** Enough of a page to check quotes against, without holding whole books in memory. */
const PAGE_KEEP = 200_000;

type Memo = Pick<ToolContext, "memo">;

export function activeRun(ctx: Memo): ResearchRun | null {
  return (ctx.memo.get(RUN_KEY) as ResearchRun | undefined) ?? null;
}

export function setRun(ctx: Memo, run: ResearchRun): void {
  ctx.memo.set(RUN_KEY, run);
}

type RunScreen = Memo & Partial<Pick<ToolContext, "pushStep" | "patchStep" | "syncSteps" | "newId" | "t">>;

/** Runs the Stop button can end: the run and the call that redraws its block. */
const live = new Map<string, { run: ResearchRun; sync: () => void }>();

/** Shows the run block once the plan is approved, and keeps it current through syncRun. */
export function openRunBlock(ctx: RunScreen, run: ResearchRun): void {
  if (!ctx.pushStep || !ctx.newId) return;
  const stepId = ctx.newId();
  ctx.memo.set(STEP_KEY, stepId);
  ctx.pushStep({
    id: stepId,
    type: "research_run",
    content: ctx.t?.("researchRunTitle") ?? "",
    isComplete: false,
    researchRun: toRunView(run, Date.now()),
  });
  live.set(run.id, { run, sync: () => syncRun(ctx) });
  ctx.syncSteps?.();
}

/** Copies the run's state onto its block. Does nothing outside a run or when the block is not shown. */
export function syncRun(ctx: RunScreen): void {
  const run = activeRun(ctx);
  const stepId = ctx.memo.get(STEP_KEY) as string | undefined;
  if (!run || !stepId || !ctx.patchStep) return;
  ctx.patchStep(stepId, { researchRun: toRunView(run, Date.now()), isComplete: run.endedAt !== undefined });
  ctx.syncSteps?.();
  if (run.endedAt !== undefined) live.delete(run.id);
}

/** Ends gathering: checks every quote against its page, then saves the run to the library.
 * The report still gets written if the library cannot save. */
export async function settleRun(
  ctx: RunScreen & Partial<Pick<ToolContext, "workspaceId" | "chatId">>,
): Promise<{ dropped: number } | null> {
  const run = activeRun(ctx);
  if (!run) return null;
  finish(run);
  const verdicts = verifyCitations(run.notes, pageTexts(ctx));
  for (const note of run.notes) note.verified = verdicts.get(note.id) === "verified";
  const now = Date.now();
  run.endedAt = now;
  syncRun(ctx);
  const record = toRecord(run, pageTexts(ctx), {
    workspaceId: ctx.workspaceId,
    chatId: ctx.chatId,
    budgetUsed: budgetOf(run, now).used,
    now,
  });
  await globalThis.window?.electronAPI?.research?.save(record).catch(swallowed("research", "the run stays in the chat", null));
  return { dropped: run.notes.filter((note) => !note.verified).length };
}

/** The latest finished run saved for this chat, for a follow-up after the turn that ran it is gone. */
export async function priorRun(ctx: Partial<Pick<ToolContext, "workspaceId" | "chatId">>): Promise<SavedRun | null> {
  const api = globalThis.window?.electronAPI?.research;
  if (!api || !ctx.chatId) return null;
  const listed = await api.list(ctx.workspaceId).catch(swallowed("research", "no earlier run is offered", null));
  const latest = (listed?.runs ?? [])
    .filter((entry) => entry.chatId === ctx.chatId && entry.status === "done")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  if (!latest) return null;
  const saved = await api.get(latest.id).catch(swallowed("research", "no earlier run is offered", null));
  return saved?.run ?? null;
}

/** The Stop button: tells the model to write now from its notes. False when the run is not live. */
export function stopRun(runId: string): boolean {
  const entry = live.get(runId);
  if (!entry || entry.run.status !== "gathering") return false;
  finish(entry.run);
  entry.sync();
  return true;
}

/** A page is about to be fetched: shows it as reading until recordRead settles it. */
export function recordReading(ctx: RunScreen, url: string): void {
  const run = activeRun(ctx);
  if (!run) return;
  recordHost(run, url);
  addSource(run, { url, status: "reading" });
  syncRun(ctx);
}

export function pageTexts(ctx: Memo): Map<string, string> {
  const existing = ctx.memo.get(PAGES_KEY) as Map<string, string> | undefined;
  if (existing) return existing;
  const fresh = new Map<string, string>();
  ctx.memo.set(PAGES_KEY, fresh);
  return fresh;
}

/** The run state as a tool-result footer, or nothing outside a run. */
export function runFooter(ctx: Memo, now = Date.now()): string {
  const run = activeRun(ctx);
  return run ? `\n\n${renderRunState(run, now)}` : "";
}

/** Counts a gathering call. True when the run says stop, which the caller reports instead of working. */
export function spendCall(ctx: Memo, now = Date.now()): boolean {
  const run = activeRun(ctx);
  if (!run || run.status !== "gathering") return run !== null && run.status === "writing";
  return tick(run, now) !== null;
}

export function repeatedSearch(ctx: Memo, query: string, kind: SourceKind = "web"): string[] | null {
  const run = activeRun(ctx);
  const entry = run ? findRepeat(run, query, kind) : null;
  return entry ? entry.urls : null;
}

export function recordSearch(ctx: RunScreen, query: string, urls: string[], kind: SourceKind = "web"): void {
  const run = activeRun(ctx);
  if (!run) return;
  logSearch(run, query, kind, urls);
  syncRun(ctx);
}

/** Records a page that was opened. Returns its source, so read_url can tell the model the id to cite. */
export function recordRead(
  ctx: RunScreen,
  page: { url: string; title?: string; text?: string; site?: string; published?: string; ok: boolean },
): ResearchSource | null {
  const run = activeRun(ctx);
  if (!run) return null;
  recordHost(run, page.url);
  const source = addSource(run, {
    url: page.url,
    title: page.title,
    site: page.site,
    published: page.published,
    status: page.ok ? "read" : "failed",
  });
  if (page.ok && page.text) pageTexts(ctx).set(source.id, page.text.slice(0, PAGE_KEEP));
  syncRun(ctx);
  return source;
}

export function recordContact(ctx: RunScreen, url: string): void {
  const run = activeRun(ctx);
  if (!run) return;
  recordHost(run, url);
  syncRun(ctx);
}
