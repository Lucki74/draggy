import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { parsePlan, planSummary, renderPlan } from "../plan/plan";

/**
 * The plan tool. One string, one call: the model sends the whole checklist
 * every time rather than patching a list it cannot see, which is the only
 * shape a small local model gets right reliably.
 */

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
  // It changes the conversation, not the world, so it runs in every mode
  // including plan mode, where writing the plan is the whole point.
  annotations: { readOnly: true, idempotent: true },
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

export const PLAN_TOOLS: ToolSpec[] = [updatePlan];

export function registerPlanTools(): void {
  registerTools(PLAN_TOOLS);
}
