/** The small sounds a person makes around their words, asked for with inline cues (<laugh>). A cue
 * is kept only when the active engine voices it itself; nothing here synthesises audio. */

export type VocalSound = "breath" | "sigh" | "hmm" | "laugh";
export const VOCAL_SOUNDS: readonly VocalSound[] = ["breath", "sigh", "hmm", "laugh"];

// ------------------------------------------------------------------------------------------ cues

const CUE = /<\s*(breath|sigh|hmm|laugh)\s*\/?\s*>/gi;
/** A cue still being streamed in, "<la" before "ugh>" arrives. */
const TRAILING_PARTIAL = /<[a-z\s]*$/i;

export type Segment = { kind: "text"; text: string } | { kind: "sound"; sound: VocalSound };

/** Splits spoken text into words and sounds, in order. Cues the engine voices itself (Supertonic's
 * <laugh>) are left inside the text, written the way that engine expects them. */
export function splitCues(text: string, inline: ReadonlySet<VocalSound> = new Set()): Segment[] {
  const segments: Segment[] = [];
  let pending = "";
  let last = 0;
  for (const match of text.matchAll(CUE)) {
    const sound = match[1].toLowerCase() as VocalSound;
    pending += text.slice(last, match.index);
    last = (match.index ?? 0) + match[0].length;
    if (inline.has(sound)) {
      pending += `<${sound}>`;
      continue;
    }
    if (pending.trim()) segments.push({ kind: "text", text: pending.trim() });
    pending = "";
    segments.push({ kind: "sound", sound });
  }
  pending += text.slice(last);
  if (pending.trim()) segments.push({ kind: "text", text: pending.trim() });
  return segments;
}

/** Rewrites each cue as `<name>` when `keep` accepts it and removes it otherwise. */
export function filterCues(text: string, keep: (sound: VocalSound) => boolean): string {
  return text
    .replace(CUE, (_, name: string) => {
      const sound = name.toLowerCase() as VocalSound;
      return keep(sound) ? `<${sound}>` : " ";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/** The text as it should be shown: every cue gone, including one still arriving. */
export function stripCues(text: string): string {
  return text
    .replace(CUE, " ")
    .replace(TRAILING_PARTIAL, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trimStart();
}

/** Stands in for cues while text goes through cleaning that would eat their angle brackets. */
const GUARD = "\u2063";
export function protectCues(text: string): string {
  return text.replace(CUE, (_, name: string) => `${GUARD}${name.toLowerCase()}${GUARD}`);
}
export function restoreCues(text: string): string {
  return text.replace(new RegExp(`${GUARD}(breath|sigh|hmm|laugh)${GUARD}`, "g"), "<$1>");
}

const PLAYFUL = /\b(?:ha(?:ha)+|he(?:he)+|lol|lmao|rofl|ja(?:ja)+|jeje+|mdr|ptdr|xd)\b|哈哈|呵呵|嘻嘻|[😂🤣😄😆😜😝]/iu;

/** True when the person just joked or laughed, which is the only time the voice laughs back. */
export function isPlayful(text: string): boolean {
  return PLAYFUL.test(text);
}
