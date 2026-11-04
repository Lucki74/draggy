// Golden fixture for the sandbox environment scrub. core/crates/tools/tests/fixtures_sandbox.rs runs the same
// inputs against the Rust port, so both must agree.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const policy = require("../../../electron/sandboxPolicy.cjs") as { isSecretName: (name: string) => boolean; scrubEnv: (env: Record<string, string>) => Record<string, string> };
const file = path.resolve(import.meta.dirname, "../../../../shared/fixtures/tools/sandbox-env.json");
const fixture = JSON.parse(fs.readFileSync(file, "utf8")) as { cases: { name: string; input: { name: string }; expected: { secret: boolean } }[] };

describe("sandbox env fixtures", () => {
  for (const one of fixture.cases) {
    it(one.name, () => expect({ secret: policy.isSecretName(one.input.name) }).toEqual(one.expected));
  }

  it("scrubEnv keeps ordinary variables and drops secrets", () => {
    expect(policy.scrubEnv({ PATH: "/bin", GH_TOKEN: "x", HOME: "/h" })).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});
