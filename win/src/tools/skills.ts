import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { renderSkill, renderSkillFile } from "../skills/skills";

/** Fetches a skill's instructions by id, once the model has picked one from the names and
 * descriptions in the prompt, and any file that came with it. */

const useSkill: ToolSpec = {
  name: "use_skill",
  group: "skill",
  description:
    "Load one of the skills listed in your instructions, by its id. Call it before starting the job it describes, then follow what it says. To read a file that came with a skill, pass the file as well.",
  parameters: {
    id: {
      type: "string",
      description: "The skill's id, exactly as it appears in the list.",
    },
    file: {
      type: "string",
      description:
        "Optional. One of the files the skill listed when it was loaded, for example templates/report.md.",
    },
  },
  required: ["id"],
  usage: '{"id": "invoices"} → the instructions that skill holds',
  // Reading instructions changes nothing, so it runs in every mode including plan mode, where
  // knowing the rules is what planning needs.
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasSkills),
  run: async (args, ctx) => {
    const id = String(args.id);
    const file = typeof args.file === "string" && args.file.trim() ? args.file.trim() : undefined;
    const stepId = ctx.newId();
    const label = file ? `${id}/${file}` : id;

    ctx.pushStep({
      id: stepId,
      type: "skill",
      content: `${ctx.t("usingSkill")} **${label}**`,
      isComplete: false,
    });

    const result = await window.electronAPI?.skills?.read(ctx.workspaceId || "default", id, {
      enabledOnly: true,
      file,
    });

    if (!result?.success || !result.skill) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (use_skill): ${result?.error || "Skills are not available in this build."}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("usedSkill")} **${file ? label : result.skill.name}**`,
      // Instructions stay loaded for the rest of the conversation; a file read once does not.
      ...(file ? {} : { skill: result.skill.id }),
    });
    ctx.syncSteps();

    if (file && result.file) {
      return `TOOL RESULT (use_skill):\n${renderSkillFile(result.skill, result.file)}`;
    }

    return `TOOL RESULT (use_skill):\n${renderSkill(result.skill)}`;
  },
};

export const SKILL_TOOLS: ToolSpec[] = [useSkill];

export function registerSkillTools(): void {
  registerTools(SKILL_TOOLS);
}
