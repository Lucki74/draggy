import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_CAP,
  detectChecks,
  failureReport,
  isRefusedResult,
  isSuccessfulEdit,
  backgroundTaskId,
  nextStep,
  outcomeOf,
  parseExitCode,
  readLintConfig,
  runnableChecks,
  trimFailure,
} from "../agent/lintLoop";

const node = JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc -b", test: "vitest run" } });

describe("detectChecks", () => {
  it("reads package.json scripts in run order", () => {
    expect(detectChecks({ "package.json": node }).map((c) => c.command)).toEqual([
      "npm run lint",
      "npm run typecheck",
      "npm test -- -q",
    ]);
  });

  it("finds cargo and pytest checks and skips missing scripts", () => {
    const checks = detectChecks({
      "Cargo.toml": "[package]",
      "pyproject.toml": "[tool.ruff]\n[tool.pytest.ini_options]",
    });
    expect(checks.map((c) => c.command)).toEqual([
      "cargo clippy --all-targets -- -D warnings",
      "cargo test -q",
      "ruff check .",
      "pytest -q --tb=line",
    ]);
  });

  it("returns nothing for a broken or empty manifest", () => {
    expect(detectChecks({ "package.json": "{not json" })).toEqual([]);
    expect(detectChecks({})).toEqual([]);
  });
});

describe("runnableChecks", () => {
  const detected = detectChecks({ "package.json": node });

  it("runs nothing until the user confirmed this exact list", () => {
    expect(runnableChecks({ enabled: true, confirmed: [] }, detected)).toEqual([]);
    expect(runnableChecks(undefined, detected)).toEqual([]);
  });

  it("runs the confirmed list when the loop is on", () => {
    expect(runnableChecks({ enabled: true, confirmed: detected }, detected)).toEqual(detected);
  });

  it("runs nothing when the loop is toggled off", () => {
    expect(runnableChecks({ enabled: false, confirmed: detected }, detected)).toEqual([]);
  });

  it("drops confirmation when a script body changes under the same command", () => {
    const edited = detectChecks({ "package.json": JSON.stringify({ scripts: { lint: "eslint . --max-warnings 0" } }) });
    expect(edited[0].command).toBe("npm run lint");
    expect(runnableChecks({ enabled: true, confirmed: detected }, edited)).toEqual([]);
  });

  it("drops confirmation when Cargo.toml or pyproject.toml changes", () => {
    const before = detectChecks({ "Cargo.toml": "[package]\nname = \"a\"" });
    const after = detectChecks({ "Cargo.toml": "[package]\nname = \"b\"" });
    expect(runnableChecks({ enabled: true, confirmed: before }, after)).toEqual([]);
    const py = detectChecks({ "pyproject.toml": "[tool.ruff]\n" });
    expect(runnableChecks({ enabled: true, confirmed: py }, detectChecks({ "pyproject.toml": "[tool.ruff]\nline-length = 1\n" }))).toEqual([]);
  });

  it("drops confirmation when the manifest changes the commands", () => {
    const changed = detectChecks({ "package.json": JSON.stringify({ scripts: { lint: "eslint --fix ." } }) });
    expect(runnableChecks({ enabled: true, confirmed: detected }, changed)).toEqual([]);
  });
});

describe("failureReport and trimFailure", () => {
  it("returns null when every check passed", () => {
    const outcomes = [{ check: { id: "lint" as const, command: "npm run lint" }, exitCode: 0, output: "ok" }];
    expect(failureReport(outcomes)).toBeNull();
  });

  it("reports only failed checks with their output", () => {
    const outcomes = [
      { check: { id: "lint" as const, command: "npm run lint" }, exitCode: 0, output: "ok" },
      { check: { id: "test" as const, command: "npm test -- -q" }, exitCode: 1, output: "FAIL a.test" },
    ];
    expect(failureReport(outcomes)).toBe("npm test -- -q exited 1:\nFAIL a.test");
  });

  it("keeps the tail of long output", () => {
    const long = `${"x".repeat(50)}END`;
    expect(trimFailure(long, 10)).toBe("...xxxxxxxEND");
    expect(trimFailure("short", 10)).toBe("short");
  });
});

describe("nextStep", () => {
  it("passes without retry when checks are green", () => {
    expect(nextStep(true, 1)).toBe("pass");
  });

  it("retries until the cap, then stops", () => {
    expect(DEFAULT_RETRY_CAP).toBe(2);
    expect(nextStep(false, 1)).toBe("retry");
    expect(nextStep(false, 2)).toBe("stop");
    expect(nextStep(false, 1, 1)).toBe("stop");
  });
});

describe("retry cap edges", () => {
  it("stops on the first failure when the cap is 0 or 1", () => {
    expect(nextStep(false, 1, 0)).toBe("stop");
    expect(nextStep(false, 1, 1)).toBe("stop");
  });
});

describe("failureReport", () => {
  it("strips ANSI colour codes before trimming", () => {
    const report = failureReport([
      { check: { id: "lint", command: "npm run lint" }, exitCode: 1, output: "\u001b[31merror\u001b[0m here" },
    ]);
    expect(report).toBe("npm run lint exited 1:\nerror here");
  });

  it("returns null when every check passed", () => {
    expect(failureReport([{ check: { id: "test", command: "cargo test -q" }, exitCode: 0, output: "" }])).toBeNull();
  });
});

