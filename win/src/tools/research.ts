/** The research tools: a plan the user approves, notes tied to read pages, and a checked finish.
 * Gathering itself goes through search_web and read_url, which feed the run in ctx.memo. */
import type { ToolSpec } from "./registry";
import { registerTools } from "./registry";
import { swallowed } from "../logger";
import { judgeCitation } from "../research/citations";
import { activeRun, openRunBlock, pageTexts, priorRun, runFooter, setRun, settleRun, spendCall, syncRun } from "../research/session";
import {
  addNote,
  coverage,
  createRun,
  DEPTH_IDS,
  DEPTHS,
  readPlan,
  type ResearchPlan,
  clampDepth,
} from "../research/run";

const webOn = (env: { webMode: string }) => env.webMode !== "off";

/** The model may start research unless the user turned that off. */
export const mayStartResearch = (env: { webMode: string; researchModelStart?: boolean }) =>
  webOn(env) && env.researchModelStart !== false;

const READ_ONLY = {
  readOnly: true,
  readOnlyHint: true,
  destructive: false,
  destructiveHint: false,
  idempotent: false,
  idempotentHint: false,
  openWorld: false,
  openWorldHint: false,
};

const APPROVE = "approve";

function planText(plan: ResearchPlan): string {
  const spec = DEPTHS[plan.depth];
  const lines = plan.subQuestions.map((text, index) => `${index + 1}. ${text}`);
  return [
    plan.question,
    ...lines,
    `${plan.depth}, up to ${Math.round(spec.wallMs / 60_000)} min, sources: ${plan.sources.join(", ")}`,
  ].join("\n");
}

/** The card sends the edited plan back as JSON; anything unreadable keeps the draft. */
function editedPlan(text: string, drafted: ResearchPlan): ResearchPlan {
  try {
    return readPlan({ ...JSON.parse(text), question: drafted.question }) ?? drafted;
  } catch {
    return drafted;
  }
}

const startResearch: ToolSpec = {
  name: "start_research",
  group: "web",
  description:
    "Start a research run for a question that needs several sources. Draft the sub-questions that together answer it; the user approves the plan before any search runs. Then search, read pages and record what you learn with add_note.",
  parameters: {
    question: { type: "string", description: "The question to research, in the user's words." },
    sub_questions: { type: "string", description: "The sub-questions, one per line." },
    depth: { type: "string", description: `How deep to go: ${DEPTH_IDS.join(", ")}.` },
    sources: { type: "string", description: "Where to look, comma separated: web, papers, wiki, code. Pass the same word as search_web's source parameter to search each one." },
  },
  required: ["question", "sub_questions"],
  usage:
    '{"question": "...", "sub_questions": "First\\nSecond", "depth": "standard", "sources": "web"} → the approved plan',
  annotations: READ_ONLY,
  available: mayStartResearch,
  run: async (args, ctx) => {
    if (activeRun(ctx)) {
      return `TOOL RESULT (start_research): A research run is already going in this reply. Carry on with it.${runFooter(ctx)}`;
    }
    const firstDraft = readPlan({
      question: args.question,
      subQuestions: args.sub_questions,
      depth: args.depth,
      sources: args.sources,
    });
    if (!firstDraft) return "TOOL RESULT (start_research): There was no question. Send the question to research.";

    const cap = ctx.environment?.researchMaxDepth;
    const drafted = { ...firstDraft, depth: clampDepth(firstDraft.depth, cap) };
    let plan = drafted;
    if (ctx.approveResearch) {
      const approved = await ctx.approveResearch(drafted);
      if (!approved) return "TOOL RESULT (start_research): The user cancelled the research. Do not search; ask what they want instead.";
      plan = approved;
    } else if (ctx.askUser) {
      const id = ctx.newId();
      const question = { id, text: planText(drafted), options: [APPROVE], multiple: false };
      ctx.pushStep({ id, type: "research_plan", content: ctx.t("researchPlanTitle"), isComplete: false, question, researchPlan: drafted });
      ctx.syncSteps();
      const reply = await ctx.askUser(question);
      ctx.patchStep(id, { reply: reply ?? "cancelled", isComplete: true });
      ctx.syncSteps();
      if (!reply || !reply.choices.includes(APPROVE)) {
        return "TOOL RESULT (start_research): The user did not approve the plan. Do not search; ask what they want changed.";
      }
      plan = editedPlan(reply.text, drafted);
    }

    const run = createRun(ctx.newId(), { ...plan, depth: clampDepth(plan.depth, cap) }, Date.now());
    setRun(ctx, run);
    openRunBlock(ctx, run);
    return `TOOL RESULT (start_research): The plan is approved. Search for each sub-question, read the best pages with read_url, and after each useful page call add_note with the exact sentence it says.${runFooter(ctx)}`;
  },
};

