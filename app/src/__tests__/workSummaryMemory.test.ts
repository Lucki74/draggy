import { describe, expect, it } from "vitest";
import { summarizeWork } from "../chat/workSummary";
import { translations } from "../translations";
import type { SearchStep } from "../types";

const t = (key: string) => translations.en[key] || key;
const step = (type: SearchStep["type"]) => ({ id: type, type, content: "", isComplete: true }) as SearchStep;

describe("work summary", () => {
  it("names a saved memory note on its own, apart from file edits", () => {
    expect(summarizeWork([step("memory")], "en", t).text).toBe("Saved 1 memory note");
    expect(summarizeWork([step("edit_file"), step("memory")], "en", t).text).toBe("Edited 1 file and saved 1 memory note");
  });
});
