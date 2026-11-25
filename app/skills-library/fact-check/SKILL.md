---
name: fact-check
description: Checks whether a claim, quote, statistic, image caption or viral post is true, using primary sources where possible, and gives a clear verdict with evidence. Use when the user asks "is this true", "can you verify this", "fact check this" or shares a suspicious claim.
---

# Fact check

## Goal

Give the user a verdict they can check themselves. A good result restates the claim precisely, rests on sources the agent actually read, and shows the accurate version when the claim is wrong.

## When to use

- The user asks whether a claim, quote, statistic, image caption or viral post is true.
- The user wants something verified before sharing or relying on it.
- For explaining a topic rather than judging a claim, use `use_skill` with `explain-concept`.

## Steps

1. Isolate the claim. Restate precisely what is asserted: who, what, when, how much. Split compound claims into separate checkable parts.
2. Call `start_research` with the parts as sub-questions, depth `quick`, and source `web`. Add `papers` or `wiki` only when the claim rests on a study or a figure. The user approves the plan first.
3. Find the origin. Search for the earliest source: the study, the speech, the official data, the full quote in context. Look for primary sources before secondary ones, and use the source the claim names when there is one.
4. Open each page with `read_url` and record every sentence that supports or contradicts the claim with `add_note`. Use `disputed` for conflicting sentences.
5. Look for context. Is the number from another year, place or definition? Is the quote cut? Is the image from another event? Is the study preliminary, tiny or misreported? Use `search_notes` to pull these together.
6. Weigh the sources. Consider how reliable each one is and whether it is independent of the others.
7. Call `finish_research`, then choose one verdict: **True**, **Mostly true**, **Missing context**, **Misleading**, **Mostly false**, **False**, or **Unverifiable** (not enough reliable evidence either way).
8. If web access is off, say so. Give what you know, mark its limits, and explain how the user could check it.

## Gotchas

- Many false claims are real facts stripped of context. Find the original before judging.
- Search snippets can mislead. Read the page.
- Several articles repeating one source are not independent confirmation.
- Judge the claim, not the people making it, especially on political or divisive topics. Stay neutral and factual.
- Without enough reliable evidence, the honest verdict is Unverifiable. Do not guess.

## Output

1. The claim, restated.
2. The verdict in bold.
3. Three to six lines explaining why, with the key evidence and inline source links.
4. The accurate version, when the claim is wrong or misleading.
5. The sources you read.
