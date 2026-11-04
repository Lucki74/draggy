import { describe, expect, it } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { runElevated, elevationScript, batchText, DECLINED } = require("./elevate.cjs");

describe("elevate", () => {
  it("puts the command in a batch file so no quoting crosses PowerShell", () => {
    expect(batchText("sc query spooler", "C:\Proj")).toBe('@echo off\r\ncd /d "C:\Proj"\r\nsc query spooler\r\n');
  });

  it("asks for the UAC prompt through RunAs and waits", () => {
    const script = elevationScript("C:\t\run.cmd", "C:\t\out.txt");
    expect(script).toContain("-Verb RunAs");
    expect(script).toContain("-Wait");
    expect(script).toContain(`exit ${DECLINED}`);
  });

  it("refuses off Windows and for an empty command", async () => {
    expect((await runElevated({ command: "ls", cwd: ".", platform: "linux" })).success).toBe(false);
    expect((await runElevated({ command: " ", cwd: ".", platform: "win32" })).success).toBe(false);
  });

  it("reports a declined prompt", async () => {
    const fake = () => {
      const handlers = {};
      const child = { on: (name, fn) => (handlers[name] = fn), kill() {} };
      setTimeout(() => handlers.close(DECLINED), 5);
      return child;
    };
    const result = await runElevated({ command: "whoami", cwd: process.cwd(), platform: "win32", spawnFn: fake });
    expect(result.declined).toBe(true);
    expect(result.success).toBe(false);
  });
});
