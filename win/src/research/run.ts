/** A research run: the approved plan, its budget, the sources read, the notes taken and the query log.
 * Pure state, so the stop rule and the prompt it feeds can be tested without a model. */

export type Depth = "quick" | "standard" | "deep";
export type SourceKind = "web" | "papers" | "wiki" | "code";
export type NoteConfidence = "confirmed" | "single_source" | "disputed";
export type SourceStatus = "reading" | "read" | "skipped" | "blocked" | "failed";
export type RunStatus = "planning" | "gathering" | "writing" | "done" | "cancelled";
export type StopReason = "budget" | "dry" | "covered" | "finished";

export interface DepthSpec {
  wallMs: number;
  toolCalls: number;
  minQuestions: number;
  maxQuestions: number;
  targetSources: number;
  notesPerQuestion: number;
}

/** Wall clock is the main limit, so a slow local model takes fewer steps in the same time. */
export const DEPTHS: Record<Depth, DepthSpec> = {
  quick: { wallMs: 2 * 60_000, toolCalls: 20, minQuestions: 2, maxQuestions: 3, targetSources: 6, notesPerQuestion: 1 },
  standard: { wallMs: 10 * 60_000, toolCalls: 80, minQuestions: 4, maxQuestions: 6, targetSources: 20, notesPerQuestion: 2 },
  deep: { wallMs: 30 * 60_000, toolCalls: 200, minQuestions: 6, maxQuestions: 8, targetSources: 25, notesPerQuestion: 2 },
};

export const DEPTH_IDS = Object.keys(DEPTHS) as Depth[];
export const SOURCE_KINDS: SourceKind[] = ["web", "papers", "wiki", "code"];

/** The share of the budget after which the model is told to start writing. */
export const WRAP_AT = 0.8;
/** Searches in a row that add no note before the run stops looking. */
export const DRY_SEARCHES = 2;

export interface ResearchPlan {
  question: string;
  subQuestions: string[];
  depth: Depth;
  sources: SourceKind[];
}

export interface ResearchSource {
  id: string;
  url: string;
  key: string;
  title: string;
  site?: string;
  published?: string;
  status: SourceStatus;
}

export interface ResearchNote {
  id: string;
  subQuestion: number;
  claim: string;
  quote: string;
  sourceId: string;
  confidence: NoteConfidence;
  verified?: boolean;
}

export interface QueryEntry {
  query: string;
  key: string;
  kind: SourceKind;
  urls: string[];
}

export interface ResearchRun {
  id: string;
  plan: ResearchPlan;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  toolCalls: number;
  sources: ResearchSource[];
  notes: ResearchNote[];
  queries: QueryEntry[];
  contactedHosts: string[];
  dryStreak: number;
  notesAtLastSearch: number;
  stopReason?: StopReason;
}

export function isDepth(value: unknown): value is Depth {
  return typeof value === "string" && value in DEPTHS;
}

/** Trims the plan to what the depth allows, so a model that drafts twelve questions still fits the budget. */
export function readPlan(raw: {
  question?: unknown;
  subQuestions?: unknown;
  depth?: unknown;
  sources?: unknown;
}): ResearchPlan | null {
  const question = String(raw.question ?? "").trim();
  if (!question) return null;
  const depth: Depth = isDepth(raw.depth) ? raw.depth : "standard";
  const lines = Array.isArray(raw.subQuestions) ? raw.subQuestions.map(String) : String(raw.subQuestions ?? "").split("\n");
  const subQuestions = [
    ...new Set(lines.map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).filter(Boolean)),
  ].slice(0, DEPTHS[depth].maxQuestions);
  const kinds = Array.isArray(raw.sources) ? raw.sources.map(String) : String(raw.sources ?? "").split(/[\s,]+/);
  const sources = SOURCE_KINDS.filter((kind) => kinds.includes(kind));
  return {
    question,
    subQuestions: subQuestions.length > 0 ? subQuestions : [question],
    depth,
    sources: sources.length > 0 ? sources : ["web"],
  };
}

export function createRun(id: string, plan: ResearchPlan, now: number): ResearchRun {
  return {
    id,
    plan,
    status: "gathering",
    startedAt: now,
    toolCalls: 0,
    sources: [],
    notes: [],
    queries: [],
    contactedHosts: [],
    dryStreak: 0,
    notesAtLastSearch: 0,
  };
}

