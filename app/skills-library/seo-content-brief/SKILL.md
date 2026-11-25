---
name: seo-content-brief
description: Writes a content brief for a writer from live search results, with the target query, intent, angle, required sections, questions to answer, sources to use and internal links, without copying the top results. Use when the user asks for an SEO content brief, a writer brief for an article or a brief for a page to rank.
---

# SEO content brief

## Goal

A brief a writer can follow without further questions. It states the query, who is searching and why, what the page must cover, what will make it better than what exists and which sources to use. Structure comes from the reader's needs, not from copying rivals.

## When to use

- The user is commissioning an article, guide or page aimed at a search query.
- The user wants consistent briefs for several writers.
- To pick the query, use `use_skill` with `keyword-research-plan`.
- To verify page type and intent, use `use_skill` with `search-intent-mapping`.
- To outline the post itself, use `use_skill` with `blog-outline`.

## Steps

1. Ask with `ask_user` for the target query, the market, the site and audience, the goal of the page, the author's expertise, the word range if any, and the deadline. Read any notes with `read_file`.
2. Search the query with `search_web` and open the top results with `read_url`. Note the page types, depth, structure, freshness, sources used and questions answered. Check related questions and gaps readers raise in forums.
3. State the intent in a sentence: who searches, what they want to achieve and what they must be able to do after reading.
4. Choose the angle. Decide what this page offers that the results lack: first-hand experience, current data, a worked example, a clearer decision rule or a missing audience. If the user has no advantage, set depth and clarity as the aim and say so.
5. List the sections the page must cover so the reader's need is met, with the question each answers. Include required topics seen across results, but arrange them for the reader and add the points no result covers.
6. List questions to answer, from the results and forums, in the reader's wording.
7. Specify evidence: facts that need citations, who to interview or what to test, and primary sources preferred. Tell the writer not to invent data or quotes. Mark items the writer must verify.
8. Give on-page guidance: working title options, H1 and heading style, the placement of the answer near the top, suggested meta description direction, images or tables to produce and any schema type that applies.
9. Give link guidance: internal pages to link to and from, with anchors suggested, and credible external sources.
10. Add voice and style notes, banned claims, compliance needs and the definition of done: the checklist the editor will use.

## Gotchas

- An outline copied from the top results produces a page that adds nothing. Insist on an angle.
- Keyword counts and density targets push writers to stuff. Ask for coverage of the topic instead.
- Without a source list, writers fill gaps with remembered facts that may be wrong.
- A brief for the wrong page type wastes the writing. Confirm intent first.
- Word counts are guides. Length should follow the reader's need.
- Competitor text is protected. Study coverage, not wording.
- A brief should say what to leave out. List the topics that belong on other pages to avoid overlap.

## Output

A one to two page brief: query and intent, angle, reader and goal, section list with questions, evidence and sources, on-page and link guidance, style notes and the done checklist.
