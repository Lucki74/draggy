// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { isWorkStep, summarizeWork } from "../chat/workSummary";
import { defaultSettings } from "../app/settings";
import { TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
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

  it("names the site for one or two page reads and counts more", () => {
    const read = (id: string, url: string) => step(id, "reading", { url });
    const en = tFor("en");
    expect(summarizeWork([read("a", "https://www.reddit.com/r/x")], "en", en).text).toBe("Read reddit.com");
    expect(
      summarizeWork([read("a", "https://reddit.com/a"), read("b", "https://reddit.com/b"), read("c", "https://github.com/x")], "en", en).text,
    ).toBe("Read reddit.com and github.com");
    expect(
      summarizeWork([read("a", "https://a.test"), read("b", "https://b.test"), read("c", "https://c.test")], "en", en).text,
    ).toBe("Read 3 pages");
  });

  it("counts a search once, not once for the question and once for its results", () => {
    const steps = [step("a", "searching"), step("b", "results")];
    expect(summarizeWork(steps, "en", tFor("en")).text).toBe("Searched the web once");
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

describe("work groups around hidden thinking", () => {
  const turn = (view: TranscriptView, steps: SearchStep[]) =>
    render(
      <TranscriptViewContext.Provider value={view}>
        <MessageItem
          msg={{ id: "a2", role: "assistant", content: "Done.", steps }}
          idx={1}
          isGenerating={false}
          isLast
          onRegenerate={() => {}}
          onSwitchVersion={() => {}}
          copiedIndex={null}
          copyToClipboard={() => {}}
          settings={{ ...defaultSettings, showMetrics: false }}
          onEditMessage={() => {}}
        />
      </TranscriptViewContext.Provider>,
    );
  const steps = () => [
    step("one.ts", "reading"),
    step("t", "thinking", { content: "hm", thoughtTime: 3 }),
    step("two.ts", "reading"),
  ];

  it("merges the groups either side of finished thinking in the normal view", () => {
    turn("normal", steps());
    expect(screen.getAllByRole("button", { name: /read \d+ files?/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /read 2 files/i })).toBeTruthy();
  });

  it("keeps them apart when the thinking row is on screen", () => {
    turn("thinking", steps());
    expect(screen.getAllByRole("button", { name: /read 1 file/i })).toHaveLength(2);
  });

  it("puts a lone step in a dropdown too", () => {
    turn("normal", [step("one.ts", "reading")]);
    expect(screen.getByRole("button", { name: /read 1 file/i }).getAttribute("aria-expanded")).toBe("false");
  });
});
