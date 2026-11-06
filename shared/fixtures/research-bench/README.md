# Research benchmark question set

This folder holds the questions for the research benchmark. It has two files, `questions.json` and `graders.json`.

The set has 120 questions: 40 `factual`, 40 `multihop` and 40 `report`. Each question uses only facts that do not change. Gold answers were checked in `asOf` month, and should be rechecked if a fact is ever disputed.

## questions.json

Each entry is an object with these fields:

- `id`: unique string. `f` for factual, `m` for multi-hop, `r` for report.
- `kind`: `factual` (one short fact), `multihop` (two or three linked facts) or `report` (a write-up that covers several points).
- `question`: the text sent to a research run.
- `gold`: the reference answer. For a report question it is a list of key points separated by semicolons.
- `acceptable`: optional list of other correct wordings.
- `depth`: `quick`, `standard` or `deep`.
- `sources`: source types a good run should use: `web`, `papers`, `wiki` or `code`.
- `area`: optional topic label.
- `asOf`: month the gold was checked, `2026-11`.

## Grading

An LLM grader checks each answer with the templates in `graders.json`.

- Accuracy: the grader compares the answer with `gold` and `acceptable`. For a report, it counts how many key points the answer covers.
- Citation precision: for each cited claim, the grader reads the quoted passage and decides whether it supports the claim. Precision is supported citations divided by all citations.
- Citation recall: for each factual claim that needs a source, the grader decides whether the answer cites it. Recall is cited claims divided by claims that need a source.

Templates use the placeholders `{question}`, `{gold}`, `{answer}`, `{claim}` and `{quote}`. Humans spot-check 10 percent of graded answers.
