import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { parsePlan, planSummary, renderPlan } from "../plan/plan";
import type { QuestionAnswer, QuestionItem, UserQuestion } from "../types";

/** The plan tool: the whole checklist in one string every call, the only shape small local models
 * get right reliably. */

const updatePlan: ToolSpec = {
  name: "update_plan",
  group: "plan",
  description:
    "Write or update the plan for this task. Send the whole list every time, one step per line, each marked [ ] for still to do, [>] for the one you are on, and [x] for done. Use it for work that takes several steps, and call it again as you finish each one.",
  parameters: {
    steps: {
      type: "string",
      description:
        "The whole plan, one step per line, for example: [x] Read the config\\n[>] Change the port\\n[ ] Run the tests",
    },
  },
  required: ["steps"],
  usage:
    '{"steps": "[x] Read the config\\n[>] Change the port\\n[ ] Run the tests"} → shows the user where you are',
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  // Plans are for work on a project; a chat answers instead.
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const items = parsePlan(String(args.steps ?? ""));

    if (items.length === 0) {
      return "TOOL RESULT (update_plan): That plan was empty. Send one step per line.";
    }

    ctx.onPlan?.(items);

    // One step in the timeline, the first time only: after that the panel is
    // where the plan lives, and a line per update would bury the work.
    if (!ctx.memo.has("plan:announced")) {
      ctx.memo.set("plan:announced", true);
      ctx.pushStep({
        id: ctx.newId(),
        type: "plan",
        content: `${ctx.t("planned")} **${items.length}**`,
        isComplete: true,
      });
      ctx.syncSteps();
    }

    const { done, total } = planSummary(items);

    return `TOOL RESULT (update_plan): Plan recorded, ${done} of ${total} done. The user can see it and may edit it.\n${renderPlan(items)}`;
  },
};

const MAX_OPTIONS = 8;
const MAX_FOLLOW_UPS = 4;

/** One option per line, with list bullets and numbers taken off. */
function readOptions(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split("\n");
  return lines
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
}

function readItem(text: string, rawOptions: unknown, multiple: boolean): QuestionItem {
  const options = readOptions(rawOptions);
  return { text, options, multiple: options.length > 1 && multiple };
}

/** The follow-ups a model sent as JSON. Anything that is not a usable question is dropped. */
function readMore(raw: unknown): QuestionItem[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .flatMap((entry): QuestionItem[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const text = String(item.question ?? item.text ?? "").trim();
        return text ? [readItem(text, item.options, item.multiple === true)] : [];
      })
      .slice(0, MAX_FOLLOW_UPS);
  } catch {
    return [];
  }
}

const said = (reply: QuestionAnswer | undefined) =>
  reply ? [...reply.choices, reply.text.trim()].filter(Boolean).join("; ") : "";

const askUser: ToolSpec = {
  name: "ask_user",
  group: "ask",
  description:
    "Ask the user a question and wait for the answer. Use it when the request is ambiguous or you cannot go on without a choice only they can make, such as which of two approaches to take. Give options for a pick, or none for a written answer. Put related questions in one call with more instead of asking one at a time. Do not use it for things you can find out or decide yourself.",
  parameters: {
    question: { type: "string", description: "The question, short and specific." },
    options: {
      type: "string",
      description: "The choices, one per line. Leave out for a written answer.",
    },
    multiple: { type: "boolean", description: "True when the user may pick more than one option." },
    more: {
      type: "string",
      description:
        'Follow-up questions for the same card, as a JSON list, at most four: [{"question": "...", "options": "A\\nB", "multiple": false}]',
    },
  },
  required: ["question"],
  usage:
    '{"question": "Which database should I use?", "options": "SQLite\\nPostgres"} → the option the user picked',
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: false,
    idempotentHint: false,
    openWorld: false,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const text = String(args.question ?? "").trim();
    if (!text) return "TOOL RESULT (ask_user): There was no question. Send the question text.";
    if (!ctx.askUser) {
      return "TOOL RESULT (ask_user): No one is there to answer. Choose yourself and say what you assumed.";
    }

    const more = readMore(args.more);
    const question: UserQuestion = {
      id: ctx.newId(),
      ...readItem(text, args.options, args.multiple === true),
      ...(more.length ? { more } : {}),
    };

    ctx.pushStep({ id: question.id, type: "question", content: ctx.t("questionAsked"), isComplete: false, question });
    ctx.syncSteps();

    const reply = await ctx.askUser(question);

    ctx.patchStep(question.id, { reply: reply ?? "cancelled", isComplete: true });
    ctx.syncSteps();

    if (!reply) {
      return "TOOL RESULT (ask_user): The user dismissed the question. Carry on with your best judgment, or say what you still need.";
    }
    if (!question.more) return `TOOL RESULT (ask_user): The user answered: ${said(reply)}`;

    const replies = [reply, ...(reply.more ?? [])];
    const lines = [question, ...question.more].map(
      (item, index) => `${index + 1}. ${item.text} → ${said(replies[index]) || "(no answer)"}`,
    );
    return `TOOL RESULT (ask_user): The user answered:\n${lines.join("\n")}`;
  },
};

export const PLAN_TOOLS: ToolSpec[] = [updatePlan, askUser];

export function registerPlanTools(): void {
  registerTools(PLAN_TOOLS);
}
