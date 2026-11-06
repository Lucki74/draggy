---
name: deep-research
description: Answers a hard question with a cited report. Plans sub-questions, gathers sourced notes, cross-checks them and writes up what is established, what is disputed and what is unknown. Use when the user asks for deep research, a thorough investigation, or a report with sources.
---

# Deep research

## Goal

Give the user a report they can check. Every fact cites a note the agent recorded from a page it read, disagreements are shown, and gaps are named. A traceable answer matters more than a long one.

## When to use

- The question needs many sources and a synthesis, not one lookup.
- The user wants a written report with links on a topic they will act on.
- For one claim to check, use `use_skill` with `fact-check`. For today's headlines, use `news-brief`.

## Steps

1. Pin the question. Restate it in one sentence with scope, region, time range and the decision it feeds. If something unclear changes the answer, use `ask_user` once.
2. Call `start_research` with the question, the sub-questions one per line, a depth and the sources that fit. Use `deep` unless the user asked for less. Add `papers`, `wiki` or `code` where the topic has them. The user approves the plan before any search runs. If they edit it, work from the edited plan.
3. Search each sub-question with `search_web`, using at least two differently worded queries. Pick the `source` that fits the claim. Prefer the body that produced the data: regulators, statistics offices, courts, the paper itself, the company filing.
4. Open each page you plan to cite with `read_url`. Read the part that carries the claim, not only the intro. Follow a cited study to its own page when that page can be reached. A search snippet is a lead, never a citation.
5. After each useful page, call `add_note` with a claim in your own words, the exact sentence from the page, the `source_id` that `read_url` gave, and a confidence of `confirmed`, `single_source` or `disputed`.
6. Before searching again, call `search_notes` to see what is already recorded. Reuse notes instead of reopening the same page.
7. Cross-check each important claim against one independent source. Independent means it did not copy the first. Where sources differ, find the reason: definition, date, sample or method.
8. Call `finish_research` once the sub-questions are covered or the tools report the budget spent. Stop gathering there.
9. Write the report from the notes that `finish_research` returns. Cite each fact with its note id in brackets, such as [n1], and cite nothing else. Order: three-sentence answer, findings by sub-question, where sources disagree, what is not known, sources.
10. Save the report with `create_file` when it runs past about 1,500 words or when the user asks for a file. Put the plan and source list in that file so the work can be rerun later.
11. Reread the report against the notes. Every factual sentence needs a note id. Cut or soften any that has none.

## Gotchas

- Sub-questions drift. Check at the end that the report answers the question from step 1, not the most interesting thing found on the way.
- Several sites that repeat one origin count as one source. Check where they got the figure.
- Dates matter. A figure from before a rule change answers a different question. State the year beside each number.
- Confident prose hides weak evidence. Use the confidence labels in the text, for example "one study, small sample".
- Paywalled pages: say you could not read them. Do not cite from a visible teaser.
- Search ranking favours popular pages, not the best evidence. Look past the first results for official and specialist sources.
- A source in another language may hold the best data. Search once in the main language of the place studied.
- Stop when new searches only return known sources, and say so. Do not pad the report to look thorough.

## Output

A report under plain headings. Open with the answer, then findings by sub-question, then "Where sources disagree", "What is not known" and "Sources" with the URL and the date read. No intro. If the user asked for a short version, give the three-sentence answer and offer the file.