describe("output cap", () => {
  it("keeps a 5 MB failure under the report cap and fast", () => {
    const check = { id: "test" as const, command: "npm test -- -q" };
    const started = Date.now();
    const report = failureReport([{ check, exitCode: 1, output: "x".repeat(5_000_000) + "\u001b[31mERR\u001b[0m" }]) ?? "";
    expect(report.length).toBeLessThan(4200);
    expect(report).toContain("ERR");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("test gaps", () => {
  it("reports only the failing check when several run in order", () => {
    const lint = { id: "lint" as const, command: "npm run lint" };
    const test = { id: "test" as const, command: "npm test -- -q" };
    const report = failureReport([
      { check: lint, exitCode: 0, output: "fine" },
      { check: test, exitCode: 2, output: "boom" },
    ]) ?? "";
    expect(report).toContain("npm test -- -q exited 2");
    expect(report).not.toContain("npm run lint");
  });

  it("keeps both npm and cargo lint checks when their commands differ", () => {
    const found = detectChecks({ "package.json": node, "Cargo.toml": "[package]" });
    expect(found.filter((c) => c.id === "lint").map((c) => c.command)).toEqual(["npm run lint", "cargo clippy --all-targets -- -D warnings"]);
  });

  it("finds nothing in a pyproject without ruff or pytest settings", () => {
    expect(detectChecks({ "pyproject.toml": "[project]\nname = \"x\"\n" })).toEqual([]);
  });

  it("drops extra fields and non-string bodies from a stored config", () => {
    const parsed = readLintConfig({ enabled: true, confirmed: [{ id: "lint", command: "npm run lint", body: 5, extra: true }, { id: "lint", command: 3 }] });
    expect(parsed?.confirmed).toEqual([{ id: "lint", command: "npm run lint", body: undefined }]);
  });

  it("does not treat a refusal phrased as an edit answer as a finished edit", () => {
    expect(isSuccessfulEdit("edit_file", "Permission denied for edit_file.")).toBe(false);
    expect(isSuccessfulEdit("edit_file", "TOOL RESULT (edit_file): Edited src/a.ts.")).toBe(true);
  });
});

describe("readLintConfig", () => {
  it("reads a valid stored config", () => {
    expect(
      readLintConfig({ enabled: true, confirmed: [{ id: "lint", command: "npm run lint" }] }),
    ).toEqual({ enabled: true, confirmed: [{ id: "lint", command: "npm run lint" }] });
  });

  it("treats junk and rows without the field as no config", () => {
    expect(readLintConfig(undefined)).toBeUndefined();
    expect(readLintConfig("on")).toBeUndefined();
    expect(readLintConfig({ enabled: "yes" })).toBeUndefined();
  });

  it("drops malformed confirmed entries", () => {
    const config = readLintConfig({
      enabled: true,
      confirmed: [null, { id: "deploy", command: "rm -rf x" }, { id: "test", command: 4 }, { id: "test", command: "cargo test -q" }],
    });
    expect(config?.confirmed).toEqual([{ id: "test", command: "cargo test -q" }]);
  });
});

describe("outcomeOf", () => {
  const check = { id: "lint" as const, command: "npm run lint" };
  it("counts a timeout or background result as a failure", () => {
    const outcome = outcomeOf(check, "TOOL RESULT (run_command): Timed out after 120s", "partial");
    expect(outcome.exitCode).not.toBe(0);
    expect(failureReport([outcome])).toContain("partial");
  });
  it("keeps the real exit code when there is one", () => {
    expect(outcomeOf(check, "TOOL RESULT (run_command): Exit code 0.", "ok").exitCode).toBe(0);
  });
});

describe("backgroundTaskId", () => {
  it("reads the task id from a command that moved to the background", () => {
    expect(backgroundTaskId("TOOL RESULT (run_command): Started in the background as task t7. Read it with task_output.")).toBe("t7");
    expect(backgroundTaskId("TOOL RESULT (run_command): Exit code 0.")).toBeNull();
  });
});

describe("parseExitCode and isRefusedResult", () => {
  it("reads the exit code from a run_command answer", () => {
    expect(parseExitCode("TOOL RESULT (run_command): Exit code 2.\n\nboom")).toBe(2);
    expect(parseExitCode("TOOL RESULT (run_command): Exit code 0.")).toBe(0);
  });

  it("returns null for timeouts and background results", () => {
    expect(parseExitCode("TOOL RESULT (run_command): The command was still running after 30 seconds.")).toBeNull();
  });

  it("flags refusals and cancels, not command answers", () => {
    expect(isRefusedResult("Denied by permission mode.")).toBe(true);
    expect(isRefusedResult("TOOL RESULT (run_command): The user stopped the command.")).toBe(false);
  });
});

describe("isSuccessfulEdit", () => {
  it("counts a finished file edit and ignores failed ones and other tools", () => {
    expect(isSuccessfulEdit("edit_file", "TOOL RESULT (edit_file): Edited src/a.ts.")).toBe(true);
    expect(isSuccessfulEdit("write_file", "TOOL RESULT (write_file): Could not write the file.")).toBe(false);
    expect(isSuccessfulEdit("read_file", "TOOL RESULT (read_file): Edited nothing.")).toBe(false);
  });
});
