// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadSettings } from "../app/settings";
import { findMemory } from "../project/memory";
import {
  TRUSTED_FOLDERS_KEY,
  USER_MEMORY_KEY,
  isFolderTrusted,
  loadAutoMemory,
  loadUserNotes,
  trustedFolders,
} from "../project/autoMemory";
import MemoryEditor, { type MemoryTab } from "../project/MemoryEditor";
import { SETTINGS_KEY } from "../storage";
import { translations } from "../translations";

const en = (key: string) => translations.en[key];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("auto memory with 1.x data", () => {
  it("drops a stored off value from an earlier build instead of failing", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoMemory: false, language: "fr" }));
    const loaded = loadSettings();
    expect(loaded).not.toHaveProperty("autoMemory");
    expect(loaded.language).toBe("fr");
  });

  it("still reads a 1.x AGENTS.md as the project instructions", async () => {
    const files: Record<string, string> = { "AGENTS.md": "Use pnpm", ".draggy/memory.md": "- [m1] Likes tabs" };
    const found = await findMemory(async (path) => files[path] ?? null, "/repo");
    expect(found).toEqual({ path: "AGENTS.md", text: "Use pnpm" });
  });
});

describe("memory editor states", () => {
  const tabs = (overrides: Partial<MemoryTab> = {}): MemoryTab[] => [
    {
      id: "instructions",
      label: "Project memory",
      path: "AGENTS.md",
      initial: "Use pnpm",
      onSave: async () => null,
      ...overrides,
    },
    {
      id: "auto-user",
      label: "Auto memory: you",
      path: "user",
      initial: "",
      note: "Your notes live in this browser only.",
      placeholder: "No notes yet",
      onSave: async () => null,
    },
  ];

  it("shows an empty auto memory tab with its placeholder and note", () => {
    render(<MemoryEditor tabs={tabs()} t={en} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Auto memory: you" }));
    expect(screen.getByText("Your notes live in this browser only.")).toBeTruthy();
    expect(screen.getByPlaceholderText("No notes yet")).toBeTruthy();
  });

  it("shows the error and stays open when a save fails", async () => {
    let closed = false;
    render(
      <MemoryEditor
        tabs={tabs({ onSave: async () => "Disk full" })}
        t={en}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en("save") }));
    expect((await screen.findByRole("alert")).textContent).toContain("Disk full");
    expect(closed).toBe(false);
  });
});

describe("auto memory keeps 1.x files and storage alone", () => {
  it("does not read or write an untrusted folder's notes file on upgrade", async () => {
    const calls: string[] = [];
    vi.stubGlobal("window", {
      draggy: {
        files: {
          read: async (_workspaceId: string, path: string) => {
            calls.push(`read ${path}`);
            return { success: true, text: "- [m1] old note" };
          },
          write: async (_workspaceId: string, path: string) => {
            calls.push(`write ${path}`);
            return { success: true };
          },
        },
      },
    });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
      expect(await loadAutoMemory("ws1", true)).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads corrupt browser storage as no notes and no trusted folders", () => {
    localStorage.setItem(USER_MEMORY_KEY, "not a note at all\n<<garbage>>");
    localStorage.setItem(TRUSTED_FOLDERS_KEY, "{broken");
    expect(loadUserNotes()).toEqual([]);
    expect(trustedFolders()).toEqual([]);
    expect(isFolderTrusted("ws1")).toBe(false);
  });
});

describe("memory editor trust switch", () => {
  it("calls the trust change and shows the switch state", () => {
    const changes: boolean[] = [];
    const tab: MemoryTab = {
      id: "auto-project",
      label: "Project",
      path: ".draggy/memory.md",
      initial: "",
      note: en("autoMemoryTrustHint"),
      toggle: {
        label: en("autoMemoryTrust"),
        checked: false,
        onChange: (next) => {
          changes.push(next);
          return true;
        },
      },
      onSave: async () => null,
    };
    render(<MemoryEditor tabs={[tab]} t={(key) => en(key) ?? key} onClose={() => undefined} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(changes).toEqual([true]);
    expect(box.checked).toBe(true);
  });
});

describe("auto memory translations", () => {
  it("has the browser-only warning and trust strings in every language", () => {
    for (const lang of ["en", "fr", "es", "ru"] as const) {
      for (const key of ["autoMemoryBrowserOnly", "autoMemoryTrust", "autoMemoryTrustHint", "autoMemoryOverflow", "savingMemory"]) {
        expect(translations[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });
});
