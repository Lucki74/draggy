/** Which engine a model reference points at. A name starting with `@` is a provider's model and never
 * reaches the built-in engine; anything else is a GGUF file, as every saved setting already is. */

export type ModelRef =
  | { kind: "builtin"; file: string }
  | { kind: "remote"; instanceId: string; modelId: string; valid: boolean };

import type { Message, ProviderInstance, ProviderModel } from "../types";
import type { PromptProfile } from "../prompts";

/** What a provider hands back to be sent again later, tagged with the instance it belongs to. */
export interface ProviderState {
  instanceId: string;
  state: unknown;
}

/** The gateway every model request goes through, built-in or remote; the body's model says which. */
export const CHAT_ENDPOINT = "draggy-ai://chat";

export function parseRef(model: string): ModelRef {
  const name = String(model ?? "");
  if (!name.startsWith("@")) return { kind: "builtin", file: name.replace(/^gguf:/, "") };

  // The model id may itself hold "/" or ":", so only the first slash separates the two.
  const slash = name.indexOf("/");
  const instanceId = slash === -1 ? name.slice(1) : name.slice(1, slash);
  const modelId = slash === -1 ? "" : name.slice(slash + 1);
  return { kind: "remote", instanceId, modelId, valid: instanceId.length > 0 && modelId.length > 0 };
}

export function isRemote(model: string): boolean {
  return parseRef(model).kind === "remote";
}

/** The provider instance a remote model belongs to; null for the built-in engine. */
export function providerOf(model: string): string | null {
  const ref = parseRef(model);
  return ref.kind === "remote" ? ref.instanceId : null;
}

export function chatEndpoint(_model: string): string {
  return CHAT_ENDPOINT;
}

/** A provider's model as its provider lists it; null when the provider is gone, off or unreachable. */
export async function remoteModelInfo(model: string): Promise<(ProviderModel & { promptProfile: PromptProfile }) | null> {
  const ref = parseRef(model);
  if (ref.kind !== "remote" || !ref.valid || typeof window === "undefined") return null;
  try {
    const api = window.electronAPI?.providers;
    // The instance only picks the prompt; a failed lookup costs the full prompt, never the model's info.
    const [answer, instances] = await Promise.all([api?.models(ref.instanceId), api?.list?.().catch(() => [])]);
    const found = answer?.success ? answer.models.find((m) => m.id === ref.modelId) : undefined;
    const instance = instances?.find((item) => item.id === ref.instanceId);
    return found ? { ...found, promptProfile: promptProfileFor(model, instance, found) } : null;
  } catch {
    return null;
  }
}

const LARGE_CONTEXT = 65536;
const LARGE_PARAMETERS_B = 30;

/** Which system prompt a model gets: the instance's choice, else `full` for the cloud and for a local
 * server's large model, and `compact` for everything else, the built-in engine always. */
export function promptProfileFor(
  model: string,
  instance: Pick<ProviderInstance, "kind" | "promptProfile"> | null | undefined,
  listed: Pick<ProviderModel, "id" | "contextLength"> | null | undefined,
): PromptProfile {
  if (!isRemote(model) || !instance) return "compact";
  if (instance.promptProfile && instance.promptProfile !== "auto") return instance.promptProfile;
  if (instance.kind !== "local") return "full";
  const billions = Number(/(\d+(?:\.\d+)?)b(?![a-z])/i.exec(listed?.id ?? model)?.[1] ?? 0);
  return (listed?.contextLength ?? 0) >= LARGE_CONTEXT || billions >= LARGE_PARAMETERS_B ? "full" : "compact";
}

export interface ModelGroup {
  instanceId: string;
  label: string;
  kind: ProviderInstance["kind"];
  models: ProviderModel[];
}

/** Every enabled provider's ticked models, under its label; the engine's own come from `listInstalledModels`.
 * A ticked model its listing lacks still shows, knowing nothing, so an offline provider keeps its place. */
export async function listAllModels(): Promise<ModelGroup[]> {
  const api = typeof window === "undefined" ? undefined : window.electronAPI?.providers;
  if (!api) return [];
  const instances = (await api.list().catch(() => [])).filter((instance) => instance.enabled);
  return Promise.all(
    instances.map(async (instance) => {
      const answer = await api.models(instance.id).catch(() => null);
      const listed = answer?.success ? answer.models : [];
      const models = instance.pinnedModels.map(
        (id) =>
          listed.find((model) => model.id === id) ?? {
            id,
            ref: `@${instance.id}/${id}`,
            contextLength: null,
            maxOutputTokens: null,
            capabilities: ["completion"],
            cloud: instance.kind !== "local",
            pinned: true,
            override: null,
          },
      );
      return { instanceId: instance.id, label: instance.label, kind: instance.kind, models };
    }),
  );
}

/** The engine gets no provider fields, so its bodies stay byte-identical; a provider gets only the
 * states its own instance wrote, so a switch away and back sends the older ones again. */
export function scopeToTarget<M extends { provider_state?: ProviderState; draggy_ref?: DraggyRef }>(
  messages: M[],
  model: string,
): M[] {
  const instance = providerOf(model);
  return messages.map((message) => {
    const foreign = message.provider_state !== undefined && message.provider_state.instanceId !== instance;
    const engine = instance === null && message.draggy_ref !== undefined;
    if (!foreign && !engine) return message;
    const kept = { ...message };
    if (foreign) delete kept.provider_state;
    if (engine) delete kept.draggy_ref;
    return kept;
  });
}

/** Which stored message a wire message is, so a stateful provider can tell what its thread has seen. */
export interface DraggyRef {
  id: string;
  hash: string;
}

/** Over the message as stored, never the wire: the time note and skill text change every turn and
 * would make each turn's history look rewritten. */
export async function draggyRef(message: Message): Promise<DraggyRef> {
  const attachments = (message.attachments ?? []).map(({ name, type, content }) => [name, type, content]);
  const bytes = new TextEncoder().encode(JSON.stringify([message.role, message.content ?? "", attachments]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { id: message.id, hash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") };
}
