import { describe, expect, it } from "vitest";
import { parseEvents } from "../settings/logLines";

const line = (extra: object) => JSON.stringify({ ts: "2026-01-02T03:04:05.000Z", level: "INFO", scope: "engine", msg: "started", ...extra });

describe("parseEvents", () => {
  it("keeps whole records and drops the line a tail cut in half", () => {
    const text = `ill":"x"}\n${line({ cid: "abc" })}\n${line({ level: "ERROR", msg: "failed" })}\n`;
    const parsed = parseEvents(text);
    expect(parsed.map((entry) => entry.msg)).toEqual(["started", "failed"]);
    expect(parsed[0].cid).toBe("abc");
  });

  it("skips records with an unknown level or no message", () => {
    expect(parseEvents(`${line({ level: "LOUD" })}\n${JSON.stringify({ level: "INFO" })}\n`)).toEqual([]);
  });
});