const STOP_WORDS = new Set(
  "a an and are as at be by for from how in is it of on or the to what when where which who why with vs versus".split(" "),
);

/** Word order, case, punctuation and filler words do not make a new query. */
export function normaliseQuery(query: string): string {
  const words = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word));
  return [...new Set(words)].sort().join(" ");
}

/** The same page reached through tracking links or a trailing slash is one source. */
export function sourceKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const name of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|ref_src$|mc_[ce]id$)/i.test(name)) parsed.searchParams.delete(name);
    }
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function recordHost(run: ResearchRun, url: string): void {
  const host = hostOf(url);
  if (host && !run.contactedHosts.includes(host)) run.contactedHosts.push(host);
}

/** A repeat returns the earlier entry, so the tool can answer it without spending a search. */
export function findRepeat(run: ResearchRun, query: string, kind: SourceKind): QueryEntry | null {
  const key = normaliseQuery(query);
  if (!key) return null;
  return run.queries.find((entry) => entry.key === key && entry.kind === kind) ?? null;
}

/** Logs a search and moves the dry streak: a search with no note since the previous one counts as dry. */
export function logSearch(run: ResearchRun, query: string, kind: SourceKind, urls: string[]): QueryEntry {
  if (run.queries.length > 0) {
    run.dryStreak = run.notes.length > run.notesAtLastSearch ? 0 : run.dryStreak + 1;
  }
  run.notesAtLastSearch = run.notes.length;
  const entry: QueryEntry = { query: query.trim(), key: normaliseQuery(query), kind, urls };
  run.queries.push(entry);
  return entry;
}

export function addSource(
  run: ResearchRun,
  input: { url: string; title?: string; site?: string; published?: string; status?: SourceStatus },
): ResearchSource {
  const key = sourceKey(input.url);
  const existing = run.sources.find((source) => source.key === key);
  if (existing) {
    if (input.status) existing.status = input.status;
    if (input.title && !existing.title) existing.title = input.title;
    if (input.site && !existing.site) existing.site = input.site;
    if (input.published && !existing.published) existing.published = input.published;
    return existing;
  }
  const source: ResearchSource = {
    id: `s${run.sources.length + 1}`,
    url: input.url,
    key,
    title: input.title?.trim() || input.url,
    status: input.status ?? "reading",
    ...(input.site ? { site: input.site } : {}),
    ...(input.published ? { published: input.published } : {}),
  };
  run.sources.push(source);
  return source;
}

export function findSource(run: ResearchRun, ref: string): ResearchSource | undefined {
  const trimmed = ref.trim();
  return run.sources.find((source) => source.id === trimmed) ?? run.sources.find((source) => source.key === sourceKey(trimmed));
}

const CONFIDENCES: NoteConfidence[] = ["confirmed", "single_source", "disputed"];

/** A note must point at a page the model actually read, so a citation can never name an unopened URL. */
export function addNote(
  run: ResearchRun,
  input: { subQuestion?: unknown; claim?: unknown; quote?: unknown; source?: unknown; confidence?: unknown },
): ResearchNote | string {
  const claim = String(input.claim ?? "").trim();
  const quote = String(input.quote ?? "").trim();
  if (!claim) return "The note had no claim. Write what you learned in one sentence.";
  if (!quote) return "The note had no quote. Copy the exact sentence from the page that supports it.";
  const source = findSource(run, String(input.source ?? ""));
  if (!source) return "That source is not one you have read. Use the source id read_url gave, such as s1.";
  if (source.status !== "read") return `Source ${source.id} was not read successfully, so it cannot support a note.`;
  const count = run.plan.subQuestions.length;
  const index = Number.parseInt(String(input.subQuestion ?? "1"), 10);
  const subQuestion = Number.isFinite(index) && index >= 1 && index <= count ? index : 1;
  const confidence = CONFIDENCES.find((value) => value === input.confidence) ?? "single_source";
  const note: ResearchNote = {
    id: `n${run.notes.length + 1}`,
    subQuestion,
    claim,
    quote,
    sourceId: source.id,
    confidence,
  };
  run.notes.push(note);
  return note;
}

export interface Budget {
  elapsedMs: number;
  wallMs: number;
  callsUsed: number;
  callLimit: number;
  /** The larger of the time share and the call share used, 0 to 1 and beyond. */
  used: number;
  wrap: boolean;
  over: boolean;
}

