/** Tells whether a model identifier points to a local GGUF file or a bare model tag. */
export function isGgufModel(model: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return lower.endsWith(".gguf") || lower.startsWith("gguf:");
}

/** Strips gguf prefix if present to obtain clean filename or path. */
export function ggufModelName(model: string): string {
  if (model.toLowerCase().startsWith("gguf:")) {
    return model.slice(5);
  }
  return model;
}
