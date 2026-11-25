/** What a reply cost, from the tokens it used and a price table. Pure and free of I/O so the Rust twin
 * (core/crates/draggy-core/src/cost.rs) can be held to the same shared fixtures in shared/fixtures/cost.
 *
 * Money is counted in micro-dollars (1e-6 USD). A rate in dollars per million tokens times a token count is
 * already in micro-dollars, so the parts add exactly and rounding happens once, on the total. */

import { promptOf, type TokenUsage } from "./tokenUsage";

/** Dollars per million tokens. A missing cache or reasoning rate falls back as noted on each field. */
export interface PriceEntry {
  inputPerM: number;
  outputPerM: number;
  /** Defaults to the input rate: a provider that lists no cache discount charges cached tokens as input. */
  cacheReadPerM?: number;
  /** Defaults to the input rate. */
  cacheWritePerM?: number;
  /** Defaults to the output rate: thinking is billed as output almost everywhere. */
  reasoningPerM?: number;
  /** Rates that replace the base ones for the whole request once its prompt is larger than `aboveInputTokens`. */
  tiers?: PriceTier[];
}

export interface PriceTier {
  aboveInputTokens: number;
  inputPerM?: number;
  outputPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  reasoningPerM?: number;
}

export interface PriceTable {
  version: number;
  generatedAt: string;
  providers: Record<string, Record<string, PriceEntry>>;
}

/** Who pays: `billed` is an API key, `account` is a plan (value shown, nothing charged), `local` costs nothing. */
export type CostKind = "billed" | "account" | "local";

export interface CostParts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface Cost {
  /** Whole micro-dollars, or null when no price is known. Never 0 for "unknown": 0 would read as free. */
  micros: number | null;
  /** Micro-dollars per bucket as the table prices them; null when no table price was found. */
  parts: CostParts | null;
  /** `reported` is the provider's own figure, `table` was worked out here, `unknown` has no price. */
  source: "reported" | "table" | "unknown";
}

export const UNKNOWN_COST: Cost = { micros: null, parts: null, source: "unknown" };

/** Which price-table provider an account login is priced as (the vendor's own API list). */
export const PRICE_PROVIDER_OF_VENDOR: Readonly<Record<string, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
};

/** How OpenRouter spells each vendor in `vendor/model` ids. */
const OPENROUTER_VENDOR: Readonly<Record<string, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "google",
  xai: "x-ai",
  deepseek: "deepseek",
  mistral: "mistralai",
};

const SUFFIXES = [/-\d{8}$/, /-\d{4}-\d{2}-\d{2}$/, /-latest$/];

/** Spellings of one model id that a price table might use, most specific first. */
function candidates(provider: string, modelId: string): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (id && !out.includes(id)) out.push(id);
  };
  let id = modelId.trim();
  if (id.startsWith("models/")) id = id.slice("models/".length);
  add(id);
  add(id.toLowerCase());
  if (provider === "anthropic") add(id.toLowerCase().replace(/\./g, "-"));
  if (provider === "openrouter") add(id.replace(/:(online|nitro|floor|exacto)$/, ""));
  const lowered = id.toLowerCase();
  for (const suffix of SUFFIXES) {
    const stripped = lowered.replace(suffix, "");
    if (stripped !== lowered) {
      add(stripped);
      if (provider === "anthropic") add(stripped.replace(/\./g, "-"));
    }
  }
  return out;
}

/** The price of a model, or null when the table has none. A miss is never a zero price. */
export function lookupPrice(table: PriceTable | null | undefined, provider: string, modelId: string): PriceEntry | null {
  if (!table || !provider || !modelId) return null;
  const own = table.providers[provider];
  const ids = candidates(provider, modelId);
  if (own) {
    for (const id of ids) {
      const hit = Object.hasOwn(own, id) ? own[id] : undefined;
      if (hit) return hit;
    }
  }
  const prefix = OPENROUTER_VENDOR[provider];
  const routed = table.providers.openrouter;
  if (prefix && routed) {
    for (const id of ids) {
      const key = `${prefix}/${id}`;
      const hit = Object.hasOwn(routed, key) ? routed[key] : undefined;
      if (hit) return hit;
    }
  }
  return null;
}

const rate = (tier: PriceTier | undefined, key: keyof Omit<PriceTier, "aboveInputTokens">, base: number): number => tier?.[key] ?? base;

