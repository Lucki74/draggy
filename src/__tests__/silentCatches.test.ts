import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { countSilentCatches } = require("../../scripts/silentCatches.cjs") as {
  countSilentCatches: (root?: string) => Record<string, number>;
};

/** The logger files report their own failures to stderr, since logging through themselves would loop.
 * Everything else logs a swallowed error with `log.swallow` / `logSwallow` / `swallowed`. */
const REVIEWED = {
  "electron/ipcLog.cjs": 1,
  "electron/lifecycleLog.cjs": 1,
  "electron/logger.cjs": 1,
  "electron/spawnLog.cjs": 1,
  "src/logger.ts": 1,
};

describe("silent catches", () => {
  it("has no catch block or .catch(() => {}) outside the reviewed logger files", () => {
    const found = countSilentCatches();
    const unexpected = Object.fromEntries(Object.entries(found).filter(([file, n]) => n > ((REVIEWED as Record<string, number>)[file] ?? 0)));
    expect(unexpected).toEqual({});
  });
});
