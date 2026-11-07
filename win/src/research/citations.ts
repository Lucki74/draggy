// Checks that quotes attributed to a source actually appear in the fetched page text.
// Both sides go through the same normalisation so typography differences cannot cause false misses.
export type CitationVerdict = "verified" | "near" | "unverified";

export type Citable = { id: string; claim: string; quote: string; sourceId: string };

const MIN_QUOTE_WORDS = 3;
const MAX_PAGE_CHARS = 400_000;
const DASH_CHARS = /[‐‑‒–—―−]/g;
const SINGLE_QUOTE_CHARS = /[‘’‚‛′]/g;
const DOUBLE_QUOTE_CHARS = /[“”„‟″]/g;
const NON_WORD_CHARS = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN = /\s+/g;

/** Reduces text to lowercase letters, digits and single spaces so typography cannot break a match. */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(SINGLE_QUOTE_CHARS, "")
    .replace(/'/g, "")
    .replace(DOUBLE_QUOTE_CHARS, " ")
    .replace(DASH_CHARS, " ")
    .replace(NON_WORD_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/** True when the quote appears verbatim in the page as whole words after normalisation. */
export function quoteAppears(quote: string, page: string): boolean {
  const needle = normaliseForMatch(quote);
  if (needle === "" || splitWords(needle).length < MIN_QUOTE_WORDS) {
    return false;
  }
  // Space padding stops a short quote from matching inside a longer word.
  return ` ${normaliseForMatch(page)} `.includes(` ${needle} `);
}

/** Returns the longest contiguous run of quote words found in the page, as a share of the quote. */
export function bestMatchRatio(quote: string, page: string): number {
  const quoteWords = splitWords(normaliseForMatch(quote));
  if (quoteWords.length === 0) {
    return 0;
  }
  // Capped so a huge scraped page cannot make the quadratic scan run for seconds.
  const pageWords = splitWords(normaliseForMatch(page.slice(0, MAX_PAGE_CHARS)));

  let prev = new Uint32Array(pageWords.length + 1);
  let curr = new Uint32Array(pageWords.length + 1);
  let best = 0;
  for (const word of quoteWords) {
    curr.fill(0);
    for (let j = 1; j <= pageWords.length; j++) {
      if (word === pageWords[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) {
          best = curr[j];
        }
      }
    }
    [prev, curr] = [curr, prev];
  }
  return best / quoteWords.length;
}

/** Verified when the quote appears verbatim, near when most of its words do, otherwise unverified. */
export function judgeCitation(quote: string, page: string, nearThreshold = 0.6): CitationVerdict {
  if (quoteAppears(quote, page)) {
    return "verified";
  }
  if (splitWords(normaliseForMatch(quote)).length < MIN_QUOTE_WORDS) {
    return "unverified";
  }
  return bestMatchRatio(quote, page) >= nearThreshold ? "near" : "unverified";
}

/** Judges every note against the page of its source. A missing page is unverified. */
export function verifyCitations(notes: Citable[], pages: Map<string, string>): Map<string, CitationVerdict> {
  const verdicts = new Map<string, CitationVerdict>();
  for (const note of notes) {
    const page = pages.get(note.sourceId);
    verdicts.set(note.id, page === undefined ? "unverified" : judgeCitation(note.quote, page));
  }
  return verdicts;
}

function splitWords(normalised: string): string[] {
  return normalised.split(" ").filter((word) => word.length > 0);
}
