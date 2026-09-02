/**
 * Cuts generated tokens into things worth saying aloud. The first cut is eager,
 * because until it lands the user hears silence; the rest are patient.
 */

/**
 * A complete sentence is safe at any length: "Yes." should be heard while the
 * rest is still being written. A comma is riskier and needs words behind it.
 */
const FIRST_CLAUSE_MIN = 6;
const FIRST_CHUNK_MAX = 90;

/**
 * Fragments after the first wait for enough text to carry their own rhythm: a
 * synthesiser given whole sentences beats one fed three words at a time.
 */
const CHUNK_MIN = 70;

/** Web Speech stalls or truncates on very long utterances, so cap them. */
const CHUNK_MAX = 220;

const SENTENCE_END = /[.!?。！？]["'”’)\]]?(\s|$)/;
const CLAUSE_END = /[,;:—–]["'”’)\]]?\s/;

/**
 * Full stops that are not the end of a sentence. Splitting on these produces
 * "doctor" and "Smith" as separate utterances, with a breath between them.
 */
const ABBREVIATION =
  /(?:^|\s)(?:[A-Za-z]|mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|approx|fig|no|inc|ltd|jr|sr|dept|univ|al)\.$/i;

const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const CODE_FENCE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`([^`\n]*)`/g;
const URL = /\bhttps?:\/\/\S+/g;
const MARKUP = /[*_~#>|]|\p{Extended_Pictographic}|️/gu;

/**
 * Strips everything a synthesiser would either read out as punctuation noise or
 * silently mangle. Link text survives, link targets do not.
 */
export function speakableText(text: string): string {
  return text
    .replace(CODE_FENCE, " ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(URL, " ")
    .replace(MARKUP, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function endsOnAbbreviation(text: string): boolean {
  return ABBREVIATION.test(text) || /\d\.$/.test(text);
}

/**
 * Finds where to cut, or -1 to keep waiting. `eager` relaxes the rules for the
 * opening fragment.
 */
export function findCut(buffer: string, eager: boolean): number {
  const minimum = eager ? 0 : CHUNK_MIN;

  let search = 0;
  for (;;) {
    const rest = buffer.slice(search);
    const match = rest.match(SENTENCE_END);
    if (!match || match.index === undefined) break;

    const cut = search + match.index + match[0].length;
    if (!endsOnAbbreviation(buffer.slice(0, cut).trimEnd())) {
      if (cut >= minimum) return cut;
    }
    search = cut;
  }

  // No sentence has landed yet. The opening fragment may still leave on a
  // comma, and any fragment must leave before it grows past the cap.
  if (eager) {
    const clause = buffer.match(CLAUSE_END);
    if (clause?.index !== undefined) {
      const cut = clause.index + clause[0].length;
      if (cut >= FIRST_CLAUSE_MIN && cut <= FIRST_CHUNK_MAX) return cut;
    }
  }

  if (buffer.length >= CHUNK_MAX) {
    const space = buffer.lastIndexOf(" ", CHUNK_MAX);
    return space > 0 ? space + 1 : CHUNK_MAX;
  }

  return -1;
}

export interface SentenceChunker {
  /** Feed generated text; returns whatever is ready to be spoken. */
  push: (text: string) => string[];
  /** Emit whatever is left at the end of a reply. */
  flush: () => string | null;
  reset: () => void;
}

export function createSentenceChunker(): SentenceChunker {
  let buffer = "";
  let emitted = 0;

  return {
    push(text) {
      buffer += text;
      const ready: string[] = [];

      for (;;) {
        const cut = findCut(buffer, emitted === 0);
        if (cut < 0) break;

        const piece = speakableText(buffer.slice(0, cut));
        buffer = buffer.slice(cut);

        if (piece) {
          ready.push(piece);
          emitted++;
        }
      }

      return ready;
    },

    flush() {
      const piece = speakableText(buffer);
      buffer = "";
      if (!piece) return null;
      emitted++;
      return piece;
    },

    reset() {
      buffer = "";
      emitted = 0;
    },
  };
}
