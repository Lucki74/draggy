---
name: deep-research
description: Answers a hard question with a cited report. Splits it into sub-questions, searches, reads primary sources in full, cross-checks them and writes up what is established, what is disputed and what is unknown. Use when the user asks for deep research, a thorough investigation, or a report with sources.
---

# Deep research

## Goal

Give the user a report they can rely on and check. Every claim carries a source the agent opened, disagreements are shown instead of smoothed over, and gaps are named. A long answer is not the aim. A traceable one is.

## When to use

- The question needs many sources and a synthesis, not one lookup.
- The user wants a written report, with links, on a topic they will act on.
- For a single claim to confirm, use `use_skill` with `fact-check`. For a quick headline round-up, use `news-brief`.

## Steps

1. **Pin the question.** Restate it in one sentence with scope, region, time range and the decision it feeds. If any of those is unclear and changes the answer, use `ask_user` once.
2. **Plan sub-questions.** List 4 to 8 sub-questions that together answer the main one. Record them with `update_plan` and tick them off as you go.
3. **Search each sub-question.** Use `search_web` with at least two differently worded queries per sub-question. Prefer results from the body that produced the data: regulators, statistics offices, courts, the paper itself, the company filing.
4. **Open the sources.** Use `read_url` on every page you will cite. Read the part that carries the claim, past the intro. A search snippet is a lead, never a citation.
5. **Find the primary source.** When a page cites a study or figure, follow the link and read that. If it cannot be reached, mark the claim as secondhand.
6. **Cross-check.** For each important claim, look for one independent source. Independent means it did not copy the first. Note where two sources disagree and look for the reason: definition, date, sample or method.
7. **Record as you go.** Keep a running list of claim, source URL, date accessed and confidence (confirmed, single source, disputed).
8. **Write the report.** Order: answer in three sentences, findings by sub-question, disagreements, open gaps, source list. Save it with `create_file` when it runs past a screen.
9. **Reread against the list.** Every sentence with a fact maps to a recorded source. Cut or soften any that does not.
10. **Offer the trail.** Keep the plan and source list in a file with `create_file` so the user can rerun or extend the work later.
11. **State the limits.** Name the sub-questions that got thin evidence and what further search would target them.

## Gotchas

- Sub-questions drift. Check at the end that the report still answers the question asked in step 1, not the most interesting thing found on the way.
- A topic with one dominant source looks settled. If three sites say the same thing, check whether they quote one origin.
- Dates matter more than they seem. A figure from before a rule change answers a different question. State the year next to each number.
- Confident prose hides weak evidence. Use the confidence labels in the text, for example "one study, small sample".
- Stop when new searches only repeat known sources. Say so, instead of padding to look exhaustive.
- Paywalled pages: say you could not read them. Do not cite from the visible teaser.
- Search ranking favours popular pages, not the best evidence. Dig past the first results page for official and specialist sources.
- A source in another language may hold the best data. Search once in the main language of the place studied.

## Output

A report in plain headings. Opening answer first, then findings, then "Where sources disagree", "What is not known" and "Sources" with URL and access date. No filler intro. If the user asked for a short version, give the three-sentence answer and offer the file.
