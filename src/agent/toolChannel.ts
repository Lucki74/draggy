import { parseToolCall } from "../toolParsing";
import type { ToolDefinition } from "../tools/registry";

/**
 * How a model is asked to call a tool. Ollama models differ wildly here, and
 * the difference is most of what "tool calling quality varies by model" means
 * in practice:
 *
 *  - `native`      the model advertises `tools`, so the call comes back in a
 *                  field and nothing has to be parsed out of prose.
 *  - `text`        it does not, so the tools are described in the prompt and
 *                  the call is written as `<tool>{...}</tool>`.
 *
 * A text-mode call that does not parse gets one repair pass, where the same
 * turn is re-asked with Ollama's `format` set to a JSON schema. That is
 * constrained decoding: the sampler cannot emit anything the schema forbids,
 * so the answer is valid by construction rather than parsed and hoped for.
 */

export type ToolChannel = "native" | "text";

export function chooseChannel(capabilities: string[] | undefined): ToolChannel {
  return capabilities?.includes("tools") ? "native" : "text";
}

/**
 * The schema a repair is asked for: which tool, and its arguments. The names
 * are listed so the model cannot invent one, which is the other half of what
 * constrained decoding buys.
 */
export function repairSchema(definitions: ToolDefinition[]) {
  const names = definitions.map((definition) => definition.function.name);

  return {
    type: "object",
    properties: {
      name: names.length > 0 ? { type: "string", enum: names } : { type: "string" },
      args: { type: "object" },
    },
    required: ["name", "args"],
  };
}

/** What the model is asked during a repair, in place of the mangled call. */
export function repairPrompt(broken: string): string {
  return `That tool call could not be read:

${broken.slice(0, 500)}

Send it again as JSON with exactly two keys: "name" for the tool and "args" for its arguments. No prose, no tags, no code fences.`;
}

export interface RepairedCall {
  name?: string;
  args?: Record<string, unknown>;
}

/**
 * Reads a repaired reply. It arrives as bare JSON because the schema said so,
 * but the ordinary parser is used anyway: a model that wraps it in a fence
 * after all is still telling the truth about what it wants to call.
 */
export function readRepair(raw: string): RepairedCall {
  const parsed = parseToolCall(raw);
  if (!parsed.name) return {};

  return { name: parsed.name, args: parsed.args ?? {} };
}

/**
 * Whether a piece of prose was trying to be a tool call. Used to decide if a
 * reply that did not parse is worth one repair pass, or is simply an answer
 * with a stray brace in it.
 */
export function looksLikeCall(text: string, names: string[]): boolean {
  if (!text) return false;

  const sample = text.slice(0, 4000);
  const mentionsTool = names.some((name) => sample.includes(name));

  return (
    mentionsTool &&
    (/<\s*(?:tool|tool_call|function|invoke)\b/i.test(sample) ||
      /"(?:name|tool|tool_name)"\s*:/i.test(sample))
  );
}
