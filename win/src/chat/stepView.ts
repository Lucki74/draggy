import { hostnameOf } from "../utils";
import type { SearchStep } from "../types";

export interface StepView {
  /** The verb the step opens with, in the reader's language. */
  name: string;
  /** What it was called with, as mono key and value rows. */
  args: [string, string][];
  /** One muted line about what came of it. */
  result?: string;
}

const MARKUP = /\*\*(.+?)\*\*|`([^`]+)`/;

/** The text before the first bold or code span: "Read **a.ts**" gives "Read". */
function verbOf(content: string): string {
  const cut = content.search(/\*\*|`/);
  return (cut < 0 ? content : content.slice(0, cut)).trim();
}

/** The first bold or code span of a step's sentence. */
function subjectOf(content: string): string {
  const match = MARKUP.exec(content);
  return match ? (match[1] ?? match[2] ?? "") : "";
}

/** "7 results" or "1 result" from a pair of translation keys, or nothing without a translator. */
function counted(t: ((key: string) => string) | undefined, keys: [string, string], n: number): string | undefined {
  if (!t) return undefined;
  return t(n === 1 ? keys[0] : keys[1]).replace("{n}", String(n));
}

/** A failed step: its verb, what it was called on and the reason when it has one. */
function errorView(step: SearchStep, name: string, subject: string): StepView | null {
  const first = step.content.indexOf("`");
  const last = step.content.lastIndexOf("`");
  const reason = step.reason || (first >= 0 && last > first ? step.content.slice(last + 1).replace(/^\s*:\s*/, "").trim() : "");
  const result = reason ? { result: reason } : {};
  if (first >= 0 && last > first) return { name, args: [["command", step.content.slice(first + 1, last)]], ...result };
  const target = subject || step.filename;
  return target && step.filename ? { name, args: [["file", target]], ...result } : null;
}

/** A step split into its verb, arguments and result, or null when it has no such shape and keeps its sentence. */
export function stepView(step: SearchStep, t?: (key: string) => string): StepView | null {
  const name = verbOf(step.content);
  if (!name) return null;
  const subject = subjectOf(step.content);

  switch (step.type) {
    case "reading":
    case "library": {
      const target = subject || step.filename || step.filepath || step.url;
      if (!target) return null;
      const result =
        step.type === "library"
          ? counted(t, ["passageCount_one", "passageCount_other"], step.libraryHits?.length ?? 0)
          : step.lines !== undefined
            ? counted(t, ["lineCount_one", "lineCount_other"], step.lines)
            : undefined;
      return { name, args: [[step.url && !step.filepath ? "url" : "file", target]], ...(result ? { result } : {}) };
    }
    case "opening":
    case "navigating":
    case "loaded": {
      const target = step.url || subject;
      return target ? { name, args: [["url", step.url ? hostnameOf(step.url) || step.url : target]] } : null;
    }
    case "searching":
      return subject ? { name, args: [["query", subject]] } : null;
    case "results": {
      if (!subject) return null;
      const result = counted(t, ["resultCount_one", "resultCount_other"], step.results?.length ?? 0);
      return { name, args: [["query", subject]], ...(result ? { result } : {}) };
    }
    case "edit_file": {
      const target = subject || step.filename || step.filepath;
      // The diff block under the step already counts the lines.
      return target ? { name, args: [["file", target]] } : null;
    }
    case "error":
      return errorView(step, name, subject);
    case "command":
    case "run_code": {
      const command = step.content.slice(step.content.indexOf("`") + 1, step.content.lastIndexOf("`"));
      if (!command || step.content.indexOf("`") === step.content.lastIndexOf("`")) return null;
      const tail = step.content.slice(step.content.lastIndexOf("`") + 1).replace(/^\s*:\s*/, "").trim();
      return { name, args: [["command", command]], ...(tail ? { result: tail } : {}) };
    }
    case "skill":
    case "git":
    case "extension":
      return subject ? { name, args: [["name", subject]] } : null;
    default:
      return null;
  }
}
