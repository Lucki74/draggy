// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ImportTab from "../extensions/ImportTab";
import { translations } from "../translations";
import type { AppSettings, ImportItem } from "../types";

const t = (key: string) => translations.en[key] || key;

const item = (over: Partial<ImportItem>): ImportItem => ({
  key: "claude:skill:a",
  source: "claude",
  kind: "skill",
  id: "a",
  name: "A",
  description: "",
  clash: false,
  supported: true,
  note: null,
  needsKey: false,
  suggested: "a-imported",
  ...over,
});

function stub(items: ImportItem[], memory: string[] = []) {
  const apply = vi.fn(async (request: { items: { key: string }[] }) => ({
    success: true,
    results: request.items.map((one) => ({ key: one.key, status: "imported", reason: null, needsKey: true })),
    memory,
  }));
  vi.stubGlobal("window", { draggy: { import: { scan: async () => ({ success: true, items }), apply } } });
  return apply;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the import tab", () => {
  it("groups by source and kind, and keeps clashes and unsupported rows unticked", async () => {
    stub([
      item({}),
      item({ key: "claude:skill:b", id: "b", name: "B", clash: true }),
      item({ key: "claude:command:c", kind: "command", id: "c", name: "C", supported: false, note: "noCommandFolder" }),
    ]);
    render(<ImportTab t={t} />);
    expect(await screen.findByText("Claude Code · Skills")).toBeTruthy();
    expect((screen.getByLabelText("A") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("B") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("C") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(t("importNoteNoCommands"))).toBeTruthy();
  });

  it("sends the rename for a clash and prepends imported global instructions", async () => {
    const apply = stub([item({ key: "claude:skill:b", id: "b", name: "B", clash: true }), item({ key: "claude:memory:global", kind: "memory", id: "global", name: "CLAUDE.md" })], ["Be brief."]);
    const onUpdate = vi.fn();
    const settings = { customInstructions: ["old"] } as AppSettings;
    render(<ImportTab t={t} settings={settings} onUpdate={onUpdate} />);
    const rename = await screen.findByLabelText("Import as: B");
    fireEvent.change(rename, { target: { value: "b-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 selected" }));
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0][0].items).toEqual([
      { key: "claude:skill:b", rename: "b-2" },
      { key: "claude:memory:global", rename: undefined },
    ]);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ customInstructions: ["Be brief.", "old"] }));
    expect(await screen.findByText(t("importKeysHint"))).toBeTruthy();
  });
});
