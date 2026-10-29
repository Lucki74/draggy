import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costKindOf, costOf, formatMoney, formatRate, lookupPrice, type PriceTable } from "../stats/cost";

const table: PriceTable = {
  version: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  providers: {
    anthropic: { "claude-sonnet-4-5": { inputPerM: 3, outputPerM: 15 } },
    openai: { "gpt-4o": { inputPerM: 2.5, outputPerM: 10 } },
    gemini: { "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 } },
    openrouter: {
      "anthropic/claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
      "meta/free-model:free": { inputPerM: 0, outputPerM: 0 },
      "openai/gpt-5-mini": { inputPerM: 0.25, outputPerM: 2 },
    },
  },
};

describe("looking a price up", () => {
  it("finds an exact id", () => {
    expect(lookupPrice(table, "openai", "gpt-4o")?.inputPerM).toBe(2.5);
  });

  it("ignores a dated suffix and a dotted version", () => {
    expect(lookupPrice(table, "openai", "gpt-4o-2024-11-20")?.inputPerM).toBe(2.5);
    expect(lookupPrice(table, "anthropic", "claude-sonnet-4-5-20250929")?.inputPerM).toBe(3);
    expect(lookupPrice(table, "anthropic", "claude-sonnet-4.5")?.inputPerM).toBe(3);
    expect(lookupPrice(table, "gemini", "models/gemini-2.5-pro")?.inputPerM).toBe(1.25);
  });

  it("falls back to the router's vendor/model entry", () => {
    expect(lookupPrice(table, "anthropic", "claude-haiku-4-5")?.outputPerM).toBe(5);
    expect(lookupPrice(table, "openai", "gpt-5-mini")?.inputPerM).toBe(0.25);
  });

  it("drops an OpenRouter routing suffix but keeps :free, which is its own price", () => {
    expect(lookupPrice(table, "openrouter", "anthropic/claude-haiku-4-5:online")?.inputPerM).toBe(1);
    expect(lookupPrice(table, "openrouter", "meta/free-model:free")?.inputPerM).toBe(0);
  });

  it("returns null, never a zero price, for a model it does not know", () => {
    expect(lookupPrice(table, "openai", "no-such-model")).toBeNull();
    expect(lookupPrice(table, "nobody", "gpt-4o")).toBeNull();
    expect(lookupPrice(null, "openai", "gpt-4o")).toBeNull();
    expect(lookupPrice(table, "openai", "constructor")).toBeNull();
  });
});

describe("the parts add up to the total", () => {
  it("holds for any split", () => {
    const price = { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75, reasoningPerM: 12 };
    for (let n = 1; n < 40; n++) {
      const usage = { input: n * 37, cacheRead: n * 911, cacheWrite: n * 13, output: n * 59, reasoning: n * 7, source: "reported" as const };
      const cost = costOf(usage, price);
      const sum = Object.values(cost.parts ?? {}).reduce((a, b) => a + b, 0);
      expect(cost.micros).toBe(Math.round(Number(sum.toFixed(6))));
    }
  });
});

describe("the bundled price table", () => {
  const file = path.resolve(import.meta.dirname, "../../../shared/pricing/prices.json");
  const bundled = JSON.parse(fs.readFileSync(file, "utf8")) as PriceTable;

  it("prices the models Draggy offers by default", () => {
    expect(lookupPrice(bundled, "openai", "gpt-4o")).not.toBeNull();
    expect(lookupPrice(bundled, "anthropic", "claude-sonnet-4-5")).not.toBeNull();
    expect(lookupPrice(bundled, "gemini", "gemini-2.5-pro")).not.toBeNull();
    expect(lookupPrice(bundled, "deepseek", "deepseek-chat")).not.toBeNull();
  });

  it("holds only sane numbers", () => {
    for (const models of Object.values(bundled.providers)) {
      for (const price of Object.values(models)) {
        for (const value of [price.inputPerM, price.outputPerM, price.cacheReadPerM, price.cacheWritePerM, price.reasoningPerM]) {
          if (value !== undefined) expect(value >= 0 && Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});

describe("kinds", () => {
  it("maps a provider kind to who pays", () => {
    expect(costKindOf("cloud")).toBe("billed");
    expect(costKindOf("account")).toBe("account");
    expect(costKindOf("local")).toBe("local");
    expect(costKindOf(null)).toBe("local");
  });
});

describe("showing money", () => {
  it("uses two decimals from a cent up and four below", () => {
    expect(formatMoney(12_345_000, "USD", { locale: "en-US" })).toBe("$12.35");
    expect(formatMoney(9_500, "USD", { locale: "en-US" })).toBe("$0.0095");
    expect(formatMoney(10_500, "USD", { locale: "en-US" })).toBe("$0.01");
    expect(formatMoney(3_100, "USD", { locale: "en-US" })).toBe("$0.0031");
    expect(formatMoney(3_000, "USD", { locale: "en-US" })).toBe("$0.003");
    expect(formatMoney(10_000, "USD", { locale: "en-US" })).toBe("$0.01");
  });

  it("floors tiny amounts and shows a plain zero", () => {
    expect(formatMoney(50, "USD", { locale: "en-US" })).toBe("<$0.0001");
    expect(formatMoney(0, "USD", { locale: "en-US" })).toBe("$0.00");
  });

  it("marks an estimate and converts at the given rate", () => {
    expect(formatMoney(2_000_000, "USD", { locale: "en-US", estimated: true })).toBe("~$2.00");
    expect(formatMoney(2_000_000, "EUR", { locale: "en-US", rate: 0.9 })).toBe("€1.80");
  });

  it("falls back to dollars for a currency it cannot format", () => {
    expect(formatMoney(2_000_000, "NOPE", { locale: "en-US" })).toBe("$2.00");
  });

  it("writes a rate per million", () => {
    expect(formatRate(3, "USD", { locale: "en-US" })).toBe("$3.00 / M");
  });
});
