import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { renderSkill } from "../skills/skills";

/**
 * Reaching for a skill. The list in the prompt is names and descriptions only,
 * so this is how the instructions themselves arrive: asked for by id, once the
 * model has decided which one the job needs.
 */

const useSkill: ToolSpec = {
  name: "use_skill",
  group: "skill",
  description:
    "Load one of the skills listed in your instructions, by its id. Call it before starting the job it describes, then follow what it says.",
  parameters: {
    id: {
      type: "string",
      description: "The skill's id, exactly as it appears in the list.",
    },
  },
  required: ["id"],
  usage: '{"id": "invoices"} → the instructions that skill holds',
  // Reading the user's own notes: it changes nothing, so it runs in every mode
  // including plan mode, where knowing the rules is what planning needs.
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasSkills),
  run: async (args, ctx) => {
    const id = String(args.id);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "skill",
      content: `${ctx.t("usingSkill")} **${id}**`,
      isComplete: false,
    });

    const result = await window.electronAPI?.skills?.read(
      ctx.workspaceId || "default",
      id,
    );

    if (!result?.success || !result.skill) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (use_skill): ${result?.error || "Skills are not available in this build."}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("usingSkill")} **${result.skill.name}**`,
    });
    ctx.syncSteps();

    return `TOOL RESULT (use_skill):\n${renderSkill(result.skill)}`;
  },
};

export const SKILL_TOOLS: ToolSpec[] = [useSkill];

export function registerSkillTools(): void {
  registerTools(SKILL_TOOLS);
}
