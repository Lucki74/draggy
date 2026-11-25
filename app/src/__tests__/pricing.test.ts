import { describe, expect, it } from "vitest";
import type { PriceTable } from "../stats/cost";
import { costFields, createTurnPricer, priceProviderOf } from "../stats/pricing";
import type { TokenUsage } from "../stats/tokenUsage";
import type { ProviderInstance } from "../types";

const table: PriceTable = {
  version: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  providers: {
    openai: { "gpt-4o": { inputPerM: 2.5, outputPerM: 10 } },
    anthropic: { "claude-sonnet-4-5": { inputPerM: 3, outputPerM: 15 } },
    gemini: { "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 } },
  },
};

const instance = (type: string, kind: ProviderInstance["kind"]) => ({ type, kind }) as ProviderInstance;

const usage = (extra: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 1000,
  cacheRead: 0,
  cacheWrite: 0,
  output: 500,
  reasoning: 0,
  source: "reported",
  ...extra,
});

const metrics = (passUsage?: TokenUsage[]) => ({ promptTokens: 1000, responseTokens: 500, passUsage });

describe("which price list a provider is priced under", () => {
  it("uses the catalog id for a cloud provider", () => {
    expect(priceProviderOf(instance("openai", "cloud"))).toBe("openai");
    expect(priceProviderOf(instance("gemini", "cloud"))).toBe("gemini");
  });

  it("prices an account login as its vendor's API", () => {
    expect(priceProviderOf(instance("chatgpt", "account"))).toBe("openai");
    expect(priceProviderOf(instance("claude", "account"))).toBe("anthropic");
    expect(priceProviderOf(instance("google", "account"))).toBe("gemini");
  });

  it("has none for a custom server, a local server or an unknown provider", () => {
    expect(priceProviderOf(instance("custom", "cloud"))).toBeNull();
    expect(priceProviderOf(instance("ollama", "local"))).toBeNull();
    expect(priceProviderOf(undefined)).toBeNull();
  });
});

describe("pricing a finished turn", () => {
  it("prices an API-key turn from its token split", () => {
    const fields = costFields("@openai/gpt-4o", metrics([usage()]), instance("openai", "cloud"), table);
    expect(fields).toMatchObject({
      providerId: "openai",
      kind: "billed",
      inputTokens: 1000,
      outputTokens: 500,
      costMicros: 7500,
      costSource: "table",
      priceUpdatedAt: table.generatedAt,
    });
  });

  it("sums the passes and prices each on its own", () => {
    const two = [usage({ input: 1000, output: 100 }), usage({ input: 2000, output: 200 })];
    const fields = costFields("@openai/gpt-4o", metrics(two), instance("openai", "cloud"), table);
    expect(fields.inputTokens).toBe(3000);
    expect(fields.outputTokens).toBe(300);
    expect(fields.costMicros).toBe(2500 + 1000 + 5000 + 2000);
  });

  it("marks an account login as account, still with a value", () => {
    const fields = costFields("@claude/claude-sonnet-4-5", metrics([usage()]), instance("claude", "account"), table);
    expect(fields.kind).toBe("account");
    expect(fields.costMicros).toBe(3000 + 7500);
  });

  it("leaves a local or built-in turn without a cost", () => {
    const builtin = costFields("qwen3-8b.gguf", metrics(), undefined, table);
    expect(builtin).toMatchObject({ providerId: null, kind: "local", costMicros: null, costSource: null });

    const local = costFields("@ollama/llama3", metrics([usage()]), instance("ollama", "local"), table);
    expect(local).toMatchObject({ providerId: "ollama", kind: "local", costMicros: null, inputTokens: 1000 });
  });

  it("says unknown, not free, for a model with no price", () => {
    const fields = costFields("@openai/never-heard-of-it", metrics([usage()]), instance("openai", "cloud"), table);
    expect(fields.costMicros).toBeNull();
    expect(fields.costSource).toBe("unknown");
  });

  it("says unknown when the table could not be read", () => {
    const fields = costFields("@openai/gpt-4o", metrics([usage()]), instance("openai", "cloud"), null);
    expect(fields.costMicros).toBeNull();
    expect(fields.costSource).toBe("unknown");
  });

  it("prices from the totals, flagged as an estimate, when the provider gave no split", () => {
    const fields = costFields("@openai/gpt-4o", metrics(), instance("openai", "cloud"), table);
    expect(fields.costMicros).toBe(7500);
    expect(fields.costSource).toBe("estimated");
  });

  it("prefers the figure the provider reported", () => {
    const fields = costFields("@openai/gpt-4o", metrics([usage({ costUsd: 0.5 })]), instance("openai", "cloud"), table);
    expect(fields.costMicros).toBe(500_000);
    expect(fields.costSource).toBe("reported");
  });

  it("treats a provider that was removed since as unpriced rather than local", () => {
    const fields = costFields("@gone/gpt-4o", metrics([usage()]), undefined, table);
    expect(fields.kind).toBe("local");
  });
});

describe("the turn pricer", () => {
  it("looks the table and the providers up once", async () => {
    let tables = 0;
    let lists = 0;
    const pricer = createTurnPricer({
      table: async () => (tables++, table),
      instances: async () => (lists++, [{ id: "openai", type: "openai", kind: "cloud" } as ProviderInstance]),
    });

    const first = await pricer.price("@openai/gpt-4o", metrics([usage()]));
    await pricer.price("@openai/gpt-4o", metrics([usage()]));

    expect(first.costMicros).toBe(7500);
    expect([tables, lists]).toEqual([1, 1]);

    pricer.reset();
    await pricer.price("@openai/gpt-4o", metrics([usage()]));
    expect([tables, lists]).toEqual([2, 2]);
  });

  it("survives a lookup that throws", async () => {
    const pricer = createTurnPricer({
      table: () => Promise.reject(new Error("offline")),
      instances: () => Promise.reject(new Error("no bridge")),
    });
    const fields = await pricer.price("@openai/gpt-4o", metrics([usage()]));
    expect(fields.costMicros).toBeNull();
  });
});
