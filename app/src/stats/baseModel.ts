/** Turns a local model into the priced cloud model it is built on, so each turn is priced by what its own model
 * costs through OpenRouter. Order: the base model named in the metadata (followed to the root), then the name.
 * A model that matches neither is unknown and stays out of the totals. Pure apart from the cache. */

import type { PriceEntry, PriceTable } from "./cost";

export interface BaseModelSources {
  /** The base model a repo or file names in its metadata (GGUF `general.base_model`, Hugging Face `cardData.base_model`), or null. */
  baseModelOf?: (repo: string) => string | null;
}

/** Words that describe how a model was tuned, not what it is. */
const TAGS = new Set(["instruct", "it", "chat", "preview", "base", "abliterated", "uncensored", "thinking", "reasoning", "heretic", "latest"]);

/** What a model is, once its publisher, quantization and tuning tags are gone. */
export interface ModelSignature {
  family: string;
  version: string;
  /** Total parameters in billions, such as "35". */
  size: string;
  /** Active parameters in billions for a mixture-of-experts model, such as "3". */
  active: string;
  /** Other words that name a variant, such as "coder" or "vl", sorted and joined with "-". */
  variant: string;
}

/** The words of a model name with the publisher, file wrapper, quantization suffix and tuning tags removed. */
function nameTokens(name: string): string[] {
  let text = name.trim().toLowerCase();
  if (text.startsWith("gguf:")) text = text.slice(5);
  const colon = text.indexOf(":");
  if (colon >= 0) text = text.slice(0, colon);
  text = text.slice(text.lastIndexOf("/") + 1).replace(/\.gguf$/, "").replace(/[-_]gguf\b/g, "");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/[-_](ud[-_])?(i?q\d[a-z0-9_]*|bf16|f16|fp16|f32|mxfp4|int[48])$/, "");
  } while (text !== previous);
  return text
    .split(/[-_\s]+/)
    .filter((token) => token && !TAGS.has(token));
}

/** The family, version, size and variant a model name describes, or null when it names no family. */
export function signatureOf(name: string): ModelSignature | null {
  const tokens = nameTokens(name);
  const head = /^([a-z]+)(\d+(?:\.\d+)?)?$/.exec(tokens[0] ?? "");
  if (!head) return null;
  let version = head[2] ?? "";
  let rest = tokens.slice(1);
  if (!version && rest[0] && /^\d+(\.\d+)?$/.test(rest[0])) {
    version = rest[0];
    rest = rest.slice(1);
  }
  let size = "";
  let active = "";
  const variant: string[] = [];
  for (const token of rest) {
    if (!size && /^\d+(\.\d+)?b$/.test(token)) size = token.slice(0, -1);
    else if (!active && /^a\d+(\.\d+)?b$/.test(token)) active = token.slice(1, -1);
    else if (/^\d+$/.test(token)) continue; // release dates such as 2507
    else variant.push(token);
  }
  return { family: head[1], version, size, active, variant: variant.sort().join("-") };
}

const sameSignature = (a: ModelSignature, b: ModelSignature) =>
  a.family === b.family && a.version === b.version && a.size === b.size && a.active === b.active && a.variant === b.variant;

/** The OpenRouter id a model name matches exactly, the shortest one when several do. Dated and batch variants lose to the plain id. */
function matchId(name: string, ids: readonly string[]): string | null {
  const wanted = signatureOf(name);
  if (!wanted) return null;
  let best: string | null = null;
  for (const id of ids) {
    if (id.includes(":")) continue;
    const found = signatureOf(id);
    if (!found || !sameSignature(found, wanted)) continue;
    if (best === null || id.length < best.length || (id.length === best.length && id < best)) best = id;
  }
  return best;
}

/** The OpenRouter id for a local model name, or null when no metadata or name match exists. */
export function resolveBaseModel(name: string, ids: readonly string[], sources: BaseModelSources = {}): string | null {
  let root = name;
  const seen = new Set<string>([name]);
  for (let depth = 0; depth < 8; depth++) {
    const next = sources.baseModelOf?.(root) ?? null;
    if (!next || seen.has(next)) break;
    seen.add(next);
    root = next;
  }
  if (root !== name) {
    const fromMetadata = matchId(root, ids);
    if (fromMetadata) return fromMetadata;
  }
  return matchId(name, ids);
}

/** Forgets every resolved name, so the next lookup reads the base model metadata again. */
export function forgetPriced(): void {
  cache.clear();
  cachedTable = null;
}

export interface PricedModel {
  /** The OpenRouter id the model is priced as. */
  id: string;
  price: PriceEntry;
}

const cache = new Map<string, PricedModel | null>();
let cachedTable: PriceTable | null = null;

/** The priced model for a local model file, looked up once per name and kept until the price table changes. */
export function pricedModelOf(name: string, table: PriceTable | null, sources: BaseModelSources = {}): PricedModel | null {
  const routed = table?.providers.openrouter;
  if (!routed) return null;
  if (table !== cachedTable) {
    cache.clear();
    cachedTable = table;
  }
  if (cache.has(name)) return cache.get(name) ?? null;
  const id = resolveBaseModel(name, Object.keys(routed), sources);
  const price = id ? (Object.hasOwn(routed, id) ? routed[id] : undefined) : undefined;
  const result = id && price ? { id, price } : null;
  cache.set(name, result);
  return result;
}
