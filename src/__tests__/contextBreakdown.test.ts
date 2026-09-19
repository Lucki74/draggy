// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MIN_COMPACT_LIMIT,
  compactThreshold,
  describeContextWindow,
  formatTokenCount,
  maxLimitFor,
  measureBreakdown,
  parseTokenCount,
} from "../agent/contextBreakdown";
import { foldedTokens, planManualCompaction } from "../agent/compaction";
import { FALLBACK_CONTEXT_LENGTH, pickContextSize, windowCeiling } from "../llama";
import { SLASH_COMMANDS, matchSlashCommands, parseSlashArgument } from "../chat/slashCommands";
import { settleSession } from "../storage";
import type { ChatSession, Message } from "../types";

/** The context view. The model reports one number; everything here is about turning that into
 * something the user can act on without it lying. */

const PARTS = {
  systemChars: 4000, // 1000 tokens
  toolChars: 2000, // 500
  memoryChars: 800, // 200
  skillChars: 400, // 100
  summaryChars: 0,
};

describe("splitting a measured prompt into its parts", () => {
  it("gives the conversation whatever the fixed parts do not account for", () => {
    const breakdown = measureBreakdown(PARTS, 5000);

    expect(breakdown).toEqual({
      system: 1000,
      tools: 500,
      memory: 200,
      skills: 100,
      loadedSkills: 0,
      summary: 0,
      messages: 3200,
    });
  });

  it("keeps the instructions of loaded skills apart from the list of skills on offer", () => {
    const breakdown = measureBreakdown({ ...PARTS, loadedSkillChars: 2400 }, 5600);

    expect(breakdown.skills).toBe(100);
    expect(breakdown.loadedSkills).toBe(600);
    expect(breakdown.messages).toBe(3200);
  });

  it("always adds up to what the model counted", () => {
    const breakdown = measureBreakdown(PARTS, 5000);
    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

    expect(total).toBe(5000);
  });

  it("scales the estimates down rather than letting the conversation go negative", () => {
    const breakdown = measureBreakdown(PARTS, 900);
    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

    expect(breakdown.messages).toBeGreaterThanOrEqual(0);
    expect(total).toBe(900);
    expect(breakdown.system).toBeGreaterThan(breakdown.tools);
  });

  it("estimates everything when nothing was measured", () => {
    const breakdown = measureBreakdown(PARTS, 0, 4000);

    expect(breakdown.messages).toBe(1000);
    expect(breakdown.system).toBe(1000);
  });
});

describe("the window as the user sees it", () => {
  const view = describeContextWindow({
    breakdown: measureBreakdown(PARTS, 5100),
    draftTokens: 100,
    exact: true,
    windowTokens: 100_000,
    limitTokens: null,
  });

  it("lists every part with anything in it, then the free space", () => {
    expect(view.rows.map((row) => row.id)).toEqual([
      "messages",
      "system",
      "tools",
      "skills",
      "memory",
      "draft",
      "free",
    ]);
  });

  it("carries no counts or loaded skills when nothing was said about them", () => {
    expect(view.details).toEqual({ toolCount: null, skillCount: null, loadedSkills: [] });
  });

  it("shows the measured draft on its own row, out of the conversation's share", () => {
    expect(view.usedTokens).toBe(5100);
    expect(view.rows.find((row) => row.id === "draft")?.tokens).toBe(100);
    expect(view.rows.find((row) => row.id === "messages")?.tokens).toBe(measureBreakdown(PARTS, 5100).messages - 100);
  });

  it("gives each part its share of the whole window", () => {
    expect(view.rows.find((row) => row.id === "messages")?.percent).toBeCloseTo(3.2);
    expect(view.percent).toBeCloseTo(5.1);
  });

  it("leaves the rest as free space", () => {
    const free = view.rows.at(-1);

    expect(free?.id).toBe("free");
    expect(free?.tokens).toBe(94_900);
    expect(free?.percent).toBeCloseTo(94.9);
  });

  it("never reports negative free space when the window is overfull", () => {
    const full = describeContextWindow({
      breakdown: { messages: 200_000, system: 0, tools: 0, memory: 0, skills: 0, loadedSkills: 0, summary: 0 },
      draftTokens: 0,
      exact: true,
      windowTokens: 100_000,
      limitTokens: null,
    });

    expect(full.rows.at(-1)?.tokens).toBe(0);
  });

  it("guesses nothing before the model has counted anything", () => {
    const fresh = describeContextWindow({
      breakdown: null,
      draftTokens: 0,
      exact: true,
      windowTokens: 8192,
      limitTokens: null,
    });

    expect(fresh.measured).toBe(false);
    expect(fresh.rows.map((row) => row.id)).toEqual(["free"]);
    expect(fresh.usedTokens).toBe(0);
  });
});

