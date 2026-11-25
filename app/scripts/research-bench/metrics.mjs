// Offline metrics for the research bench: citation parsing, quote checks and the grader prompt.

/** Lowercase, straighten quotes and collapse white space so a quote compares to page text. */
export const normalise = (s) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const SOURCES_HEADING = /^\s*(?:#+\s*|\*\*)?(?:sources|references)\s*:?\**\s*$/im;
const CITATION = /^\s*[-*]?\s*\[(\d+)\]\s*<?(https?:\/\/[^\s>]+?)>?\s*[-—–:]*\s*["“](.+?)["”]\s*$/;

/** Splits a final answer into its text and the cited sources listed under a Sources heading. */
export function parseAnswer(text) {
  const m = SOURCES_HEADING.exec(text);
  const body = (m ? text.slice(0, m.index) : text).trim();
  const citations = [];
  if (m) {
    for (const line of text.slice(m.index + m[0].length).split("\n")) {
      const c = CITATION.exec(line);
      if (c) citations.push({ n: Number(c[1]), url: c[2].replace(/[.,;]+$/, ""), quote: c[3] });
    }
  }
  return { body, citations };
}

/** Precision: cited quotes found verbatim in the cited corpus page, over all citations. */
export function citationPrecision(citations, corpus) {
  let supported = 0;
  for (const c of citations) {
    const page = corpus.byUrl.get(c.url);
    if (page && normalise(c.quote).length >= 8 && normalise(page.body).includes(normalise(c.quote))) supported += 1;
  }
  return { supported, total: citations.length };
}

/** Recall, approximated offline: sentences of the answer that carry a [n] marker over all sentences. */
export function citationRecall(body) {
  const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length >= 3);
  return { cited: sentences.filter((s) => /\[\d+\]/.test(s)).length, total: sentences.length };
}

export const fillTemplate = (template, values) =>
  template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all));

/** Reads the grader's JSON verdict; anything else counts as incorrect. */
export function parseVerdict(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) {
    try {
      const v = JSON.parse(m[0]);
      if (["correct", "partial", "incorrect"].includes(v.verdict)) return v.verdict;
    } catch {
      // fall through to incorrect
    }
  }
  return "incorrect";
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