export function budgetOf(run: ResearchRun, now: number): Budget {
  const spec = DEPTHS[run.plan.depth];
  const elapsedMs = Math.max(0, now - run.startedAt);
  const used = Math.max(elapsedMs / spec.wallMs, run.toolCalls / spec.toolCalls);
  return {
    elapsedMs,
    wallMs: spec.wallMs,
    callsUsed: run.toolCalls,
    callLimit: spec.toolCalls,
    used,
    wrap: used >= WRAP_AT,
    over: used >= 1,
  };
}

/** Notes that count towards a sub-question: disputed and failed-verification notes do not. */
function supportingNotes(run: ResearchRun, subQuestion: number): number {
  return run.notes.filter(
    (note) => note.subQuestion === subQuestion && note.confidence !== "disputed" && note.verified !== false,
  ).length;
}

export function coverage(run: ResearchRun): { subQuestion: number; text: string; notes: number; enough: boolean }[] {
  const need = DEPTHS[run.plan.depth].notesPerQuestion;
  return run.plan.subQuestions.map((text, index) => {
    const notes = supportingNotes(run, index + 1);
    return { subQuestion: index + 1, text, notes, enough: notes >= need };
  });
}

export function stopReason(run: ResearchRun, now: number): StopReason | null {
  if (run.stopReason) return run.stopReason;
  if (budgetOf(run, now).over) return "budget";
  if (run.dryStreak >= DRY_SEARCHES) return "dry";
  if (coverage(run).every((entry) => entry.enough)) return "covered";
  return null;
}

/** Counts one research tool call. Returns why gathering must stop, which the tool turns into "write now". */
export function tick(run: ResearchRun, now: number): StopReason | null {
  run.toolCalls += 1;
  const reason = stopReason(run, now);
  if (reason && run.status === "gathering") {
    run.status = "writing";
    run.stopReason = reason;
  }
  return reason;
}

export function finish(run: ResearchRun, reason: StopReason = "finished"): void {
  if (run.status === "gathering") run.status = "writing";
  run.stopReason ??= reason;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function minutes(ms: number): string {
  return `${Math.max(0, Math.round(ms / 6000) / 10)} min`;
}

const STOP_TEXT: Record<StopReason, string> = {
  budget: "The research budget is spent.",
  dry: "The last searches found nothing new.",
  covered: "Every sub-question has enough supported notes.",
  finished: "You ended the research.",
};

/** The compact run state the model sees each step: plan coverage, notes, queries and budget, never page text. */
export function renderRunState(run: ResearchRun, now: number): string {
  const budget = budgetOf(run, now);
  const lines = [`RESEARCH: ${run.plan.question}`, `Depth ${run.plan.depth}.`];
  lines.push(
    `Budget: ${minutes(budget.elapsedMs)} of ${minutes(budget.wallMs)}, ${budget.callsUsed} of ${budget.callLimit} tool calls.`,
  );
  lines.push("Sub-questions:");
  for (const entry of coverage(run)) {
    lines.push(`${entry.subQuestion}. [${entry.enough ? "x" : " "}] ${entry.text} (${entry.notes} notes)`);
  }
  if (run.notes.length > 0) {
    lines.push("Notes:");
    for (const note of run.notes.slice(-40)) {
      lines.push(`${note.id} q${note.subQuestion} ${note.sourceId} ${note.confidence}: ${clip(note.claim, 160)}`);
    }
  }
  if (run.queries.length > 0) {
    lines.push(`Searched: ${run.queries.slice(-15).map((entry) => `"${clip(entry.query, 60)}"`).join(", ")}`);
  }
  const reason = stopReason(run, now);
  if (reason) {
    lines.push(`${STOP_TEXT[reason]} Stop searching and write the report now from your notes, citing note ids like [n1].`);
  } else if (budget.wrap) {
    lines.push("Most of the budget is used. Fill only the sub-questions without notes, then write the report.");
  } else {
    const open = coverage(run).filter((entry) => !entry.enough);
    if (open.length > 0) lines.push(`Next: find support for sub-question ${open[0].subQuestion}.`);
  }
  return lines.join("\n");
}

/** The loop cap for a turn that carries a run: its call budget plus room to plan and write. */
export function loopLimitFor(run: ResearchRun | null | undefined, base: number): number {
  return run ? Math.max(base, DEPTHS[run.plan.depth].toolCalls + 20) : base;
}