describe("where the conversation gets folded", () => {
  it("is a share of how far the window can grow when left to Draggy", () => {
    expect(compactThreshold(128_000, null)).toEqual({ tokens: 76_800, source: "auto" });
  });

  it("is the user's limit when they set one", () => {
    expect(compactThreshold(128_000, 50_000)).toEqual({ tokens: 50_000, source: "limit" });
  });

  it("caps a limit that would leave no room for the reply", () => {
    expect(compactThreshold(32_000, 1_000_000).tokens).toBe(maxLimitFor(32_000));
  });

  it("is reported with the view", () => {
    const view = describeContextWindow({
      breakdown: null,
      draftTokens: 0,
      exact: true,
      windowTokens: 128_000,
      limitTokens: 20_000,
    });

    expect(view.compactAtTokens).toBe(20_000);
    expect(view.compactSource).toBe("limit");
  });

  it("does not follow the small window a short chat happens to be loaded at", () => {
    const view = describeContextWindow({
      breakdown: { messages: 135, system: 1500, tools: 692, memory: 0, skills: 0, loadedSkills: 0, summary: 0 },
      draftTokens: 0,
      exact: true,
      windowTokens: windowCeiling(203_000, 4096),
      limitTokens: null,
    });

    expect(view.compactAtTokens).toBe(121_800);
  });
});

describe("how far a window can grow", () => {
  it("is the model's own maximum", () => {
    expect(windowCeiling(203_000, 4096)).toBe(203_000);
  });

  it("is the fallback a turn is held to when the model does not say", () => {
    expect(windowCeiling(null)).toBe(FALLBACK_CONTEXT_LENGTH);
    expect(pickContextSize(1_000_000, null)).toBe(windowCeiling(null));
  });

  it("is never less than what is already loaded", () => {
    expect(windowCeiling(null, 32_768)).toBe(32_768);
  });
});

describe("reading a token count someone typed", () => {
  it("reads plain numbers and the usual shorthand", () => {
    expect(parseTokenCount("20000")).toBe(20_000);
    expect(parseTokenCount("20k")).toBe(20_000);
    expect(parseTokenCount("1.5K")).toBe(1500);
    expect(parseTokenCount("2m")).toBe(2_000_000);
    expect(parseTokenCount("32,000")).toBe(32_000);
    expect(parseTokenCount("8k tokens")).toBe(8000);
  });

  it("reads auto and off as no limit of the user's own", () => {
    expect(parseTokenCount("auto")).toBeNull();
    expect(parseTokenCount("OFF")).toBeNull();
  });

  it("refuses anything that is not a count", () => {
    expect(parseTokenCount("")).toBeUndefined();
    expect(parseTokenCount("lots")).toBeUndefined();
    expect(parseTokenCount("-5")).toBeUndefined();
    expect(parseTokenCount("0")).toBeUndefined();
  });

  it("has a floor below which every turn would fold", () => {
    expect(MIN_COMPACT_LIMIT).toBe(1000);
  });
});

describe("showing a token count", () => {
  it("keeps small counts exact and large ones short", () => {
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(27_600)).toBe("27.6k");
    expect(formatTokenCount(20_000)).toBe("20k");
    expect(formatTokenCount(203_000)).toBe("203k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
  });
});

const message = (role: Message["role"], chars: number, id = `${role}-${chars}-${Math.random()}`): Message => ({
  id,
  role,
  content: "x".repeat(chars),
});

describe("folding on request", () => {
  const conversation = [
    message("user", 400),
    message("assistant", 800),
    message("user", 400),
    message("assistant", 800),
    message("user", 400),
    message("assistant", 800),
  ];

  it("folds everything but the last exchange, however short the chat", () => {
    const plan = planManualCompaction(conversation);

    expect(plan).toEqual({ foldFrom: 0, foldThrough: 4 });
  });

  it("finds nothing to fold in a single exchange", () => {
    expect(planManualCompaction(conversation.slice(0, 2))).toBeNull();
  });

  it("says how many tokens went into the notes", () => {
    expect(foldedTokens(conversation, { foldFrom: 0, foldThrough: 4 })).toBe(600);
  });
});

describe("the compaction commands", () => {
  it("are offered in the menu", () => {
    const ids = SLASH_COMMANDS.map((command) => command.id);

    expect(ids).toContain("compact");
    expect(ids).toContain("compact-limit");
    expect(matchSlashCommands("/compact").map((command) => command.id)).toEqual([
      "compact",
      "compact-limit",
    ]);
  });

  it("read a limit typed after the command", () => {
    expect(parseSlashArgument("/compact-limit 20k")).toEqual({
      id: "compact-limit",
      argument: "20k",
    });
    expect(parseSlashArgument("  /Compact-Limit   auto ")).toEqual({
      id: "compact-limit",
      argument: "auto",
    });
  });

  it("leave a message that merely starts with a slash alone", () => {
    expect(parseSlashArgument("/new thing")).toBeNull();
    expect(parseSlashArgument("/dev/null is not a file")).toBeNull();
    expect(parseSlashArgument("/compact-limit")).toBeNull();
  });
});

describe("opening the app after a fold was cut short", () => {
  it("drops a marker that was still spinning", () => {
    const session: ChatSession = {
      id: "c",
      title: "c",
      updatedAt: 0,
      isGenerating: true,
      messages: [
        { id: "a", role: "assistant", content: "hi", fold: { status: "running", tokens: 10, at: 1 } },
        { id: "b", role: "assistant", content: "yo", fold: { status: "done", tokens: 20, at: 2 } },
      ],
    };

    const settled = settleSession(session);

    expect(settled.isGenerating).toBe(false);
    expect(settled.messages[0].fold).toBeUndefined();
    expect(settled.messages[1].fold).toEqual({ status: "done", tokens: 20, at: 2 });
  });
});
