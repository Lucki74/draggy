// Golden fixtures for the office document logic: writers (structure of the generated file), readers (text of
// the samples under shared/fixtures/documents/samples) and pure helpers. Each case calls electron/documents.cjs
// through documentsOffice.ts. core/crates/documents/tests/office_fixtures.rs runs the same inputs against the port.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_DIR, runCase, toFixtureJson } from "./documentsOffice";

type Case = { name: string; input: { fn: string; args: unknown[] }; expected: unknown };

const files = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.startsWith("documents-office-") && name.endsWith(".json"))
  .sort();

describe("documents office fixtures", () => {
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { cases: Case[] };
    describe(file, () => {
      for (const c of doc.cases) {
        it(c.name, async () => {
          const result = await runCase(c.input.fn, c.input.args);
          expect(toFixtureJson(result)).toEqual(c.expected);
        }, 15000);
      }
    });
  }
});
