/**
 * What a model can do, asked of Ollama rather than guessed from its name. The
 * two questions fail opposite ways: unknown may chat, but may not index.
 */

/**
 * Whether this model is unable to hold a conversation. Silence — no
 * capabilities at all — is not an answer, and reads as no objection.
 */
export function cannotGenerate(capabilities: string[] | undefined): boolean {
  if (!capabilities || capabilities.length === 0) return false;
  return !capabilities.includes("completion");
}

/** Whether this model can turn text into vectors for the library. */
export function isEmbeddingModel(capabilities: string[] | undefined): boolean {
  return capabilities?.includes("embedding") ?? false;
}

/**
 * Narrows installed models to the ones worth offering, in chat and Talk alike:
 * both rule out exactly the models that cannot generate text.
 */
export function selectableModels<T extends { capabilities: string[] }>(
  models: T[],
): T[] {
  return models.filter((entry) => !cannotGenerate(entry.capabilities));
}
