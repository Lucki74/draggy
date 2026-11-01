import { linkWord, normalizeSpeech, snippetWord } from "./normalize";
import { protectCues, restoreCues } from "./vocalSounds";

/** Cuts generated tokens into things worth saying aloud. The first cut is eager, because until it
 * lands the user hears silence; the rest are patient. */

/** A complete sentence is safe at any length: "Yes." should be heard while the rest is still being
 * written. A comma is riskier and needs words behind it. */
const FIRST_CLAUSE_MIN = 6;
const FIRST_CHUNK_MAX = 90;

/** Fragments after the first wait for enough text to carry their own rhythm: a synthesiser given
 * whole sentences beats one fed three words at a time. */
const CHUNK_MIN = 70;

/** Web Speech stalls or truncates on very long utterances, so cap them. */
const CHUNK_MAX = 220;

/** How big a fragment may grow after the first. Engines that run well ahead of real time prefer
 * whole sentences, with fewer joins. */
export interface ChunkLimits {
  min: number;
  max: number;
}

const DEFAULT_LIMITS: ChunkLimits = { min: CHUNK_MIN, max: CHUNK_MAX };

const SENTENCE_END = /[.!?。！？]["'”’)\]]?(\s|$)/;
const CLAUSE_END = /[,;:—–]["'”’)\]]?\s/;

/** Full stops that are not the end of a sentence. Splitting on these produces "doctor" and "Smith"
 * as separate utterances, with a breath between them. */
const ABBREVIATION =
  /(?:^|\s)(?:[A-Za-z]|mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|approx|fig|no|inc|ltd|jr|sr|dept|univ|al)\.$/i;

const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const CODE_FENCE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`([^`\n]*)`/g;
const URL = /\bhttps?:\/\/\S+/g;
const MARKUP = /[*_~#>|]|\p{Extended_Pictographic}|️/gu;

/** Strips everything a synthesiser would either read out as punctuation noise or silently mangle.
 * Link text survives, link targets do not. */
export function speakableText(text: string, language?: string): string {
  // Sound cues (<breath>, <laugh>...) are the one markup that must survive: MARKUP eats their ">".
  const clean = protectCues(text)
    .replace(CODE_FENCE, language ? ` ${snippetWord(language)} ` : " ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(URL, language ? ` ${linkWord(language)} ` : " ")
    .replace(MARKUP, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return restoreCues(language ? normalizeSpeech(clean, language) : clean);
}

function endsOnAbbreviation(text: string): boolean {
  return ABBREVIATION.test(text) || /\d\.$/.test(text);
}

/** How a fragment ends, so the voice knows whether intonation should fall. A "sentence" and a
 * "final" fragment end a thought; a "clause" or "forced" one is a continuation. */
export type Boundary = "sentence" | "clause" | "forced" | "final";

export interface Fragment {
  text: string;
  boundary: Boundary;
}

/** Where a long run with no punctuation is best split, most natural first. */
const CONJUNCTION =
  /\s(?:and|but|because|so|or|while|which|that|et|mais|parce que|donc|ou|y|pero|porque|pues|o|и|но|или|потому что|поэтому|который)\s/gi;
const CJK_CLAUSE = /[，、]/g;

function lastMatchBefore(pattern: RegExp, buffer: string, limit: number): number {
  let best = -1;
  for (const match of buffer.slice(0, limit).matchAll(pattern)) {
    if (match.index !== undefined) best = match.index;
  }
  return best;
}

/** A forced cut: a clause mark, else just before a conjunction, else the last space. */
function forcedCut(buffer: string, max: number): number {
  const window = buffer.slice(0, max);
  const floor = Math.floor(max / 3);

  const clause = lastMatchBefore(new RegExp(CLAUSE_END.source, "g"), window, max);
  if (clause >= floor) return clause + 2;

  const cjk = lastMatchBefore(CJK_CLAUSE, window, max);
  if (cjk >= floor) return cjk + 1;

  const conjunction = lastMatchBefore(CONJUNCTION, window, max);
  if (conjunction >= floor) return conjunction + 1;

  const space = buffer.lastIndexOf(" ", max);
  return space > 0 ? space + 1 : max;
}

/** Finds where to cut and what kind of cut it is, or null to keep waiting.
 * `eager` relaxes the rules for the opening fragment. */
export function findBoundary(
  buffer: string,
  eager: boolean,
  limits: ChunkLimits = DEFAULT_LIMITS,
): { cut: number; boundary: Boundary } | null {
  const minimum = eager ? 0 : limits.min;

  let search = 0;
  for (;;) {
    const rest = buffer.slice(search);
    const match = rest.match(SENTENCE_END);
    if (!match || match.index === undefined) break;

    const cut = search + match.index + match[0].length;
    // A sentence past the cap is cut by force below rather than handed over whole.
    if (cut > limits.max) break;
    if (!endsOnAbbreviation(buffer.slice(0, cut).trimEnd())) {
      if (cut >= minimum) return { cut, boundary: "sentence" };
    }
    search = cut;
  }

  // No sentence has landed yet. The opening fragment may still leave on a
  // comma, and any fragment must leave before it grows past the cap.
  if (eager) {
    const clause = buffer.match(CLAUSE_END);
    if (clause?.index !== undefined) {
      const cut = clause.index + clause[0].length;
      if (cut >= FIRST_CLAUSE_MIN && cut <= FIRST_CHUNK_MAX) return { cut, boundary: "clause" };
    }
  }

  if (buffer.length >= limits.max) return { cut: forcedCut(buffer, limits.max), boundary: "forced" };

  return null;
}

/** Finds where to cut, or -1 to keep waiting. */
export function findCut(buffer: string, eager: boolean): number {
  return findBoundary(buffer, eager)?.cut ?? -1;
}

export interface SentenceChunker {
  /** Feed generated text; returns whatever is ready to be spoken. */
  push: (text: string) => string[];
  /** Same as push, with how each fragment ends. */
  pushFragments: (text: string) => Fragment[];
  /** Emit whatever is left at the end of a reply. */
  flush: () => string | null;
  flushFragment: () => Fragment | null;
  reset: () => void;
}

/** A Japanese or Korean character carries about three Latin characters of speech, and the synthesiser
 * stalls on long runs of it, so CJK fragments are held to a third of the character limits. */
const CJK_LANGUAGES = /^(ja|ko)/i;

export function createSentenceChunker(language?: string, engineLimits: ChunkLimits = DEFAULT_LIMITS): SentenceChunker {
  const limits: ChunkLimits =
    language && CJK_LANGUAGES.test(language)
      ? { min: Math.ceil(engineLimits.min / 3), max: Math.ceil(engineLimits.max / 3) }
      : engineLimits;
  let buffer = "";
  let emitted = 0;

  const pushFragments = (text: string): Fragment[] => {
    buffer += text;
    const ready: Fragment[] = [];

    for (;;) {
      const found = findBoundary(buffer, emitted === 0, limits);
      if (!found) break;

      const piece = speakableText(buffer.slice(0, found.cut), language);
      buffer = buffer.slice(found.cut);

      if (piece) {
        ready.push({ text: piece, boundary: found.boundary });
        emitted++;
      }
    }

    return ready;
  };

  const flushFragment = (): Fragment | null => {
    const piece = speakableText(buffer, language);
    buffer = "";
    if (!piece) return null;
    emitted++;
    return { text: piece, boundary: "final" };
  };

  return {
    pushFragments,
    flushFragment,
    push: (text) => pushFragments(text).map((fragment) => fragment.text),
    flush: () => flushFragment()?.text ?? null,
    reset() {
      buffer = "";
      emitted = 0;
    },
  };
}
