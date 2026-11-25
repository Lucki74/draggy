/** Arguments bigger than this go to the shell in chunks, since one large invoke body fails over the custom protocol. */
export const STAGE_THRESHOLD = 64 * 1024;
const STAGE_CHUNK = 48 * 1024;

/** Cuts text into pieces of at most `size` code units, never between the halves of a surrogate pair. */
export function splitText(text: string, size: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    const last = text.charCodeAt(end - 1);
    // A chunk of one unit cannot avoid the split, so only larger chunks step back.
    if (end < text.length && end - 1 > start && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

/** The chunks that carry a large argument list, or null when it is small enough to send whole. */
export function stagedChunks(json: string): string[] | null {
  if (json.length <= STAGE_THRESHOLD) return null;
  return splitText(json, STAGE_CHUNK);
}
