import { createContext } from "react";
import type { ResearchRunView } from "../research/runView";
import type { SearchStep } from "../types";

/** The research run a reply cites, so `[n1]` in its text can name a source. Null outside research. */
export const CitationContext = createContext<ResearchRunView | null>(null);

export function runOf(steps: SearchStep[]): ResearchRunView | null {
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    if (steps[at].type === "research_run" && steps[at].researchRun) return steps[at].researchRun!;
  }
  return null;
}
