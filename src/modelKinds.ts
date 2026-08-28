/**
 * Which installed models are fit to hold a conversation.
 *
 * Two kinds are not:
 *
 * An embedding model turns text into vectors and cannot generate a reply at
 * all. Choosing one leaves the user with a chat that answers nothing, so it is
 * never offered.
 *
 * A helper-sized model can technically reply, just poorly. It is hidden when
 * the machine has something better installed, but never when it is the only
 * thing available: the smallest models are also the recommended main model for
 * a machine with very little memory, and refusing to run them there would
 * leave that user with nothing at all.
 */

const SMALL_MODEL_NAMES = [
  "smollm2:360m",
  "qwen3:0.6b",
  "llama3.2:1b",
  "qwen3:1.7b",
  "gemma3:1b",
];

export const HELPER_MODELS: ReadonlySet<string> = new Set(SMALL_MODEL_NAMES);

/**
 * Families whose whole purpose is embeddings. Matched on the name because it
 * is known before any request is made; the capability list from Ollama is used
 * as well wherever it has already been fetched.
 */
const EMBEDDING_PATTERNS: RegExp[] = [
  /embed/i,
  /^bge[-:]/i,
  /^gte[-:]/i,
  /^e5[-:]/i,
  /^mxbai[--]?embed/i,
  /minilm/i,
  /^paraphrase[-:]/i,
];

function baseName(model: string): string {
  return model.trim().toLowerCase();
}

export function isEmbeddingModel(model: string): boolean {
  const name = baseName(model);
  return EMBEDDING_PATTERNS.some((pattern) => pattern.test(name));
}

export function isHelperModel(model: string): boolean {
  const name = baseName(model);
  if (HELPER_MODELS.has(name)) return true;

  // "llama3.2:1b" and "llama3.2:1b-instruct-q4" are the same model to a user.
  const family = name.split(":")[0];
  const tag = name.split(":")[1] ?? "";
  for (const helper of HELPER_MODELS) {
    const [helperFamily, helperTag] = helper.split(":");
    if (helperFamily === family && helperTag && tag.startsWith(helperTag)) {
      return true;
    }
  }

  return false;
}

/**
 * Capabilities reported by Ollama, when they are already known. A model that
 * cannot complete text cannot chat, whatever it is called.
 */
export function cannotGenerate(capabilities: string[] | undefined): boolean {
  if (!capabilities || capabilities.length === 0) return false;
  return !capabilities.includes("completion");
}

export type ChatBlock = "embedding" | "helper" | null;

/**
 * Why this model is not offered as the model to chat with, if it is not.
 * `alternatives` is how many other usable models exist, which decides whether
 * a helper-sized model can be spared.
 */
export function chatBlock(model: string, alternatives: number): ChatBlock {
  if (isEmbeddingModel(model)) return "embedding";
  if (isHelperModel(model) && alternatives > 0) return "helper";
  return null;
}

export function isChatModel(model: string, alternatives: number): boolean {
  return chatBlock(model, alternatives) === null;
}

/** How many of these could actually be someone's main model. */
export function countUsable(names: string[]): number {
  return names.filter((name) => !isEmbeddingModel(name) && !isHelperModel(name))
    .length;
}

/**
 * Narrows a list of installed models to the ones worth offering for chat.
 */
export function selectableChatModels<T extends { name: string }>(
  models: T[],
): T[] {
  const usable = countUsable(models.map((entry) => entry.name));
  return models.filter((entry) => isChatModel(entry.name, usable));
}

/** The same decision for a plain list of names. */
export function selectableChatModelNames(names: string[]): string[] {
  const usable = countUsable(names);
  return names.filter((name) => isChatModel(name, usable));
}

/**
 * Which installed models may answer out loud.
 *
 * Talk judges a model by how quickly it starts speaking, not by how much it can
 * hold in its head, so the helper-sized models that are hidden from the chat
 * picker belong here: on a small machine they are the only thing that can
 * answer inside a conversational pause. Embedding models still cannot generate
 * a reply at all, so they stay out.
 */
export function selectableVoiceModels<T extends { name: string }>(
  models: T[],
): T[] {
  return models.filter((entry) => !isEmbeddingModel(entry.name));
}
