import { diffLines } from "./diff";
import { hostnameOf } from "../utils";
import type { SearchStep } from "../types";

type Kind = "read" | "site" | "created" | "edited" | "ran" | "searched" | "browsed" | "other";

const KIND_OF: Partial<Record<SearchStep["type"], Kind>> = {
  reading: "read",
  library: "read",
  edit_file: "edited",
  run_code: "ran",
  command: "ran",
  searching: "searched",
  // Old saved chats opened a page with no address on the step.
  opening: "searched",
  navigating: "browsed",
  loaded: "browsed",
  clicking: "browsed",
  typing: "browsed",
  scanned: "browsed",
};

const ORDER: Kind[] = ["read", "site", "created", "edited", "ran", "searched", "browsed", "other"];

/** Translation keys are work<Name>_one and work<Name>_other. */
const KEY: Record<Kind, string> = {
  read: "Read",
  site: "ReadPages",
  created: "Created",
  edited: "Edited",
  ran: "Ran",
  searched: "Searched",
  browsed: "Browsed",
  other: "Other",
};

/** Steps that fold into a work block. Prose, reasoning, questions for the user and written files
 * stay in the transcript on their own. */
export function isWorkStep(step: SearchStep) {
  return !["text", "thinking", "approval", "create_file", "app", "image"].includes(step.type) &&
    !(step.type === "loading" && !step.isComplete);
}

/** "Read 3 files, edited 2 files and ran 1 command", in the reader's language. */
export function summarizeWork(steps: SearchStep[], language: string, t: (key: string) => string) {
  const counts = new Map<Kind, number>();
  const sites = new Set<string>();
  let failed = 0;
  for (const step of steps) {
    if (step.type === "error") {
      failed += 1;
      continue;
    }
    if (step.type === "loading") continue;
    // A search is its "searching" step plus the "results" row it fills in: one search, not two.
    if (step.type === "results") continue;
    const host = (step.type === "reading" || step.type === "opening") && step.url
      ? hostnameOf(step.url).replace(/^www\./i, "")
      : "";
    if (host) {
      sites.add(host);
      counts.set("site", (counts.get("site") ?? 0) + 1);
      continue;
    }
    const kind = step.created ? "created" : (KIND_OF[step.type] ?? "other");
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  let plural: Intl.PluralRules;
  try {
    plural = new Intl.PluralRules(language);
  } catch {
    plural = new Intl.PluralRules("en");
  }
  const listOf = (items: string[]) => {
    try {
      return new Intl.ListFormat(language, { type: "conjunction" }).format(items);
    } catch {
      return items.join(", ");
    }
  };
  const phrase = (key: string, n: number) => {
    const form = plural.select(n) === "one" ? "one" : "other";
    return t(`work${key}_${form}`).replace("{n}", String(n));
  };

  const parts = ORDER.filter((kind) => counts.has(kind)).map((kind, index) => {
    // One or two sites are named; more are counted.
    const text = kind === "site" && sites.size > 0 && sites.size <= 2
      ? t("workReadSite").replace("{sites}", listOf([...sites]))
      : phrase(KEY[kind], counts.get(kind)!);
    return index === 0 ? text : text.charAt(0).toLocaleLowerCase(language) + text.slice(1);
  });
  if (failed > 0) parts.push(phrase("Failed", failed));

  return { text: listOf(parts), failed };
}

/** Lines added and removed by one file step, or null when it has no diff. */
export function stepTotals(step: SearchStep) {
  if (step.type !== "edit_file" || step.before === undefined || step.after === undefined) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of diffLines(step.before, step.after).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") added += 1;
      else if (line.kind === "removed") removed += 1;
    }
  }
  return { added, removed };
}

export function editTotals(steps: SearchStep[]) {
  let added = 0;
  let removed = 0;
  for (const step of steps) {
    const totals = stepTotals(step);
    if (!totals) continue;
    added += totals.added;
    removed += totals.removed;
  }
  return { added, removed };
}

/** Files the turn wrote or changed, once each, in the order first touched. */
export function touchedFiles(steps: SearchStep[]): { name: string; path: string; created: boolean }[] {
  const seen = new Map<string, { name: string; path: string; created: boolean }>();
  for (const step of steps) {
    if ((step.type !== "create_file" && step.type !== "edit_file") || !step.filepath) continue;
    if (!seen.has(step.filepath)) {
      seen.set(step.filepath, {
        name: step.filename || step.filepath,
        path: step.filepath,
        created: step.type === "create_file" || Boolean(step.created),
      });
    }
  }
  return [...seen.values()];
}
