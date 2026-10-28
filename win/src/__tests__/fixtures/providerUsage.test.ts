// Golden fixtures for the token split each provider reports (electron/providers/usage.cjs).
// core/crates/providers/tests/fixtures.rs runs the same file against the Rust port.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const usage = require("../../../electron/providers/usage.cjs");
const FILE = path.resolve(import.meta.dirname, "../../../../shared/fixtures/providers/usage.json");

interface UsageCase {
  name: string;
  input: { vendor: string; payload: Record<string, unknown> };
  expected: unknown;
}

const build = (vendor: string, payload: Record<string, unknown>): unknown => {
  switch (vendor) {
    case "anthropic":
      return usage.fromAnthropic(payload);
    case "openai":
      return usage.fromOpenAI(payload);
    case "gemini":
      return usage.fromGemini(payload);
    case "codex":
      return usage.fromCodex(payload);
    case "totals":
      return usage.fromTotals(payload.prompt, payload.output);
    default:
      throw new Error(`unknown vendor ${vendor}`);
  }
};

describe("providerUsage fixtures", () => {
  const { cases } = JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: UsageCase[] };
  for (const c of cases) {
    it(c.name, () => {
      expect(build(c.input.vendor, c.input.payload)).toEqual(c.expected);
    });
  }
});
