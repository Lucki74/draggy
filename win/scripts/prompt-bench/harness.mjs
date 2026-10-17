/**
 * Builds the messages a turn would send, from the production prompt builders loaded through Vite.
 *
 * `buildCase` mirrors `prepareTurn` in src/agent/agentLoop.ts for one conversation: the same system
 * prompt, the same tools, the same tail note on the last user message. When the production code moves,
 * this file is the one adapter that follows it.
 */

const TOOL_MODULES = [
  ["builtin", "registerBuiltinTools"],
  ["files", "registerFileTools"],
  ["plan", "registerPlanTools"],
  ["skills", "registerSkillTools"],
  ["explore", "registerExploreTools"],
  ["git", "registerGitTools"],
  ["commands", "registerCommandTools"],
];

const CHAT_ENVIRONMENT = { webMode: "auto", codeExecution: false, libraryReady: false, hasSkills: false };
const CODE_ENVIRONMENT = {
  ...CHAT_ENVIRONMENT,
  hasFolder: true,
  projectRoot: "C:\\projects\\demo",
  hasGit: true,
  canRunCommands: true,
};

export async function loadHarness(server) {
  const prompts = await server.ssrLoadModule("/src/prompts.ts");
  const registry = await server.ssrLoadModule("/src/tools/registry.ts");
  for (const [file, register] of TOOL_MODULES) (await server.ssrLoadModule(`/src/tools/${file}.ts`))[register]();
  const parsing = await server.ssrLoadModule("/src/toolParsing.ts");
  const settingsDefaults = { effort: "medium", webMode: "auto", customInstructions: [], language: "en", slowModelThinking: false };

  const requiredArgs = Object.fromEntries(registry.allTools().map((spec) => [spec.name, spec.required ?? []]));

  /** Every tool call in a reply: the native ones, else the one the text channel parsed. */
  function readToolCalls(message) {
    const native = (message.tool_calls ?? []).map((call) => {
      let args = call.function?.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      return { name: call.function?.name ?? "", args: args ?? {} };
    });
    if (native.length) return native;
    const raw = parsing.detectToolCall(message.content ?? "");
    if (!raw) return [];
    const parsed = parsing.parseToolCall(raw);
    return parsed.name ? [{ name: parsed.name, args: parsed.args ?? {} }] : [];
  }

  /**
   * @param {object} options
   * @param {"chat"|"code"|"voice"} options.surface
   * @param {string} options.tier         "compact" | "full" (micro arrives with its own builder)
   * @param {string[]} options.caps       model capabilities: tools, thinking, vision
   * @param {{role:string,content:string}[]} options.turns
   * @param {string} options.lang
   * @param {object} [options.variant]    optional text overrides from scripts/prompt-bench/variants
   */
  function buildCase({ surface, tier, caps, turns, lang, variant, settings: overrides = {} }) {
    if (surface === "voice") {
      const system = prompts.buildVoicePrompt(false, []);
      const text = variant?.voice ? variant.voice({ lang, tier }, system) : system;
      return { system: text, messages: [{ role: "system", content: text }, ...turns], tools: [], nativeTools: false, definitions: [], thinkingFlag: caps.includes("thinking") ? false : null };
    }

    const requested = { ...settingsDefaults, ...overrides, language: lang };
    const has = (name) => caps.includes(name);
    // A model that cannot call tools is given none, and one that cannot think is not asked to.
    const cannotUseTools = !has("tools");
    const cannotThink = !has("thinking");
    const settings = {
      ...requested,
      ...(cannotUseTools ? { webMode: "off" } : {}),
      ...(cannotThink ? { effort: "off" } : {}),
    };
    const baseEnvironment = surface === "code" ? CODE_ENVIRONMENT : CHAT_ENVIRONMENT;
    const environment = cannotUseTools ? registry.withoutTools(baseEnvironment) : baseEnvironment;
    const nativeTools = has("tools");
    const nativeThinking = has("thinking") && settings.effort !== "off";
    const definitions = registry.toolDefinitions(environment);

    let system = prompts.buildSystemPrompt(settings, { nativeTools, nativeThinking, profile: tier }, environment, null, []);
    if (variant?.system) system = variant.system({ lang, tier, surface, settings }, system);

    const lastUser = turns.length - 1;
    const messages = [{ role: "system", content: system }];
    turns.forEach((turn, index) => {
      if (index !== lastUser) return messages.push(turn);
      const base = prompts.currentTimeNote();
      const note = variant?.tail ? variant.tail({ lang, tier, text: turn.content }, base) : base;
      messages.push({ ...turn, content: note ? `${turn.content}\n\n${note}` : turn.content });
    });

    return {
      system,
      messages,
      nativeTools,
      definitions: nativeTools ? definitions : [],
      thinkingFlag: has("thinking") ? nativeThinking : null,
    };
  }

  return { buildCase, readToolCalls, requiredArgs, prompts, registry };
}
