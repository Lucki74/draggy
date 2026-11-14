/** Swaps a page already worked into notes for a short receipt in the model's messages, so a long run keeps its context flat.
 * Only the wire copy changes; the steps the screen draws are untouched. */
import type { ResearchRun } from "./run";

const PAGE = /^TOOL RESULT \(read_url\):\nSource id: (s\d+)\./;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The receipt for a read_url result, or null while no note rests on that page. */
export function receiptFor(run: ResearchRun, content: string): string | null {
  const id = PAGE.exec(content)?.[1];
  const source = id ? run.sources.find((entry) => entry.id === id) : undefined;
  const notes = run.notes.filter((note) => note.sourceId === id);
  if (!id || !source || notes.length === 0) return null;
  return [
    "TOOL RESULT (read_url): Receipt. The page text was dropped to save space; search_notes has the quotes.",
    `Title: ${source.title}`,
    `URL: ${source.url}`,
    `Source id: ${id}`,
    `Notes taken: ${notes.map((note) => `${note.id} ${clip(note.claim, 100)}`).join("; ")}`,
  ].join("\n");
}

/** Replaces read_url results in place. Returns how many were swapped. */
export function applyReceipts(wire: { role: string; content: string }[], run: ResearchRun): number {
  let swapped = 0;
  for (let at = 0; at < wire.length; at += 1) {
    const entry = wire[at];
    if (entry.role !== "tool" && entry.role !== "user") continue;
    const receipt = receiptFor(run, entry.content);
    if (receipt === null) continue;
    wire[at] = { ...entry, content: receipt };
    swapped += 1;
  }
  return swapped;
}

/** Where the run-state footer starts in a research tool result. */
const FOOTER = "\n\nRESEARCH: ";

/** Text-mode tool results come back as user messages, so those are told apart by their opening. */
const isResult = (entry: { role: string; content: string }) =>
  entry.role === "tool" || (entry.role === "user" && entry.content.startsWith("TOOL RESULT"));

/** `text` without its run-state footer, which is stale as soon as the next result arrives. */
export function withoutFooter(text: string): string {
  const start = text.lastIndexOf(FOOTER);
  return start === -1 ? text : text.slice(0, start);
}

/** Every research result ends with the whole run state, and only the newest is current. Older copies
 * are cut, so seven add_note calls do not carry seven copies of the notes list. Returns how many. */
export function dropStaleFooters(wire: { role: string; content: string }[]): number {
  let newest = -1;
  for (let at = wire.length - 1; at >= 0; at -= 1) {
    const entry = wire[at];
    if (isResult(entry) && entry.content.includes(FOOTER)) {
      newest = at;
      break;
    }
  }
  let cut = 0;
  for (let at = 0; at < newest; at += 1) {
    const entry = wire[at];
    if (!isResult(entry)) continue;
    const start = entry.content.lastIndexOf(FOOTER);
    if (start === -1) continue;
    wire[at] = { ...entry, content: entry.content.slice(0, start) };
    cut += 1;
  }
  return cut;
}
