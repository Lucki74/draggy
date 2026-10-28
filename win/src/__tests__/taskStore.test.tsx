// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskChip } from "../chat/TaskChip";
import { applyTaskEvent, failedOf, latestForeground, markForeground, resetTaskStore, runningOf, taskSnapshot, unmarkForeground } from "../tasks/taskStore";
import { currentTerminalView, resetTerminalBus } from "../terminal/terminalBus";
import type { BackgroundTask, TaskEvent } from "../types";

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

const t = (key: string) => key;

let emit: (event: TaskEvent) => void = () => {};

beforeEach(() => {
  resetTaskStore();
  resetTerminalBus();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      tasks: {
        list: vi.fn().mockResolvedValue({ success: true, tasks: [] }),
        onEvent: (callback: (event: TaskEvent) => void) => {
          emit = callback;
          return () => {};
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  resetTaskStore();
  resetTerminalBus();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("task store", () => {
  it("follows the events of a task", () => {
    applyTaskEvent({ type: "started", chatId: "chat", task: task() });
    applyTaskEvent({ type: "output", chatId: "chat", uid: "chat/t1", chunk: "ready\n" });
    expect(taskSnapshot().tasks).toHaveLength(1);
    expect(taskSnapshot().tails["chat/t1"]).toBe("ready\n");

    applyTaskEvent({ type: "ended", chatId: "chat", task: task({ status: "failed", exitCode: 1, endedAt: 5_000 }), wake: false });
    expect(taskSnapshot().tasks).toHaveLength(1);
    expect(runningOf(taskSnapshot().tasks)).toHaveLength(0);
    expect(failedOf(taskSnapshot().tasks)).toHaveLength(1);
  });

  it("keeps only the end of a long output", () => {
    applyTaskEvent({ type: "started", chatId: "chat", task: task() });
    applyTaskEvent({ type: "output", chatId: "chat", uid: "chat/t1", chunk: "x".repeat(9000) });
    expect(taskSnapshot().tails["chat/t1"]).toHaveLength(4000);
  });

  it("sends the latest foreground command away first", () => {
    markForeground("a");
    markForeground("b");
    expect(latestForeground()).toBe("b");
    unmarkForeground("b");
    expect(latestForeground()).toBe("a");
    unmarkForeground("a");
    expect(latestForeground()).toBeNull();
  });
});

describe("TaskChip", () => {
  it("shows nothing without tasks", () => {
    const { container } = render(<TaskChip chatId="chat" t={t} />);
    expect(container.innerHTML).toBe("");
  });

  it("counts the running tasks of its chat only", () => {
    render(<TaskChip chatId="chat" t={t} />);
    act(() => {
      emit({ type: "started", chatId: "chat", task: task() });
      emit({ type: "started", chatId: "chat", task: task({ uid: "chat/t2", id: "t2" }) });
      emit({ type: "started", chatId: "other", task: task({ uid: "other/t1", chatId: "other" }) });
    });
    expect(screen.getByRole("button", { name: /2 tasksRunningLabel/ })).toBeTruthy();
  });

  it("turns to failed until it is opened, and opens the Tasks tab", () => {
    render(<TaskChip chatId="chat" t={t} />);
    act(() => emit({ type: "ended", chatId: "chat", task: task({ status: "failed", exitCode: 1, endedAt: 2_000 }), wake: false }));
    const chip = screen.getByRole("button", { name: /1 tasksFailedLabel/ });

    fireEvent.click(chip);

    expect(currentTerminalView()).toBe("tasks");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