/** The rates in force for a request whose prompt had `promptTokens` tokens. The highest tier it passes wins. */
function ratesFor(price: PriceEntry, promptTokens: number) {
  let tier: PriceTier | undefined;
  for (const candidate of price.tiers ?? []) {
    if (promptTokens > candidate.aboveInputTokens && (!tier || candidate.aboveInputTokens > tier.aboveInputTokens)) tier = candidate;
  }
  const input = rate(tier, "inputPerM", price.inputPerM);
  const output = rate(tier, "outputPerM", price.outputPerM);
  return {
    input,
    output,
    cacheRead: rate(tier, "cacheReadPerM", price.cacheReadPerM ?? input),
    cacheWrite: rate(tier, "cacheWritePerM", price.cacheWritePerM ?? input),
    reasoning: rate(tier, "reasoningPerM", price.reasoningPerM ?? output),
  };
}

/** One request. A tier applies per request, so a turn of several passes is priced pass by pass and summed. */
export function costOf(usage: TokenUsage, price: PriceEntry | null | undefined): Cost {
  const reported = usage.costUsd !== undefined ? Math.round(usage.costUsd * 1e6) : null;
  if (!price) return reported === null ? UNKNOWN_COST : { micros: reported, parts: null, source: "reported" };
  const r = ratesFor(price, promptOf(usage));
  const parts: CostParts = {
    input: usage.input * r.input,
    cacheRead: usage.cacheRead * r.cacheRead,
    cacheWrite: usage.cacheWrite * r.cacheWrite,
    output: usage.output * r.output,
    reasoning: usage.reasoning * r.reasoning,
  };
  const total = parts.input + parts.cacheRead + parts.cacheWrite + parts.output + parts.reasoning;
  // toFixed first: 0.1 + 0.2 style noise must not tip a half micro-dollar the wrong way.
  const micros = reported ?? Math.round(Number(total.toFixed(6)));
  return { micros, parts, source: reported === null ? "table" : "reported" };
}

/** Several passes of one turn, each priced on its own. Unknown if any pass is: a partial sum would understate. */
export function costOfPasses(passes: readonly TokenUsage[], price: PriceEntry | null | undefined): Cost {
  if (passes.length === 0) return UNKNOWN_COST;
  let micros = 0;
  const parts: CostParts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  let known = true;
  let source: Cost["source"] = "table";
  let anyReported = false;
  let allParts = true;
  for (const pass of passes) {
    const cost = costOf(pass, price);
    if (cost.micros === null) {
      known = false;
      break;
    }
    micros += cost.micros;
    if (cost.source === "reported") anyReported = true;
    if (cost.parts) {
      for (const key of Object.keys(parts) as (keyof CostParts)[]) parts[key] += cost.parts[key];
    } else {
      allParts = false;
    }
  }
  if (!known) return UNKNOWN_COST;
  if (anyReported) source = "reported";
  return { micros, parts: allParts ? parts : null, source };
}

/** Provider kind to cost kind. The built-in engine has no provider and is local. */
export function costKindOf(providerKind: "cloud" | "local" | "account" | null | undefined): CostKind {
  if (providerKind === "cloud") return "billed";
  if (providerKind === "account") return "account";
  return "local";
}

const CURRENCY_FALLBACK = "USD";

export interface MoneyOptions {
  /** Prefix "~" for a figure that was estimated rather than recorded. */
  estimated?: boolean;
  /** Units of `currency` per dollar. */
  rate?: number;
  locale?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string | undefined, currency: string, small: boolean): Intl.NumberFormat {
  const key = `${locale ?? ""}|${currency}|${small}`;
  let format = formatters.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, small ? { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 } : { style: "currency", currency });
    } catch {
      format = new Intl.NumberFormat(locale, small ? { style: "currency", currency: CURRENCY_FALLBACK, minimumFractionDigits: 2, maximumFractionDigits: 4 } : { style: "currency", currency: CURRENCY_FALLBACK });
    }
    formatters.set(key, format);
  }
  return format;
}

/** Micro-dollars as text: two decimals from a cent up, four below it, "<$0.0001" under that, "~" when estimated. */
export function formatMoney(micros: number, currency = CURRENCY_FALLBACK, options: MoneyOptions = {}): string {
  const amount = (micros / 1e6) * (options.rate ?? 1);
  const mark = options.estimated ? "~" : "";
  if (amount <= 0) return `${mark}${formatter(options.locale, currency, false).format(0)}`;
  if (amount < 0.0001) return `${mark}<${formatter(options.locale, currency, true).format(0.0001)}`;
  return `${mark}${formatter(options.locale, currency, amount < 0.01).format(amount)}`;
}

/** A per-million rate for the tooltip: "$3 / M" with no trailing zeros. */
export function formatRate(perM: number, currency = CURRENCY_FALLBACK, options: Pick<MoneyOptions, "rate" | "locale"> = {}): string {
  return `${formatMoney(perM * 1e6, currency, options)} / M`;
}
