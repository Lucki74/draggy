import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { parsePlan, planSummary, renderPlan } from "../plan/plan";

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

const askUser: ToolSpec = {
  name: "ask_user",
  group: "plan",
  description:
    "Ask the user a question and wait for the answer. Use it when you cannot go on without a choice only they can make, such as which of two approaches to take. Give options for a pick, or none for a written answer. Do not use it for things you can find out or decide yourself.",
  parameters: {
    question: { type: "string", description: "The question, short and specific." },
    options: {
      type: "string",
      description: "The choices, one per line. Leave out for a written answer.",
    },
    multiple: { type: "boolean", description: "True when the user may pick more than one option." },
  },
  required: ["question"],
  // Left out of the compact list that small models see; they can still call it.
  extended: true,
  available: (environment) => Boolean(environment.hasFolder),
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

    const options = String(args.options ?? "")
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    const question = { id: ctx.newId(), text, options, multiple: options.length > 1 && args.multiple === true };

    ctx.pushStep({ id: question.id, type: "question", content: ctx.t("questionAsked"), isComplete: false, question });
    ctx.syncSteps();

    const reply = await ctx.askUser(question);

    ctx.patchStep(question.id, { reply: reply ?? "cancelled", isComplete: true });
    ctx.syncSteps();

    if (!reply) {
      return "TOOL RESULT (ask_user): The user dismissed the question. Carry on with your best judgment, or say what you still need.";
    }
    const parts = [...reply.choices, reply.text.trim()].filter(Boolean);
    return `TOOL RESULT (ask_user): The user answered: ${parts.join("; ")}`;
  },
};

export const PLAN_TOOLS: ToolSpec[] = [updatePlan, askUser];

export function registerPlanTools(): void {
  registerTools(PLAN_TOOLS);
}
