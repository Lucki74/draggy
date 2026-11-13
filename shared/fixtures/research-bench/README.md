# Research benchmark question set

This folder holds the questions for the research benchmark: `questions.json`, `graders.json` and a fixed `corpus/` of fictional web pages.

The set has 120 questions: 40 `factual`, 40 `multihop` and 40 `report`. The factual and report questions use facts that do not change. Their gold answers were checked in the `asOf` month and should be rechecked if a fact is ever disputed.

## What each set measures

- `multihop`: research skill. Every question is answered from the fictional corpus, which no model has seen, so a correct answer needs search and reading. Each question needs 2 to 4 pages.
- `factual`: citation behaviour, not knowledge. A model can answer these from memory, so accuracy tells you little. What matters is whether the run searches anyway, cites a source and quotes it correctly.
- `report`: coverage and citation quality of a longer write-up on a common topic.

## questions.json

Each entry is an object with these fields:

- `id`: unique string. `f` for factual, `m` for multi-hop, `r` for report.
- `kind`: `factual` (one short fact), `multihop` (two to four linked facts) or `report` (a write-up that covers several points).
- `question`: the text sent to a research run.
- `gold`: the reference answer. For a report question it is a list of key points separated by semicolons.
- `acceptable`: optional list of other correct wordings.
- `depth`: `quick`, `standard` or `deep`.
- `sources`: source types a good run should use: `web`, `papers`, `wiki` or `code`.
- `area`: optional topic label.
- `asOf`: month the gold was checked, `2026-11`.
- `goldPages` (multi-hop only): URLs of the corpus pages the answer needs.
- `evidence` (multi-hop only): one `{url, quote}` per supporting fact. Each quote is copied from the page, and the test fails if one stops matching.

## corpus/

The corpus has 65 short pages about invented open-source libraries, companies, a town, a research lab and product documentation. All hosts end in `.example`. The facts are consistent across pages but none are real.

Each file in `corpus/pages/` starts with a front matter block (`url`, `title`, `date`, `keywords`) followed by the Markdown body. `corpus/index.json` lists the same four fields for every page, so a tool can search without parsing the pages. A test keeps the index and the pages in step.

Some pages are there to mislead on purpose:

- Near-identical names: two projects called Brindle, two called Pellucid, two Gantry tools, two towns called Veldmoor, and Fenwright Labs against Fenwick Laboratories.
- Older pages that contradict newer ones, such as the 3.x retry defaults, the 2.1 compaction threshold, datasheet revision A and the 2018 town history. A run has to prefer the newer date.
- A correction (the Hearthdb erratum) that overrides a number printed in a paper.

When you add or change a page, update `index.json` and any `evidence` quotes that point at it, then run `npx vitest run src/__tests__/researchReplay.test.ts` from `win/`.

## Replay

In replay mode `search_web` and `read_url` are served from the corpus and nothing touches the network.

- `win/scripts/research-bench/replay.mjs` holds the search and read code. Search scores keyword, title and body matches, weights rare words higher and breaks ties by URL, so a query always returns the same list.
- `replayApi()` has the shape of the `searchWebDetailed` and `readUrl` methods on the `window.draggy` bridge (`win/src/types.d.ts`). A test can assign it to `window.draggy` and run the real tools.
- `node scripts/research-bench.mjs --endpoint <url>/v1 --model <name>` from `win/` runs the multi-hop questions against any OpenAI-compatible chat endpoint. It is run by hand and no test or CI job calls it.

The script reports accuracy, citation precision, citation recall, sources per report, gold pages read, tool calls and wall time. Precision counts a citation as supported when its quote appears in the cited corpus page. Recall is approximate: it is the share of answer sentences that carry a `[n]` marker. Repeated query rate, peak context and the blocked search rate need the app or live mode, so the script leaves them out.

## Grading

An LLM grader checks each answer with the templates in `graders.json`.

- Accuracy: the grader compares the answer with `gold` and `acceptable`. For a report, it counts how many key points the answer covers.
- Citation precision: for each cited claim, the grader reads the quoted passage and decides whether it supports the claim. Precision is supported citations divided by all citations. In replay mode the script checks the quote against the page text instead.
- Citation recall: for each factual claim that needs a source, the grader decides whether the answer cites it. Recall is cited claims divided by claims that need a source.

Templates use the placeholders `{question}`, `{gold}`, `{answer}`, `{claim}` and `{quote}`. Humans spot-check 10 percent of graded answers.
