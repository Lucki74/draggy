---
name: web-research
description: Researches a question across several web sources with search_web and read_url, cross-checks what they say, and answers with inline citations and a source list. Use when the user asks to research, look into, find out about or investigate something that needs current or detailed information.
---

# Web research

## Goal

Answer a question from sources you actually read, cross-checked and dated, with the direct answer first and every claim traceable to a link.

## When to use

- The user asks to research, investigate or find out about something that needs current or detailed information.
- The answer depends on facts that change: prices, versions, laws, rankings.
- To verify a specific claim, use `use_skill` with `fact-check`.
- To compare options in a table, use `use_skill` with `compare-options`.

## Steps

0. This skill needs web access (`search_web` and `read_url`). If they are not available, say that web search is switched off and can be turned on from the globe button in the composer or the Web search settings page, then answer from what you know, clearly marked as possibly out of date.
1. Break the question into 2 to 4 sub-questions that together answer it.
2. Search each with specific queries: names, product models, years, exact phrases. Rephrase if results are poor rather than repeating the same query.
3. Read, do not skim results pages. Open the most relevant 3 to 6 pages with `read_url`. Prefer primary sources: official sites, documentation, papers, government and standards bodies, the original announcement. Use news and blogs for context and recency.
4. Cross-check every important claim in at least two independent sources. Note disagreements instead of hiding them.
5. Check dates. Prefer the most recent reliable information and say how current it is. Treat anything older than a year with care on fast-moving topics.
6. Stop when the sub-questions are answered with good sources, or after about 8 page reads, and say what remains uncertain.
7. Write the answer as described under Output.

## Gotchas

- Never cite a page you did not read, and never invent URLs.
- Two articles that repeat the same press release are one source, not two.
- Search snippets are not evidence. Open the page.
- Old pages rank well for fast-moving topics. Check the publication date before relying on a number.
- Mixing your own analysis into the cited facts makes weak evidence look strong. Keep them apart.

## Output

- The direct answer first, in 2 to 4 sentences.
- Then the supporting detail, organised by sub-question.
- Inline citations with the source name in brackets linked to the URL, like [Mozilla Docs](https://...), right after the claim they support.
- A "Sources" list at the end: title, site, date if known.
- Facts separated from your own analysis, and a plain statement when the evidence is weak, conflicting or absent.
