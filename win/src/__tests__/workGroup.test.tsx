// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { isWorkStep, summarizeWork } from "../chat/workSummary";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { SearchStep } from "../types";

afterEach(cleanup);

const tFor = (language: "en" | "fr") => (key: string) => translations[language][key] || key;
const step = (id: string, type: SearchStep["type"], extra: Partial<SearchStep> = {}): SearchStep => ({
  id,
  type,
  content: `**${id}**`,
  isComplete: true,
  ...extra,
});

describe("the work summary", () => {
  it("counts steps by kind, in words, with plurals", () => {
    const steps = [step("a", "reading"), step("b", "reading"), step("c", "edit_file"), step("d", "command")];
    expect(summarizeWork(steps, "en", tFor("en")).text).toBe("Read 2 files, edited 1 file, and ran 1 command");
  });

  it("uses the reader's language and list style", () => {
    const steps = [step("a", "reading"), step("b", "command"), step("c", "command")];
    expect(summarizeWork(steps, "fr", tFor("fr")).text).toBe("A lu 1 fichier et a lancé 2 commandes");
  });

  it("says how many failed", () => {
    const summary = summarizeWork([step("a", "reading"), step("b", "error")], "en", tFor("en"));
    expect(summary.failed).toBe(1);
    expect(summary.text).toBe("Read 1 file and 1 failed");
  });

  it("leaves prose, reasoning and questions out of the block", () => {
    expect(isWorkStep(step("a", "text"))).toBe(false);
    expect(isWorkStep(step("b", "thinking"))).toBe(false);
    expect(isWorkStep(step("c", "approval"))).toBe(false);
    expect(isWorkStep(step("d", "reading"))).toBe(true);
  });
});

describe("a finished reply with several steps", () => {
  it("folds them under one summary that opens on click", async () => {
    render(
      <MessageItem
        msg={{
          id: "a1",
          role: "assistant",
          content: "Done.",
          steps: [step("one.ts", "reading"), step("two.ts", "reading")],
        }}
        idx={1}
        isGenerating={false}
        isLast
        onRegenerate={() => {}}
        onSwitchVersion={() => {}}
        copiedIndex={null}
        copyToClipboard={() => {}}
        settings={{ ...defaultSettings, showMetrics: false }}
        onEditMessage={() => {}}
      />,
    );

    const summary = screen.getByRole("button", { name: /read 2 files/i });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    await act(async () => summary.click());
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("one.ts")).toBeTruthy();
  });
});
