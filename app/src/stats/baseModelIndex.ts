/** The base model each installed GGUF file names in its header, read through the models list. The resolver asks
 * this for `baseModelOf`; a refresh runs before each stats load and drops the resolved names when the list changed. */

import type { BaseModelSources } from "./baseModel";
import { forgetPriced } from "./baseModel";
import { logSwallow } from "../logger";

/** File name (as the models list gives it) to the first base model repo id the header names. */
let baseByFile = new Map<string, string>();

function lookup(name: string): string | null {
  const bare = name.replace(/^gguf:/i, "").split(":")[0];
  return baseByFile.get(name) ?? baseByFile.get(bare) ?? null;
}

/** Re-reads the installed models. A failed read keeps the last answer. */
async function refresh(): Promise<void> {
  let models;
  try {
    models = await window.draggy?.gguf?.listModels();
  } catch (error) {
    logSwallow("stats", error, "model list read failed: keeps the last answer");
    return;
  }
  if (!Array.isArray(models)) return;
  const next = new Map<string, string>();
  for (const model of models) {
    const base = model.baseModels?.[0];
    if (base) next.set(model.filename, base);
  }
  const same = next.size === baseByFile.size && [...next].every(([file, base]) => baseByFile.get(file) === base);
  if (same) return;
  baseByFile = next;
  forgetPriced();
}

export const installedBaseModels: BaseModelSources & { refresh: () => Promise<void> } = {
  baseModelOf: lookup,
  refresh,
};
