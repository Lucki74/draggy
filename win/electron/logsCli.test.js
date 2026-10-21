import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const cli = require("../scripts/logs.cjs");

let dir;
const now = Date.now();
const at = (msAgo) => new Date(now - msAgo).toISOString();
const event = (extra) => JSON.stringify({ session: "s1", proc: "main", scope: "boot", msg: "x", level: "INFO", ...extra });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-logs-cli-"));
  fs.writeFileSync(
    path.join(dir, "events.jsonl.1"),
    `${event({ ts: at(900000), msg: "old", scope: "engine.llama" })}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    [
      event({ ts: at(3000), seq: 1, proc: "renderer", scope: "chat", msg: "turn sent", cid: "c1" }),
      event({ ts: at(2900), seq: 2, scope: "providers.gateway", msg: "engine responded", cid: "c1", data: { status: 200 } }),
      event({ ts: at(2000), seq: 3, scope: "mcp", msg: "tool call", cid: "c2" }),
      event({ ts: at(1000), seq: 4, level: "ERROR", scope: "engine.llama", msg: "crashed", err: { name: "Error", code: "EX", message: "bad" } }),
      "{not json",
    ].join("\n"),
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const lines = (args) => {
  const out = [];
  const code = cli.run(["--dir", dir, "--no-color", ...args], (line) => out.push(line));
  return { out, code };
};

describe("logs cli", () => {
  it("prints one turn across processes in order, with offsets", () => {
    const { out } = lines(["--turn", "c1"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("renderer");
    expect(out[0]).toContain("+     0 ms");
    expect(out[1]).toContain("providers.gateway");
    expect(out[1]).toContain('{"status":200}');
  });

  it("filters by level, scope prefix and age", () => {
    expect(lines(["--level", "warn"]).out).toHaveLength(1);
    expect(lines(["--scope", "engine"]).out).toHaveLength(2);
    expect(lines(["--since", "10m"]).out).toHaveLength(4);
  });

  it("shows the error code and skips a broken line", () => {
    const { out } = lines(["--level", "error"]);
    expect(out[0]).toContain("Error EX: bad");
  });

  it("says so and exits 1 when nothing matches", () => {
    const { out, code } = lines(["--cid", "none"]);
    expect(code).toBe(1);
    expect(out[0]).toContain("no matching lines");
  });

  it("rejects a bad option or duration", () => {
    expect(() => cli.parseArgs(["--since", "soon"])).toThrow();
    expect(() => cli.parseArgs(["--nope"])).toThrow();
    expect(() => lines(["--turn"])).toThrow();
  });
});

describe("a turn with a continue and a retry", () => {
  const chain = () =>
    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      [
        event({ ts: at(5000), seq: 1, proc: "renderer", scope: "chat", msg: "turn sent", cid: "a" }),
        event({ ts: at(4900), seq: 2, scope: "agent", msg: "stopped on length", cid: "a" }),
        event({ ts: at(4000), seq: 3, proc: "renderer", scope: "chat", msg: "turn sent", cid: "b", data: { after: "a", continuation: true } }),
        event({ ts: at(3000), seq: 4, proc: "renderer", scope: "chat", msg: "turn sent", cid: "c", data: { after: "b", retry: true } }),
        event({ ts: at(2000), seq: 5, proc: "renderer", scope: "chat", msg: "turn sent", cid: "other" }),
      ].join("\n"),
    );

  it("follows the links from any turn in the chain, both ways", () => {
    chain();
    for (const start of ["a", "b", "c"]) {
      const { out } = lines(["--turn", start]);
      expect(out).toHaveLength(4);
      expect(out.join("\n")).not.toContain("other");
    }
  });

  it("leaves an unlinked turn alone", () => {
    chain();
    expect(lines(["--turn", "other"]).out).toHaveLength(1);
  });
});
