import { describe, expect, it, vi } from "vitest";

vi.mock("../llama", () => ({ beginLlamaWork: () => () => undefined }));
vi.mock("../ai/engineAdapter", () => ({ ggufModelName: (name: string) => name }));
vi.mock("../ai/providers", () => ({ chatEndpoint: () => "http://x" }));

import { lastAsk, parseSkillDraft, shouldOfferSkillDraft, slugify, toolSequence } from "../agent/skillDraft";
import { renderTranscript } from "../agent/compaction";

const base = { settings: {}, codeMode: true, aborted: false, failed: false, toolCalls: { read_file: 3, edit_file: 2 } };

describe("shouldOfferSkillDraft", () => {
  it("offers after five tool calls in Code", () => {
    expect(shouldOfferSkillDraft(base)).toBe(true);
  });
  it("stays quiet below five calls", () => {
    expect(shouldOfferSkillDraft({ ...base, toolCalls: { read_file: 4 } })).toBe(false);
    expect(shouldOfferSkillDraft({ ...base, toolCalls: undefined })).toBe(false);
  });
  it("stays quiet in chat, when stopped, when failed, or when turned off", () => {
    expect(shouldOfferSkillDraft({ ...base, codeMode: false })).toBe(false);
    expect(shouldOfferSkillDraft({ ...base, aborted: true })).toBe(false);
    expect(shouldOfferSkillDraft({ ...base, failed: true })).toBe(false);
    expect(shouldOfferSkillDraft({ ...base, settings: { skillSuggestions: false } })).toBe(false);
  });
});

describe("parseSkillDraft", () => {
  const good = "---\nname: Ship Release\ndescription: Cut a release.\n---\n\n## Steps\n1. Tag.";
  it("reads front matter and body, slugging the name", () => {
    expect(parseSkillDraft(good)).toEqual({ name: "ship-release", description: "Cut a release.", body: "## Steps\n1. Tag." });
  });
  it("accepts a code fence and a think block", () => {
    expect(parseSkillDraft("<think>hm</think>\n```markdown\n" + good + "\n```")?.name).toBe("ship-release");
  });
  it("rejects replies without a usable skill", () => {
    expect(parseSkillDraft("Sure, here you go")).toBeNull();
    expect(parseSkillDraft("---\nname: x\n---\nbody")).toBeNull();
    expect(parseSkillDraft("---\nname: x\ndescription: d\n---\n")).toBeNull();
  });
  it("slugs names to the folder rule", () => {
    expect(slugify("  Fix: the BUG!! ")).toBe("fix-the-bug");
    expect(slugify("a".repeat(100))).toHaveLength(64);
  });
});

describe("draft sources", () => {
  it("takes the last real user message and one line per tool step", () => {
    const messages = [
      { id: "1", role: "user", content: "first" },
      { id: "2", role: "user", content: "[hook]", notice: "hook_note" },
      { id: "3", role: "user", content: "fix the build" },
    ] as never;
    expect(lastAsk(messages)).toBe("fix the build");
    const steps = [
      { id: "a", type: "reading", content: "src/a.ts", tool: "read_file" },
      { id: "b", type: "text", content: "thinking" },
    ] as never;
    expect(toolSequence(steps)).toEqual(["read_file: src/a.ts"]);
  });
  it("keeps a skill offer out of a compaction transcript", () => {
    const text = renderTranscript([
      { id: "1", role: "user", content: "hi" },
      { id: "2", role: "user", content: "offer", notice: "skill_draft" },
    ] as never);
    expect(text).toBe("User: hi");
  });
});
