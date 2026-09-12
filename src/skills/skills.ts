import type { InstalledSkill, LoadedSkill } from "../types";

/**
 * Skills as the model meets them. Only the names and the descriptions go into
 * the prompt, which is what keeps a shelf full of them affordable; the body of
 * one arrives when the model decides it is the one it needs.
 */

/** Anything longer than this in the prompt is a skill list nobody reads. */
export const MAX_LISTED_SKILLS = 40;

export function describeSkills(skills: InstalledSkill[]): string {
  if (skills.length === 0) return "";

  const lines = skills
    .slice(0, MAX_LISTED_SKILLS)
    .map((skill) => `- ${skill.id}: ${skill.name}. ${skill.description}`);

  return `SKILLS

The user has written these down for you. Each is a set of instructions for one kind of job, and the description says when it applies.

${lines.join("\n")}

When a request matches one, call use_skill with its id before you start, and follow what it says. When none of them matches, work as you normally would and do not mention them.`;
}

export async function loadSkills(
  workspaceId: string,
): Promise<InstalledSkill[]> {
  const result = await window.electronAPI?.skills
    ?.list(workspaceId)
    .catch(() => undefined);

  return result?.success ? (result.skills ?? []) : [];
}

/** What the model is handed when it asks for one. */
export function renderSkill(skill: LoadedSkill): string {
  const files =
    skill.files.length > 0
      ? `\n\nFiles that came with it, in ${skill.path}:\n${skill.files
          .map((name) => `- ${name}`)
          .join("\n")}`
      : "";

  return `SKILL: ${skill.name}\n\n${skill.body}${files}`;
}
