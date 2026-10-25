---
name: fact-check
description: Checks whether a claim, quote, statistic, image caption or viral post is true, using primary sources where possible, and gives a clear verdict with evidence. Use when the user asks "is this true", "can you verify this", "fact check this" or shares a suspicious claim.
---

# Fact check

## Goal

Give the user a verdict they can trust and check themselves. A good result restates the claim precisely, rests on sources that were actually read, and shows what the accurate version is when the claim is wrong.

## When to use

- The user asks whether a claim, quote, statistic, image caption or viral post is true.
- The user wants something verified before sharing or relying on it.
- For explaining a topic rather than judging a claim, use `use_skill` with `explain-concept`.

## Steps

1. Isolate the claim. Restate precisely what is asserted: who, what, when, how much. Split compound claims into separate checkable parts.
2. Find the origin. Search for the earliest or original source (the study, the speech, the official data, the full quote in context) with `search_web` and `read_url`.
3. Check against authoritative sources: official statistics, the organisation or person quoted, peer-reviewed research, established fact-checkers, reputable reporting. Read the pages and do not rely on search snippets.
4. Look for context. Is the number from a different year, place or definition? Is the quote cut? Is the image from another event? Is the study preliminary, tiny, or misreported?
5. Weigh it. Consider how reliable each source is and whether the sources are independent of each other.
6. Choose one verdict: **True**, **Mostly true**, **Missing context**, **Misleading**, **Mostly false**, **False**, or **Unverifiable** (not enough reliable evidence either way).
7. If web access is not available, say so, give what you know with its limits, and explain how the user could check it.

## Gotchas

- Many false claims are real facts stripped of context. Find the original before judging.
- Search snippets can mislead. Read the page.
- Several articles repeating one source are not independent confirmation.
- Judge the claim, not the people making it, especially on political or divisive topics. Stay neutral and factual.
- Without enough reliable evidence the honest verdict is Unverifiable, not a guess.

## Output

1. The claim, restated.
2. Verdict in bold.
3. Three to six lines explaining why, with the key evidence and inline source links.
4. What the accurate version would be, when the claim is wrong or misleading.
5. Sources you read.
