import type { InstalledSkill, LoadedSkill, Message } from "../types";

/** Skills as the model meets them: only names and descriptions in the prompt, keeping many
 * affordable; a body arrives when the model picks one. */

/** Anything longer than this in the prompt is a skill list nobody reads. */
export const MAX_LISTED_SKILLS = 40;

export type SkillSurface = "chat" | "code";

/** The skills switched on for one side. A skill with no side of its own is offered on both. */
export function skillsFor(skills: InstalledSkill[], surface: SkillSurface): InstalledSkill[] {
  return skills.filter(
    (skill) =>
      skill.enabled !== false && (!skill.surface || skill.surface === "both" || skill.surface === surface),
  );
}

export function describeSkills(skills: InstalledSkill[]): string {
  const offered = skills.filter((skill) => skill.modelInvocable !== false);
  if (offered.length === 0) return "";

  const lines = offered
    .slice(0, MAX_LISTED_SKILLS)
    .map((skill) =>
      skill.name === skill.id
        ? `- ${skill.id}: ${skill.description}`
        : `- ${skill.id}: ${skill.name}. ${skill.description}`,
    );

  return `SKILLS

Skills are instructions for particular kinds of job, some shipped with Draggy and some written by the user. The description says when each one applies.

${lines.join("\n")}

When a request matches one, call use_skill with its id before you start, and follow what it says. When none of them matches, work as you normally would and do not mention them.`;
}

export async function loadSkills(
  workspaceId: string,
  surface: SkillSurface,
): Promise<InstalledSkill[]> {
  const result = await window.electronAPI?.skills
    ?.list(workspaceId)
    .catch(() => undefined);

  return result?.success ? skillsFor(result.skills ?? [], surface) : [];
}

/** What the model is handed when it asks for one. */
export function renderSkill(skill: LoadedSkill): string {
  const files =
    skill.files.length > 0
      ? `\n\nFiles that came with it. Read one with use_skill, passing this skill's id and the file:\n${skill.files
          .map((name) => `- ${name}`)
          .join("\n")}`
      : "";

  return `SKILL: ${skill.name}\n\n${skill.body}${files}`;
}

export function renderSkillFile(skill: LoadedSkill, file: { name: string; content: string }): string {
  return `SKILL FILE: ${skill.id}/${file.name}\n\n${file.content}`;
}

/** A message that starts with a skill's slash command, as in "/code-review src/app.ts". */
export function skillInvocation(
  text: string,
  skills: InstalledSkill[],
): { skill: InstalledSkill; request: string } | null {
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  if (!match) return null;

  const skill = skills.find((one) => one.id.toLowerCase() === match[1].toLowerCase());
  return skill ? { skill, request: (match[2] ?? "").trim() } : null;
}

/** What a slash command adds to the message it starts. The instructions themselves sit with the
 * other loaded skills in the system prompt. */
export function renderInvokedSkill(skill: InstalledSkill, request: string): string {
  const task = request
    ? `The request that came with it: ${request}`
    : "It came with no further request, so ask what the user wants it applied to if that is not clear from the conversation.";

  return `The user started this message with /${skill.id}, which runs the ${skill.name} skill. Its instructions are loaded under LOADED SKILLS in your instructions, so there is no need to call use_skill for it. ${task}`;
}

/** Loaded skills kept at once. Each stays for the rest of the conversation, and a small window
 * cannot carry a shelf of them. */
export const MAX_LOADED_SKILLS = 5;

/** The skills a conversation has loaded, most recent last: by the model through use_skill, or by
 * the user with a slash command. Only ones still offered on this side count. */
export function loadedSkillIds(messages: Message[], skills: InstalledSkill[]): string[] {
  const offered = new Set(skills.map((skill) => skill.id));
  const order: string[] = [];

  const note = (id: string | undefined) => {
    if (!id || !offered.has(id)) return;
    const at = order.indexOf(id);
    if (at !== -1) order.splice(at, 1);
    order.push(id);
  };

  for (const message of messages) {
    if (message.role === "user") {
      note(skillInvocation(message.content, skills)?.skill.id);
      continue;
    }

    for (const step of message.steps ?? []) {
      if (step.type === "skill" && step.isComplete) note(step.skill);
    }
  }

  return order.slice(-MAX_LOADED_SKILLS);
}

/** The instructions of every loaded skill, kept in the system prompt so later turns still follow
 * them, as they would with the skill's text still in the conversation. */
export function renderLoadedSkills(loaded: LoadedSkill[]): string {
  if (loaded.length === 0) return "";

  return `LOADED SKILLS

These skills were loaded earlier in this conversation. Keep following them wherever they apply, without calling use_skill for them again.

${loaded.map(renderSkill).join("\n\n---\n\n")}`;
}
