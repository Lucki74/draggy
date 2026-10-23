---
name: source-evaluation
description: Rates one source for reliability by checking who wrote it, how they know, who paid, how recent it is and whether it fits the claim it is used for. Use when the user asks if a source, site, report or author can be trusted.
---

# Source evaluation

## Goal

Return a clear verdict on one source for one purpose: strong, usable with care, or weak. The verdict comes with the evidence behind it, so the user can disagree with it.

## When to use

- The user pastes a link, report or author name and asks if it is reliable.
- A source is about to carry weight in an essay, a report or a decision.
- To test a claim itself, use `use_skill` with `fact-check`. To read for slant, use `bias-check`.

## Steps

1. **Fix the purpose.** Ask what the source is supposed to support. A blog can be fine for a product opinion and useless for a medical statistic. Use `ask_user` if the purpose is not stated.
2. **Open the source.** Use `read_url` and read the page, the byline, the date and any methods or about section.
3. **Check authorship.** Find the author's name and background. Use `search_web` for the author plus the topic. Look for training, past work and employer in the field.
4. **Check the publisher.** Search for the outlet's own about page, ownership and correction policy. Note who funds it and whether it sells what it reviews.
5. **Check method.** For data or studies, find how it was gathered: sample, period, definitions. If there is no method at all, that is a finding.
6. **Check support.** Click three of its links. Do they say what the page claims they say?
7. **Check date and updates.** Find publication and last update dates. Judge whether the topic moves fast enough for the age to matter.
8. **Check corroboration.** Search for the same main claim from a source with no tie to this one.
9. **Score and explain.** Give a verdict for the stated purpose, then list the two strongest points for and against.
10. **Say what would change the verdict.** Name one fact that, if found, would move the rating up or down.
11. **Offer a safer use.** If the source is weak, suggest a stronger one or a narrower way to use it.

## Gotchas

- A professional look proves nothing. Clean design, a .org address or a long reference list are cheap to produce.
- A real expert writing outside their field is not an expert there. Match the credential to the exact claim.
- Authority can be borrowed: a page quoting a reputable body may have bent the quote. Open the cited item.
- An outlet can be reliable on news and weak on its opinion section, or the reverse. Rate the piece, not the brand.
- Missing information is not proof of bad faith. Say "could not find the author", not "the author is hiding".
- Do not rate on political lean alone. Rate on method and accuracy record.
- Self-published pages often copy the look of institutions. Check that the named institution lists the author.
- Anonymous sources can be fine (wire reports, official bodies). Anonymous plus no method is the problem.

## Output

A short verdict line first, for example "Usable with care for background, not for the figure in paragraph 3." Then a list of evidence under author, publisher, method, support, date. End with what would raise or lower the rating. Keep it under 250 words unless asked.
