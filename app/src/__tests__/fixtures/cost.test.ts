// Golden fixtures for the cost engine (src/stats/cost.ts). core/crates/draggy-core/tests/fixtures.rs runs the same
// files against the Rust port, so both must price every case to the same micro-dollar.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costOf, costOfPasses, type Cost, type CostParts, type PriceEntry } from "../../stats/cost";
import type { TokenUsage } from "../../stats/tokenUsage";

const FILE = path.resolve(import.meta.dirname, "../../../../shared/fixtures/cost/cost.json");

interface CostCase {
  name: string;
  input: { usage?: TokenUsage; passes?: TokenUsage[]; price: PriceEntry | null };
  expected: { micros: number | null; source: Cost["source"]; parts?: CostParts };
}

describe("cost fixtures", () => {
  const { cases } = JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: CostCase[] };
  for (const c of cases) {
    it(c.name, () => {
      const cost = c.input.passes ? costOfPasses(c.input.passes, c.input.price) : costOf(c.input.usage as TokenUsage, c.input.price);
      expect(cost.micros).toBe(c.expected.micros);
      expect(cost.source).toBe(c.expected.source);
      if (c.expected.parts) expect(cost.parts).toEqual(c.expected.parts);
    });
  }
});
