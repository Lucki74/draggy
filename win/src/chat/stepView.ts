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

/** A step split into its verb, arguments and result, or null when it has no such shape and keeps its sentence. */
export function stepView(step: SearchStep): StepView | null {
  const name = verbOf(step.content);
  if (!name) return null;
  const subject = subjectOf(step.content);

  switch (step.type) {
    case "reading":
    case "library": {
      const target = subject || step.filename || step.filepath || step.url;
      return target ? { name, args: [[step.url && !step.filepath ? "url" : "file", target]] } : null;
    }
    case "opening":
    case "navigating":
    case "loaded": {
      const target = step.url || subject;
      return target ? { name, args: [["url", step.url ? hostnameOf(step.url) || step.url : target]] } : null;
    }
    case "searching":
      return subject ? { name, args: [["query", subject]] } : null;
    case "edit_file": {
      const target = subject || step.filename || step.filepath;
      // The diff block under the step already counts the lines.
      return target ? { name, args: [["file", target]] } : null;
    }
    case "error":
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
