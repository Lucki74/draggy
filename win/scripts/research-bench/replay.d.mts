// Types for replay.mjs, which the bench script and the vitest tests share.
export type CorpusPage = {
  file: string;
  url: string;
  title: string;
  date: string;
  keywords: string[];
  body: string;
};
export type Corpus = { pages: CorpusPage[]; byUrl: Map<string, CorpusPage>; df: Map<string, number> };
export type Hit = { title: string; url: string; snippet: string };
export type ReplayPage = {
  title: string;
  text: string;
  site?: string;
  published?: string;
  url?: string;
  pageCount?: number;
  page?: number;
  pageNote?: string;
  blocked?: "human-verification" | "refused" | "unreachable";
  reason?: string;
};
export type ReplayLog = ({ tool: "search_web"; query: string; urls: string[] } | { tool: "read_url"; url: string })[];

export const CORPUS_DIR: string;
export function tokens(text: string): string[];
export function parsePage(raw: string, file: string): CorpusPage;
export function loadCorpus(dir?: string): Corpus;
export function search(corpus: Corpus, query: string, limit?: number): Hit[];
export function readPage(corpus: Corpus, url: string, page?: number): ReplayPage;
export function replayApi(
  corpus: Corpus,
  log?: ReplayLog,
): {
  searchWebDetailed: (query: string) => Promise<{ results: Hit[]; provider: string; tried: string[]; status: "ok" | "empty" }>;
  searchSource: (query: string) => Promise<{ results: Hit[]; provider: string; tried: string[]; status: "ok" | "empty" }>;
  readUrl: (url: string, page?: number) => Promise<ReplayPage>;
};
