---
name: fact-check
description: Checks whether a claim, quote, statistic, image caption or viral post is true, using primary sources where possible, and gives a clear verdict with evidence. Use when the user asks whether something is true, wants something verified, or shares a suspicious claim.
---

# Fact check

## Method

1. **Isolate the claim.** Restate precisely what is being asserted: who, what, when, how much. Split compound claims into separate checkable parts.
2. **Find the origin.** Search for the earliest or original source (the study, the speech, the official data, the full quote in context) with search_web and read_url. Many false claims are real facts stripped of context.
3. **Check against authoritative sources:** official statistics, the organisation or person quoted, peer-reviewed research, established fact-checkers, reputable reporting. Read the pages rather than relying on search snippets.
4. **Look for context:** Is the number from a different year, place or definition? Is the quote cut? Is the image from another event? Is the study preliminary, tiny, or misreported?
5. **Weigh it.** Consider how reliable each source is and whether sources are independent of each other.

If web access is not available, say so, give what you know with its limits, and explain how the user could check it.

## Verdict

Use one of: **True**, **Mostly true**, **Missing context**, **Misleading**, **Mostly false**, **False**, **Unverifiable** (not enough reliable evidence either way).

## Output

1. The claim, restated.
2. Verdict in bold.
3. Three to six lines explaining why, with the key evidence and inline source links.
4. What the accurate version would be, when the claim is wrong or misleading.
5. Sources you read.

Stay neutral and factual, especially on political or divisive topics: judge the claim, not the people making it.
