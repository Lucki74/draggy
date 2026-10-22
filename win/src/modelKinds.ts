/** What a model can do, asked of the engine rather than guessed from its name. The two questions fail
 * opposite ways: unknown may chat, but may not index. */

/** Whether this model is unable to hold a conversation. Silence, meaning no capabilities at all, is
 * not an answer, and reads as no objection. */
export function cannotGenerate(capabilities: string[] | undefined): boolean {
  if (!capabilities || capabilities.length === 0) return false;
  return !capabilities.includes("completion");
}

/** Whether this model can turn text into vectors for the library. */
export function isEmbeddingModel(capabilities: string[] | undefined): boolean {
  return capabilities?.includes("embedding") ?? false;
}

/** Whether this model draws pictures. They have a folder of their own, and this keeps one that
 * strays out of every chat list anyway. */
/** What the app cannot run yet, so a model that does only these is not offered for download. */
const UNSUPPORTED_ABILITIES = [
  "speech-recognition",
  "text-to-speech",
  "audio-generation",
  "audio-processing",
  "video-generation",
  "3d-generation",
];

export function isRunnable(capabilities: string[] | undefined): boolean {
  return !UNSUPPORTED_ABILITIES.some((ability) => capabilities?.includes(ability));
}

export function isImageModel(capabilities: string[] | undefined): boolean {
  return capabilities?.includes("image-generation") ?? false;
}

/** Narrows installed models to the ones worth offering, in chat and Talk alike: both rule out
 * exactly the models that cannot generate text. */
export function selectableModels<T extends { capabilities: string[] }>(
  models: T[],
): T[] {
  return models.filter((entry) => !cannotGenerate(entry.capabilities) && !isImageModel(entry.capabilities));
}
