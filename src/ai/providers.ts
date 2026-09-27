/** Which engine a model reference points at. A name starting with `@` is a provider's model and never
 * reaches the built-in engine; anything else is a GGUF file, as every saved setting already is. */

export type ModelRef =
  | { kind: "builtin"; file: string }
  | { kind: "remote"; instanceId: string; modelId: string; valid: boolean };

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

/** The engine gets no provider fields, so its bodies stay byte-identical; a provider gets only the
 * states its own instance wrote, so a switch away and back sends the older ones again. */
export function scopeToTarget<M extends { provider_state?: ProviderState }>(messages: M[], model: string): M[] {
  const instance = providerOf(model);
  return messages.map((message) => {
    if (!message.provider_state || message.provider_state.instanceId === instance) return message;
    const { provider_state: _other, ...rest } = message;
    return rest as M;
  });
}
