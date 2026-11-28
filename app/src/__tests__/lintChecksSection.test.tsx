// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LintChecksSection from "../settings/LintChecksSection";
import type { ChecksStatus } from "../app/useProjectChecks";
import type { CheckCommand } from "../agent/lintLoop";
import type { Workspace } from "../types";

let hook: { status: ChecksStatus; checks: CheckCommand[]; retry: () => void };

vi.mock("../app/useProjectChecks", () => ({
  useProjectChecks: () => hook,
}));

const LINT: CheckCommand[] = [{ id: "lint", command: "npm run lint" }];
const t = (key: string) => key;

function project(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "p1",
    name: "Draggy",
    kind: "project",
    rootPath: "D:/work/draggy",
    permissionMode: "ask",
    settings: {},
    grants: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("LintChecksSection", () => {
  it("says a chat workspace needs a folder", () => {
    hook = { status: "idle", checks: [], retry: vi.fn() };
    render(<LintChecksSection project={project({ rootPath: null })} onSave={vi.fn()} t={t} />);
    expect(screen.getByText("checksNoFolder")).toBeTruthy();
  });

  it("disables the toggle while the commands are being found", () => {
    hook = { status: "loading", checks: [], retry: vi.fn() };
    render(<LintChecksSection project={project()} onSave={vi.fn()} t={t} />);
    expect(screen.getByText("checksLoading")).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers a retry when the project files cannot be read", () => {
    const retry = vi.fn();
    hook = { status: "error", checks: [], retry };
    render(<LintChecksSection project={project()} onSave={vi.fn()} t={t} />);
    fireEvent.click(screen.getByText("checksRetry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says nothing was found and keeps the toggle off", () => {
    hook = { status: "ready", checks: [], retry: vi.fn() };
    render(<LintChecksSection project={project()} onSave={vi.fn()} t={t} />);
    expect(screen.getByText("checksEmpty")).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for confirmation before turning checks on and saves the exact list", () => {
    hook = { status: "ready", checks: LINT, retry: vi.fn() };
    const onSave = vi.fn();
    render(<LintChecksSection project={project()} onSave={onSave} t={t} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("checksConfirm"));
    expect(onSave).toHaveBeenCalledWith({ enabled: true, confirmed: LINT });
  });

  it("shows a changed-commands note and keeps the loop off until confirmed again", () => {
    hook = { status: "ready", checks: LINT, retry: vi.fn() };
    const stale = project({ settings: { lintLoop: { enabled: true, confirmed: [{ id: "test", command: "cargo test -q" }] } } });
    render(<LintChecksSection project={stale} onSave={vi.fn()} t={t} />);
    expect(screen.getByText("checksChanged")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("turns checks off without a confirmation", () => {
    hook = { status: "ready", checks: LINT, retry: vi.fn() };
    const onSave = vi.fn();
    const on = project({ settings: { lintLoop: { enabled: true, confirmed: LINT } } });
    render(<LintChecksSection project={on} onSave={onSave} t={t} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch"));
    expect(onSave).toHaveBeenCalledWith({ enabled: false, confirmed: LINT });
  });
});
