/**
 * What an installed model is actually able to do.
 *
 * Ollama reports this per model through `/api/show`, and `listInstalledModels`
 * carries it on every entry it returns. Asking the server beats reading the
 * name: a name is a guess that happens to catch `nomic-embed-text`, misses any
 * embedding model whose author did not use the word, and has nothing at all to
 * say about a model somebody built themselves.
 *
 * The two questions below fail in opposite directions, on purpose. A model
 * whose capabilities could not be read is still offered for chat, because
 * hiding someone's only model over one failed request is the worse mistake. It
 * is not offered for indexing, because a model that cannot embed fills the
 * library with vectors that mean nothing and reports no error while doing it.
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
 * Narrows a list of installed models to the ones worth offering, in the chat
 * picker and in Talk alike. Talk judges a model by how quickly it starts
 * speaking rather than by how much it knows, but the models that fail that
 * test are the same ones: the ones that cannot generate text at all.
 */
export function selectableModels<T extends { capabilities: string[] }>(
  models: T[],
): T[] {
  return models.filter((entry) => !cannotGenerate(entry.capabilities));
}
