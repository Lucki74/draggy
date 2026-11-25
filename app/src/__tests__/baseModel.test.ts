import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBaseModel, signatureOf } from "../stats/baseModel";
import type { PriceTable } from "../stats/cost";

const table = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../shared/pricing/prices.json"), "utf8")) as PriceTable;
const ids = Object.keys(table.providers.openrouter ?? {});
const fixture = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../shared/fixtures/base-model/cases.json"), "utf8"),
) as { cases: { name: string; metadata: Record<string, string>; expected: string | null }[] };

describe("base model resolver", () => {
  it.each(fixture.cases)("resolves $name to $expected", ({ name, metadata, expected }) => {
    expect(resolveBaseModel(name, ids, { baseModelOf: (repo) => metadata[repo] ?? null })).toBe(expected);
  });

  it("reads the family, version, size and active size from a name", () => {
    expect(signatureOf("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")).toEqual({ family: "qwen", version: "3.6", size: "35", active: "3", variant: "" });
  });

  it("follows a metadata chain to its root before matching", () => {
    const chain: Record<string, string> = { "a/Local-Finetune": "b/Middle-Tune", "b/Middle-Tune": "Qwen/Qwen3.6-35B-A3B" };
    expect(resolveBaseModel("a/Local-Finetune", ids, { baseModelOf: (repo) => chain[repo] ?? null })).toBe("qwen/qwen3.6-35b-a3b");
  });

  it("never returns a batch or colon variant", () => {
    expect(resolveBaseModel("Qwen3.7-Plus", ids)).not.toMatch(/:/);
  });
});
