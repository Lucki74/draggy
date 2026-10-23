---
name: competitor-content-gap
description: Finds content gaps by comparing the topics a site covers with what rival sites cover and what searchers ask, then ranks the gaps by fit, intent and effort rather than copying rivals. Use when the user asks for a content gap analysis, wants to know what competitors rank for or needs topic ideas based on rivals.
---

# Competitor content gap

## Goal

A ranked list of topics the user's site lacks or covers weakly, backed by what rivals publish and what the results show. Gaps are chosen because they fit the user's goals and can be won, not because a competitor has them.

## When to use

- The user wants new topics and has named rivals or a market.
- Traffic has plateaued and the user wants to see what is missing.
- For wider competitor research, use `use_skill` with `competitor-scan`.
- For a research plan from scratch, use `use_skill` with `keyword-research-plan`.
- For the brief of a chosen topic, use `use_skill` with `seo-content-brief`.

## Steps

1. Ask with `ask_user` for the user's site, three to five direct rivals, the goal of the content (sales, leads, authority) and any existing topic list or sitemap. Read exports with `read_file`.
2. Inventory the user's content: titles, topics and page types from the sitemap or `read_url` of the blog index. Group them into topics.
3. Inventory each rival the same way. Use their sitemaps, blog indexes and category pages through `read_url`, and check search results for the user's core topics with `search_web` to see who ranks. Note topic, format and freshness.
4. Compare. List topics rivals cover that the user does not (gaps), topics both cover where rivals are deeper or fresher (weak spots) and topics the user covers that rivals miss (strengths to extend).
5. Check intent for each gap. Look at what ranks for the main query: guides, tools, lists, product pages. If the intent is a type of page the user cannot offer, drop or reshape the gap.
6. Judge fit: does it serve the user's customer and lead toward the goal? Judge effort: research, expertise and assets needed. Judge competition: who ranks and how strong. If the user supplies tool data on volume or difficulty, include it with its source; do not estimate numbers.
7. Look for angles rivals miss: out-of-date advice, missing examples, missing beginner or expert coverage, questions in forums that no page answers.
8. Rank the gaps by fit first, then winnability, then effort. Mark quick wins (update or extend an existing page) and bigger builds.
9. Assign each chosen gap to a page type, a working title and a reason it can beat what exists.
10. Record the date and the rivals compared, and plan a re-run in a few months.

## Gotchas

- Copying topics blindly gives a me-too site. Add the angle that makes your page better.
- A topic a rival ranks for may reflect their brand strength, not the topic's ease. Check the results.
- Ignoring intent leads to a page of the wrong type. Match what searchers want.
- Counting posts per rival says little. Look at what each page achieves and how current it is.
- Without ranking by fit, the list becomes a long wish list that never ships.
- Competitor content is protected. Study structure and coverage; do not copy text.
- Rivals sometimes publish for goals unlike yours, such as brand reach. Check that their topic serves your goal too.

## Output

A table with Topic, Type of gap, Intent, Who ranks, Fit, Effort, Proposed page, Priority, plus a list of quick wins and the date and sources used.
