import { describe, expect, it } from "vitest";
import { describeEnded, describeTask, inputFor, isHarmlessInput } from "../tools/tasks";
import type { BackgroundTask } from "../types";

const task = (patch: Partial<BackgroundTask> = {}): BackgroundTask => ({
  uid: "chat/t1",
  id: "t1",
  chatId: "chat",
  command: "npm run dev",
  shell: "bash",
  mode: "pty",
  status: "running",
  exitCode: null,
  signal: null,
  startedAt: 1_000,
  endedAt: null,
  canInput: true,
  lastLine: "",
  error: null,
  ...patch,
});

describe("inputFor", () => {
  it("sends text with Enter unless told otherwise", () => {
    expect(inputFor({ text: "y" })).toBe("y\r");
    expect(inputFor({ text: "y", enter: false })).toBe("y");
  });

  it("sends a named key on its own", () => {
    expect(inputFor({ key: "ctrl+c" })).toBe("\u0003");
    expect(inputFor({ key: " Up " })).toBe("\u001b[A");
  });

  it("types the text, then does not add a key", () => {
    expect(inputFor({ text: "ok", key: "tab" })).toBe("ok\r");
  });

  it("refuses an unknown key and an empty request", () => {
    expect(inputFor({ key: "f13" })).toBeNull();
    expect(inputFor({})).toBeNull();
    expect(inputFor({ text: "" })).toBeNull();
  });
});

describe("isHarmlessInput", () => {
  it("lets a yes or no answer through", () => {
    for (const text of ["y", "N", " yes ", "No"]) expect(isHarmlessInput({ text })).toBe(true);
  });

  it("asks about a yes without Enter and about any other text", () => {
    expect(isHarmlessInput({ text: "y", enter: false })).toBe(false);
    expect(isHarmlessInput({ text: "rm -rf build" })).toBe(false);
    expect(isHarmlessInput({ text: "yes please" })).toBe(false);
  });

  it("lets a named key through and not an unknown one", () => {
    expect(isHarmlessInput({ key: "enter" })).toBe(true);
    expect(isHarmlessInput({ key: "ctrl+c" })).toBe(true);
    expect(isHarmlessInput({ key: "f13" })).toBe(false);
    expect(isHarmlessInput({})).toBe(false);
  });
});

describe("describeTask", () => {
  it("says how long a running task has gone", () => {
    expect(describeTask(task(), 66_000)).toBe("t1: npm run dev (bash, running for 1m 5s)");
  });

  it("says how an ended task ended", () => {
    expect(describeTask(task({ status: "exited", exitCode: 0, endedAt: 4_000 }))).toContain("exited with code 0 after 3s");
    expect(describeTask(task({ status: "failed", exitCode: 2, endedAt: 4_000 }))).toContain("failed with code 2 after 3s");
    expect(describeTask(task({ status: "failed", exitCode: null, endedAt: 4_000 }))).toContain("failed after 3s");
    expect(describeTask(task({ status: "stopped", endedAt: 4_000 }))).toContain("stopped after 3s");
  });
});

describe("describeEnded", () => {
  it("reports each task with the end of its output", () => {
    const text = describeEnded([
      { uid: "chat/t1", id: "t1", command: "npm test", status: "failed", exitCode: 1, durationMs: 12_000, tail: "1 failing\n" },
      { uid: "chat/t2", id: "t2", command: "npm run dev", status: "stopped", exitCode: null, durationMs: 3_000, tail: "" },
    ]);
    expect(text).toContain("[Background tasks ended]");
    expect(text).toContain("Task t1 (npm test) failed with exit code 1 after 12s.\nLast output:\n1 failing");
    expect(text).toContain("Task t2 (npm run dev) was stopped after 3s.");
    expect(text).toContain("task_output");
  });
});
