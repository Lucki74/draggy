import type { SearchStep } from "../types";

/**
 * Rebuilds what a cut-off reply already did, from the steps, since tool results
 * do not survive the turn. Side effects are kept; repeating a write is not free.
 */

/** Total characters the recap may occupy. */
export const RESUME_BUDGET = 2000;

/** Reasoning is summarised down to its tail; the conclusion is what matters. */
const THOUGHT_BUDGET = 400;
const OUTPUT_BUDGET = 300;

function tail(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return "…" + clean.slice(clean.length - limit);
}

function head(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit) + "…";
}

/** Strips the markdown the step content carries for display. */
function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\.\.\.$/, "").trim();
}

interface Line {
  /** Lower sorts first and survives trimming. */
  priority: number;
  text: string;
}

function lineFor(step: SearchStep): Line | null {
  const label = plain(step.content || "");

  switch (step.type) {
    case "create_file":
      // The single most important thing to report: it is on disk already.
      return {
        priority: 0,
        text: step.filepath
          ? `Created the file ${step.filename ?? ""} at ${step.filepath}. It is already written; do not create it again.`
          : `Attempted to create ${step.filename ?? "a file"}: ${label}`,
      };

    case "run_code": {
      const output = step.stdout ? head(step.stdout, OUTPUT_BUDGET) : "";
      const failure = step.stderr ? head(step.stderr, OUTPUT_BUDGET) : "";
      return {
        priority: 0,
        text:
          `Ran ${step.language ?? "code"} already.` +
          (output ? ` Output: ${output}` : "") +
          (failure ? ` Errors: ${failure}` : "") +
          " Do not run it again unless it needs changing.",
      };
    }

    case "results": {
      const titles = (step.results ?? [])
        .slice(0, 4)
        .map((result) => `${result.title} (${result.url})`)
        .join("; ");
      return {
        priority: 1,
        text: titles ? `Search results already gathered: ${titles}` : label,
      };
    }

    case "library": {
      const hits = (step.libraryHits ?? [])
        .slice(0, 4)
        .map((hit) => hit.name)
        .join("; ");
      return { priority: 1, text: hits ? `${label} Found: ${hits}` : label };
    }

    case "reading":
    case "loaded":
    case "scanned":
    case "opening":
    case "navigating":
    case "clicking":
    case "typing":
      return label ? { priority: 2, text: label } : null;

    case "searching":
      // The matching "results" line says more; this is only a fallback.
      return label ? { priority: 3, text: label } : null;

    case "error":
      return label ? { priority: 1, text: `Failed: ${label}` } : null;

    case "text":
      return label ? { priority: 2, text: `Already said: ${head(label, 200)}` } : null;

    case "thinking":
      return step.content?.trim()
        ? { priority: 4, text: `Reasoning so far: ${tail(step.content, THOUGHT_BUDGET)}` }
        : null;

    default:
      return null;
  }
}

/**
 * A plain account of the work already done, or null when there was none.
 */
export function describeCompletedWork(
  steps: SearchStep[],
  budget: number = RESUME_BUDGET,
): string | null {
  const lines: Line[] = [];

  for (const step of steps) {
    // A step still in flight was interrupted; only finished work is reported
    // as done, so the model redoes anything that never completed.
    if (step.isComplete === false) continue;
    const line = lineFor(step);
    if (line?.text) lines.push(line);
  }

  if (lines.length === 0) return null;

  // Keep the order the work happened in, but drop the least important first
  // when there is not enough room for all of it.
  const ordered = lines.map((line, index) => ({ ...line, index }));
  const kept: typeof ordered = [];
  let used = 0;

  for (const line of [...ordered].sort(
    (a, b) => a.priority - b.priority || a.index - b.index,
  )) {
    const cost = line.text.length + 3;
    if (used + cost > budget) continue;
    used += cost;
    kept.push(line);
  }

  if (kept.length === 0) return null;

  kept.sort((a, b) => a.index - b.index);

  return kept.map((line) => `- ${line.text}`).join("\n");
}

/**
 * The message that goes on the wire ahead of the instruction to carry on.
 */
export function buildResumeMessage(steps: SearchStep[]): string | null {
  const work = describeCompletedWork(steps);
  if (!work) return null;

  return `You were part-way through this reply when it was cut short. This is what you had already done:\n\n${work}\n\nEverything above has really happened. Carry on from there rather than starting again.`;
}

/**
 * The longest repeat worth looking for where two halves of a reply meet.
 */
const MAX_OVERLAP = 120;

/**
 * Short matches are coincidence, not repetition: plenty of sentences happen to
 * end and begin with the same few characters.
 */
const MIN_OVERLAP = 12;

/** Enough of the opening to recognise the model starting over. */
const RESTART_SIGNATURE = 60;

/**
 * Joins a continued reply to what was written, with no separator: "salt" and
 * "water" must become "saltwater". Repetition is removed rather than trusted.
 */
export function joinContinuation(before: string, after: string): string {
  if (!before) return after;
  if (!after) return before;

  // Started over from the top: the new text is the better copy, since the old
  // one was cut off. Keeping both would print everything twice.
  const signature = before.slice(0, Math.min(RESTART_SIGNATURE, before.length));
  if (signature.length >= MIN_OVERLAP && after.startsWith(signature)) {
    return after;
  }

  // Re-said the tail before carrying on: drop the duplicated part.
  const limit = Math.min(MAX_OVERLAP, before.length, after.length);
  for (let size = limit; size >= MIN_OVERLAP; size--) {
    if (before.slice(-size) === after.slice(0, size)) {
      return before + after.slice(size);
    }
  }

  return before + after;
}
