import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { countSilentCatches } = require("../../scripts/silentCatches.cjs") as {
  countSilentCatches: (root?: string) => Record<string, number>;
};

/** A catch that must stay silent (the logger files cannot log their own failures) carries a
 * `silent-ok:` comment. Everything else logs with `log.swallow` / `logSwallow` / `swallowed`. */
describe("silent catches", () => {
  it("has no catch block or .catch(() => {}) without a silent-ok comment", () => {
    expect(countSilentCatches()).toEqual({});
  });
});
