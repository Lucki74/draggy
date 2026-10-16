// Golden fixtures for the MCP client: recorded JSON-RPC sessions over stdio and HTTP, the line framing, tool answers, names
// and the server config model. Each case replays the input through electron/mcp.cjs with the process and HTTP scripted, and
// checks what the reference returns, wrote on the wire and logged. core/crates/mcp/tests/mcp_session.rs runs the same inputs
// against the Rust client, so both must agree.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSessionCase } from "./mcpSessionRunner";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/mcp");

describe("mcp session fixtures", () => {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.startsWith("mcp-session-") && name.endsWith(".json"))
    .sort();

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      cases: { name: string; input: unknown; expected: unknown }[];
    };

    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          expect(await runSessionCase(file, testCase.input)).toEqual(testCase.expected);
        });
      }
    });
  }
});
