// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { translations } from "../translations";
import { hearthHeat, isMicBlocked } from "../voice/talkHeat";
import type { ConversationConfig, ConversationHooks } from "../voice/conversation";
import type { AppSettings } from "../types";

/** Talk opens on arrival, carries the chat into the conversation, files turns back into it, and
 * says plainly when the microphone is blocked. */

const opened: { config: ConversationConfig; hooks: ConversationHooks }[] = [];
let openResult: () => Promise<unknown> = () => new Promise(() => {});

vi.mock("../llama", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llama")>()),
  listInstalledModels: async () => [],
}));

vi.mock("../voice/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../voice/conversation")>()),
  openConversation: (config: ConversationConfig, hooks: ConversationHooks) => {
    opened.push({ config, hooks });
    return openResult();
  },
}));

const { default: TalkScreen } = await import("../TalkScreen");

const t = (key: string) => translations.en[key] || key;
const settings = { language: "en", voiceEngine: "system", webMode: "off" } as unknown as AppSettings;

beforeEach(() => {
  opened.length = 0;
  openResult = () => new Promise(() => {});
});

afterEach(() => {
  cleanup();
});

describe("TalkScreen", () => {
  it("starts on arrival with the chat so far", async () => {
    const seed = [{ role: "user" as const, text: "Hello" }];
    render(<TalkScreen settings={settings} seed={seed} onTurn={() => {}} onLeave={() => {}} />);
    await act(async () => {});
    expect(opened).toHaveLength(1);
    expect(opened[0].config.history).toEqual(seed);
  });

  it("hands finished turns to the chat", async () => {
    const onTurn = vi.fn();
    render(<TalkScreen settings={settings} seed={[]} onTurn={onTurn} onLeave={() => {}} />);
    await act(async () => {});
    opened[0].hooks.onTurn?.({ id: 1, role: "assistant", text: "Hi" });
    expect(onTurn).toHaveBeenCalledWith({ id: 1, role: "assistant", text: "Hi" });
  });

  it("names a blocked microphone and where to allow it", async () => {
    openResult = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    render(<TalkScreen settings={settings} seed={[]} onTurn={() => {}} onLeave={() => {}} />);
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe(t("micBlocked"));
    expect(screen.getByText(t("micBlockedWindows"))).toBeTruthy();
    expect(screen.getByText(t("retry"))).toBeTruthy();
  });

  it("leaves for the chat on Escape, even while preparing", async () => {
    const onLeave = vi.fn();
    render(<TalkScreen settings={settings} seed={[]} onTurn={() => {}} onLeave={onLeave} />);
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onLeave).toHaveBeenCalledOnce();
    expect(opened[0].config.signal?.aborted).toBe(true);
  });
});

describe("hearthHeat", () => {
  const live = { live: true, muted: false };

  it("follows the microphone while listening", () => {
    expect(hearthHeat({ ...live, activity: "listening" }, 0.1, 0)).toBeGreaterThan(
      hearthHeat({ ...live, activity: "listening" }, 0, 0),
    );
  });

  it("burns low while thinking and lower still when muted", () => {
    const thinking = hearthHeat({ ...live, activity: "thinking" }, 0.5, 0);
    const muted = hearthHeat({ live: true, muted: true, activity: "listening" }, 0.5, 0);
    expect(thinking).toBeLessThan(0.2);
    expect(muted).toBeLessThan(thinking);
  });

  it("stays between 0 and 1", () => {
    for (const level of [0, 0.2, 1, 5]) {
      const heat = hearthHeat({ ...live, activity: "listening" }, level, 0);
      expect(heat).toBeGreaterThanOrEqual(0);
      expect(heat).toBeLessThanOrEqual(1);
    }
  });
});

describe("isMicBlocked", () => {
  it("tells a refused microphone from other failures", () => {
    expect(isMicBlocked(new DOMException("x", "NotAllowedError"))).toBe(true);
    expect(isMicBlocked(new Error("Permission denied by system"))).toBe(true);
    expect(isMicBlocked(new Error("Model not found"))).toBe(false);
    expect(isMicBlocked("nope")).toBe(false);
  });
});
