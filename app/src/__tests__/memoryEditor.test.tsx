// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MemoryEditor, { type MemoryTab } from "../project/MemoryEditor";

afterEach(cleanup);

const t = (key: string) => key;

function tab(id: string, extra: Partial<MemoryTab> = {}): MemoryTab {
  return { id, label: id, path: `${id}.md`, initial: `${id} text`, onSave: async () => null, ...extra };
}

describe("memory editor states", () => {
  it("shows a tab with no folder as unavailable with its reason", () => {
    const tabs = [tab("auto-project", { disabledReason: "Open a folder first.", initial: "" }), tab("instructions")];
    render(<MemoryEditor tabs={tabs} t={t} onClose={() => undefined} />);
    const projectTab = screen.getByRole("tab", { name: "auto-project" }) as HTMLButtonElement;
    expect(projectTab.getAttribute("aria-selected")).toBe("true");
    expect(projectTab.disabled).toBe(true);
    expect(screen.getByText("Open a folder first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps unsaved text when switching tabs and back", () => {
    const tabs = [tab("first"), tab("second")];
    render(<MemoryEditor tabs={tabs} t={t} onClose={() => undefined} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "unsaved edit" } });
    fireEvent.click(screen.getByRole("tab", { name: "second" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("second text");
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("unsaved edit");
  });

  it("disables save while a save is still running", async () => {
    let finish: (value: string | null) => void = () => undefined;
    const pending = new Promise<string | null>((resolve) => {
      finish = resolve;
    });
    const tabs = [tab("only", { onSave: () => pending })];
    render(<MemoryEditor tabs={tabs} t={t} onClose={() => undefined} />);
    const save = screen.getByRole("button", { name: "save" }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(save.disabled).toBe(true);
    finish("Could not save.");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(save.disabled).toBe(false);
  });
});