const addNoteTool: ToolSpec = {
  name: "add_note",
  group: "web",
  description:
    "Record one fact from a page you read during research, with the exact sentence that supports it. Only noted facts can be cited in the report.",
  parameters: {
    sub_question: { type: "number", description: "The number of the sub-question this answers." },
    claim: { type: "string", description: "What you learned, in one sentence of your own." },
    quote: { type: "string", description: "The exact sentence from the page, copied word for word." },
    source_id: { type: "string", description: "The source id read_url gave, such as s1." },
    confidence: { type: "string", description: "confirmed, single_source or disputed." },
  },
  required: ["claim", "quote", "source_id"],
  usage: '{"sub_question": 1, "claim": "...", "quote": "...", "source_id": "s1"} → the note id',
  annotations: READ_ONLY,
  available: webOn,
  run: async (args, ctx) => {
    const run = activeRun(ctx);
    if (!run) return "TOOL RESULT (add_note): There is no research run. Call start_research first.";
    spendCall(ctx);
    const note = addNote(run, {
      subQuestion: args.sub_question,
      claim: args.claim,
      quote: args.quote,
      source: args.source_id,
      confidence: args.confidence,
    });
    if (typeof note === "string") return `TOOL RESULT (add_note): ${note}`;
    // Checked here, not only at finish: a paraphrased quote used to be dropped there, too late to fix.
    const page = pageTexts(ctx).get(note.sourceId);
    const verdict = page === undefined ? "unverified" : judgeCitation(note.quote, page);
    if (verdict !== "verified") {
      run.notes.pop();
      const hint = verdict === "near" ? "It is close but not word for word." : "It does not appear on that page.";
      return `TOOL RESULT (add_note): Not saved. The quote was not found on ${note.sourceId}. ${hint} Copy one sentence exactly as the page has it, with at least three words, or read the page again.`;
    }
    syncRun(ctx);
    return `TOOL RESULT (add_note): Saved as ${note.id}.${runFooter(ctx)}`;
  },
};

const searchNotes: ToolSpec = {
  name: "search_notes",
  group: "web",
  description: "Look through the notes of this research run by keyword before searching the web again.",
  parameters: { query: { type: "string", description: "Words to look for in the notes." } },
  required: ["query"],
  usage: '{"query": "release date"} → matching notes',
  annotations: { ...READ_ONLY, idempotent: true, idempotentHint: true },
  available: webOn,
  run: async (args, ctx) => {
    const live = activeRun(ctx);
    const saved = live ? null : await priorRun(ctx);
    if (!live && !saved) return "TOOL RESULT (search_notes): There is no research run.";
    const query = String(args.query ?? "");
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = (live?.notes ?? saved?.notes ?? []).filter((note) => {
      const text = `${note.claim} ${note.quote}`.toLowerCase();
      return words.length === 0 || words.some((word) => text.includes(word));
    });
    const lines = hits.slice(0, 20).map((note) => `${note.id} (${note.sourceId}): ${note.claim}\n  "${note.quote}"`);
    if (saved) {
      const pages = await globalThis.window?.draggy?.research
        ?.search(query, { runId: saved.id, limit: 5 })
        .catch(swallowed("research", "only the notes are searched", null));
      for (const hit of (pages?.hits ?? []).filter((entry) => entry.kind === "source").slice(0, 3)) {
        lines.push(`page ${hit.ref}: ${hit.snippet}`);
      }
    }
    if (lines.length === 0) {
      return saved
        ? "TOOL RESULT (search_notes): Nothing in the earlier research matches. Search the web for this."
        : "TOOL RESULT (search_notes): No notes match.";
    }
    return `TOOL RESULT (search_notes):\n${lines.join("\n")}`;
  },
};

const finishResearch: ToolSpec = {
  name: "finish_research",
  group: "web",
  description:
    "End gathering and get the checked notes and sources to write the report from. Cite notes by id in square brackets, like [n1].",
  parameters: {},
  required: [],
  usage: "{} → the notes and sources to cite",
  annotations: READ_ONLY,
  available: webOn,
  run: async (_args, ctx) => {
    const run = activeRun(ctx);
    if (!run) return "TOOL RESULT (finish_research): There is no research run.";
    // Searches alone give a report with nothing to cite, so the first early finish is turned back once.
    const refusedKey = `finish-refused:${run.id}`;
    const found = [...new Set(run.queries.flatMap((entry) => entry.urls))];
    if (run.status === "gathering" && run.notes.length === 0 && found.length > 0 && !ctx.memo.has(refusedKey)) {
      ctx.memo.set(refusedKey, true);
      return [
        "TOOL RESULT (finish_research): Not finished. No notes are kept, so the report would have no sources.",
        `Read the best search results with read_url, for example:\n${found.slice(0, 3).join("\n")}`,
        "After each useful page call add_note with the exact sentence it says, then call finish_research again.",
      ].join("\n\n");
    }
    const settled = await settleRun(ctx);
    const dropped = settled?.dropped ?? 0;
    const kept = run.notes.filter((note) => note.verified);
    const cited = new Set(kept.map((note) => note.sourceId));
    const sources = run.sources.filter((source) => cited.has(source.id));
    const gaps = coverage(run).filter((entry) => !entry.enough).map((entry) => `${entry.subQuestion}. ${entry.text}`);
    const parts = [
      "TOOL RESULT (finish_research): Write the report now. Answer the question first, then one section per sub-question. Cite every fact with its note id like [n1]; do not cite anything else. Write the report in the reply when it fits. When the user asked for a file, or it would run past about 1,500 words, write it with create_file and keep the reply to a short summary.",
      `Notes:\n${kept.map((note) => `${note.id} q${note.subQuestion} ${note.confidence}: ${note.claim}`).join("\n") || "(none)"}`,
      `Sources:\n${sources.map((source) => `${source.id} ${source.title} ${source.url}`).join("\n") || "(none)"}`,
    ];
    if (dropped > 0) parts.push(`${dropped} notes were left out because their quote was not found on the page.`);
    if (gaps.length > 0) parts.push(`Say plainly that these were not answered:\n${gaps.join("\n")}`);
    return parts.join("\n\n");
  },
};

export const RESEARCH_TOOLS: ToolSpec[] = [startResearch, addNoteTool, searchNotes, finishResearch];

export function registerResearchTools(): void {
  registerTools(RESEARCH_TOOLS);
}
