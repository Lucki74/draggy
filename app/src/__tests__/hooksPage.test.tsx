// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HooksPage from "../settings/HooksPage";
import { defaultSettings } from "../app/settings";

afterEach(() => {
  cleanup();
  delete (window as unknown as { draggy?: unknown }).draggy;
});

const t = (key: string) => key;

describe("hooks settings page", () => {
  it("shows the empty state with no hooks", () => {
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[]} t={t} />);
    expect(screen.getByText("hooksNone")).toBeTruthy();
  });

  it("keeps Add disabled until a command is typed", () => {
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[]} t={t} />);
    const add = screen.getByRole("button", { name: "hooksAdd" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("hooksCommand"), { target: { value: "node check.js" } });
    expect((screen.getByRole("button", { name: "hooksAdd" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds a PreToolUse hook with its matcher and timeout", () => {
    const onUpdate = vi.fn();
    render(<HooksPage settings={defaultSettings} onUpdate={onUpdate} projects={[]} t={t} />);
    fireEvent.change(screen.getByLabelText("hooksMatcher"), { target: { value: "write_file" } });
    fireEvent.change(screen.getByLabelText("hooksCommand"), { target: { value: "  node check.js " } });
    fireEvent.change(screen.getByLabelText("hooksTimeout"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "hooksAdd" }));
    expect(onUpdate).toHaveBeenCalledWith({
      hooks: [{ event: "PreToolUse", matcher: "write_file", command: "node check.js", timeout: 30, enabled: true }],
    });
  });

  it("rejects an invalid tool name pattern", () => {
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[]} t={t} />);
    fireEvent.change(screen.getByLabelText("hooksMatcher"), { target: { value: "(" } });
    fireEvent.change(screen.getByLabelText("hooksCommand"), { target: { value: "x" } });
    expect(screen.getByText("hooksBadRegex")).toBeTruthy();
    expect((screen.getByRole("button", { name: "hooksAdd" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists every command in the project hooks file, not a count", async () => {
    const text = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "write_file", command: "node check-a.js" }],
        Stop: [{ command: "npm test -- -q" }],
      },
    });
    (window as unknown as { draggy: unknown }).draggy = { files: { read: vi.fn(async () => ({ success: true, text })) } };
    const project = { id: "/p", name: "p" } as unknown as Parameters<typeof HooksPage>[0]["projects"][number];
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[project]} activeProjectId="/p" t={t} />);
    await waitFor(() => expect(screen.getByText("PreToolUse write_file: node check-a.js")).toBeTruthy());
    expect(screen.getByText("Stop: npm test -- -q")).toBeTruthy();
    expect(screen.getByText("hooksUntrusted")).toBeTruthy();
  });

  it("shows a long project command in full without truncation", async () => {
    const tail = "echo done && node finish.js --flag=value-that-must-stay-visible";
    const command = `node check.js ${"x".repeat(400)} ${tail}`;
    const text = JSON.stringify({ hooks: { Stop: [{ command }] } });
    (window as unknown as { draggy: unknown }).draggy = { files: { read: vi.fn(async () => ({ success: true, text })) } };
    const project = { id: "/p", name: "p" } as unknown as Parameters<typeof HooksPage>[0]["projects"][number];
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[project]} activeProjectId="/p" t={t} />);
    const line = await waitFor(() => screen.getByText(`Stop: ${command}`));
    expect(line.className).not.toContain("truncate");
    expect(line.className).toContain("break-all");
    expect(line.textContent).toContain(tail);
  });

  it("hides Trust when the project hooks file has no entries", async () => {
    const text = JSON.stringify({ hooks: {} });
    (window as unknown as { draggy: unknown }).draggy = { files: { read: vi.fn(async () => ({ success: true, text })) } };
    const project = { id: "/p", name: "p" } as unknown as Parameters<typeof HooksPage>[0]["projects"][number];
    render(<HooksPage settings={defaultSettings} onUpdate={vi.fn()} projects={[project]} activeProjectId="/p" t={t} />);
    await waitFor(() => expect(screen.getByText("hooksUntrusted")).toBeTruthy());
    expect(screen.queryByText("hooksTrust")).toBeNull();
  });
});
