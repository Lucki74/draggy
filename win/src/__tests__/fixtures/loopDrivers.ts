// Drivers for the agent-loop skill and prepareTurn fixtures. The runner and the generator both call them, so the
// expected values are what the TypeScript reference returns when driven with the same stubs as the Rust side.
import { vi } from "vitest";
import { defaultSettings } from "../../app/settings";
import { prepareTurn, resetTailNotesForTests } from "../../agent/agentLoop";
import type { TurnInput } from "../../agent/agentLoop";
import { forgetModelInfo } from "../../llama";
import { resetRegistry, runTool } from "../../tools/registry";
import type { ToolContext, ToolEnvironment } from "../../tools/registry";
import { registerSkillTools } from "../../tools/skills";
import { renderSkillFile, skillsFor } from "../../skills/skills";
import type { SkillSurface } from "../../skills/skills";
import type { AppSettings, InstalledSkill, LoadedSkill, Message, SearchStep } from "../../types";

type Json = Record<string, unknown>;

/** JSON has no undefined: a driver's value is compared as its JSON form. */
const asJson = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** `skillsFor` for a side: the ids offered, in shelf order. */
export function skillsForCase(input: Json): unknown {
  return skillsFor(input.skills as InstalledSkill[], input.side as SkillSurface).map((skill) => skill.id);
}

/** `renderSkillFile`: one file that came with a skill. */
export function renderSkillFileCase(input: Json): unknown {
  return renderSkillFile(input.skill as LoadedSkill, input.file as { name: string; content: string });
}

/** The `use_skill` tool, run through the registry. `read` is what the main process answers; `bridge: false` is a build
 * with no skill bridge at all. The result, the timeline it leaves and every read the tool made are returned. */
export async function useSkillCase(input: Json): Promise<unknown> {
  const reads: unknown[] = [];
  const read = vi.fn(async (workspaceId: string, id: string, options: { enabledOnly: boolean; file?: string }) => {
    reads.push({ workspace: workspaceId, id, enabledOnly: options.enabledOnly, file: options.file ?? null });
    return asJson(input.read);
  });
  vi.stubGlobal("window", { electronAPI: input.bridge === false ? {} : { skills: { read } } });

  resetRegistry();
  registerSkillTools();
  const steps: SearchStep[] = [];
  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    workspaceId: "w1",
    pushStep: (step) => steps.push(step),
    patchStep: (id, patch) => {
      const index = steps.findIndex((entry) => entry.id === id);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal: new AbortController().signal,
    memo: new Map<string, unknown>(),
  };
  const args: Record<string, unknown> = { id: input.id };
  if (input.file !== undefined) args.file = input.file;
  const environment: ToolEnvironment = { webMode: "on", codeExecution: false, libraryReady: false, hasSkills: true };

  const result = await runTool("use_skill", args, context, environment);
  vi.unstubAllGlobals();
  return { result, steps: asJson(steps), reads };
}

/** `prepareTurn` for one turn, or for each of `turns` in order, with the same conversation state carried across them.
 * The model's probe, the skill shelf and each skill's readable body are stubbed; the clock and date are pinned. */
export async function prepareTurnCase(input: Json): Promise<unknown> {
  const { turns, ...base } = input;
  const turnList = (turns as Json[] | undefined) ?? [{}];
  const shelf = (base.skills ?? []) as InstalledSkill[];
  const bodies = (base.bodies ?? {}) as Record<string, { body: string; files: string[] }>;
  const model = (base.model as string | undefined) ?? "qwen-model";

  forgetModelInfo(model);
  resetTailNotesForTests();
  resetRegistry();
  registerSkillTools();

  let reads: string[][] = [];
  vi.stubGlobal("window", {
    electronAPI: {
      gguf: {
        listModels: async () => [
          { filename: model, contextLength: 32768, capabilities: (base.capabilities ?? []) as string[] },
        ],
      },
      skills: {
        list: async () => ({ success: true, skills: asJson(shelf) }),
        read: async (workspace: string, id: string) => {
          reads.push([workspace, id]);
          const installed = shelf.find((skill) => skill.id === id);
          const body = bodies[id];
          if (!installed || !body) return { success: false, error: `There is no skill called "${id}".` };
          return { success: true, skill: asJson({ ...installed, body: body.body, files: body.files }) };
        },
      },
    },
  });

  const outputs: unknown[] = [];
  for (const entry of turnList) {
    const turn = { ...base, ...entry };
    reads = [];
    const settings = { ...defaultSettings, modelName: model, ...(turn.settings as Partial<AppSettings>) };
    const dateSpy = vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue(String(turn.date));
    const timeSpy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue(String(turn.now));
    try {
      const prepared = await prepareTurn({
        model,
        settings,
        environment: turn.environment as ToolEnvironment,
        messages: turn.messages as Message[],
        workspaceId: (turn.workspaceId as string | undefined) ?? "default",
        isContinuation: Boolean(turn.isContinuation),
        seed: (turn.seed ?? null) as TurnInput["seed"],
        compaction: (turn.compaction ?? null) as TurnInput["compaction"],
      });
      outputs.push({
        wire: asJson(prepared.wire),
        invokedSkill: asJson(prepared.invokedSkill),
        nativeTools: prepared.nativeTools,
        nativeThinking: prepared.nativeThinking,
        cleanStream: prepared.cleanStream,
        tools: prepared.definitions.map((definition) => definition.function.name),
        promptParts: asJson({
          systemChars: prepared.promptParts.systemChars,
          memoryChars: prepared.promptParts.memoryChars,
          skillChars: prepared.promptParts.skillChars,
          summaryChars: prepared.promptParts.summaryChars,
          loadedSkillChars: prepared.promptParts.loadedSkillChars,
          loadedSkills: prepared.promptParts.loadedSkills,
          toolCount: prepared.promptParts.toolCount,
          skillCount: prepared.promptParts.skillCount,
        }),
        reads,
      });
    } finally {
      dateSpy.mockRestore();
      timeSpy.mockRestore();
    }
  }
  vi.unstubAllGlobals();
  return outputs.length === 1 ? outputs[0] : outputs;
}
