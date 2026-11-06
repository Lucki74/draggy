/** Ties a research run to one turn's tool context, so search_web and read_url can feed it.
 * The run lives in ctx.memo and is gone with the turn; the library keeps the finished record. */
import type { ToolContext } from "../tools/registry";
import {
  addSource,
  findRepeat,
  logSearch,
  recordHost,
  renderRunState,
  tick,
  type ResearchRun,
  type ResearchSource,
  type SourceKind,
} from "./run";

const RUN_KEY = "research:run";
const PAGES_KEY = "research:pages";
/** Enough of a page to check quotes against, without holding whole books in memory. */
const PAGE_KEEP = 200_000;

type Memo = Pick<ToolContext, "memo">;

export function activeRun(ctx: Memo): ResearchRun | null {
  return (ctx.memo.get(RUN_KEY) as ResearchRun | undefined) ?? null;
}

export function setRun(ctx: Memo, run: ResearchRun): void {
  ctx.memo.set(RUN_KEY, run);
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

export function recordSearch(ctx: Memo, query: string, urls: string[], kind: SourceKind = "web"): void {
  const run = activeRun(ctx);
  if (!run) return;
  logSearch(run, query, kind, urls);
}

/** Records a page that was opened. Returns its source, so read_url can tell the model the id to cite. */
export function recordRead(
  ctx: Memo,
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
  return source;
}

export function recordContact(ctx: Memo, url: string): void {
  const run = activeRun(ctx);
  if (run) recordHost(run, url);
}
