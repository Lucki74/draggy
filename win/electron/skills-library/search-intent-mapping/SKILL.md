---
name: search-intent-mapping
description: Maps queries to search intent by reading live results, classifying what searchers want and which page type satisfies it, and assigning each query group to one page, so mixed intents are split. Use when the user asks about search intent, which page should target a keyword or why content ranks poorly despite good writing.
---

# Search intent mapping

## Goal

For each query group, a verified statement of what searchers want, the page type that fits and the single URL that should serve it. Intent comes from live results, not from guesses about wording.

## When to use

- The user has a keyword list and needs to decide what to build for each.
- A page is well written but does not rank, and the user suspects a mismatch.
- To produce the keyword list first, use `use_skill` with `keyword-research-plan`.
- To brief the page afterward, use `use_skill` with `seo-content-brief`.
- To fix an existing page, use `use_skill` with `seo-audit-page`.

## Steps

1. Ask with `ask_user` for the queries or topics, the site's pages that exist (a sitemap or list), the market and language, and the goal of the site. Read lists with `read_file`.
2. Search each query with `search_web` in the user's market. Do not infer from the words alone. Record the top results: page types (guide, list, product page, tool, video, forum, local), publisher types and any special result features visible.
3. Open two or three top results with `read_url`. Note how they start, what they promise, how deep they go and how fresh they are.
4. Classify intent for each query: learn (informational), compare or research before buying (commercial), act or buy (transactional), find a place or brand (navigational), or local. Where results mix types, mark the query as mixed and note the split.
5. Name the page type that satisfies the intent: how-to guide, comparison, category page, product page, calculator, glossary entry, template, case study. State what a visitor must be able to do or learn there.
6. Group queries that share intent and the same result set. Queries with the same results usually belong on one page. Queries with different results need different pages.
7. Map each group to a URL: an existing page to improve, a page to merge, or a new page. Avoid two pages competing for the same group.
8. Flag mismatches: pages whose type differs from what ranks, and groups the site cannot serve with its current offer.
9. Write the notes needed for the content step: the angle, the must-have sections observed and the depth expected.
10. Record the date. Results shift, so recheck important groups every few months.

## Gotchas

- Guessing intent from wording fails often, because identical words can serve different needs. Read the results.
- One page that tries to serve mixed intent usually serves none well. Split the content.
- Results change with time, place and device. Search in the target market and note the date.
- Personalized results can differ. Use a clean browser state where possible.
- Do not equate a commercial keyword with a sales page. Check what ranks.
- Intent can drift after news, seasons or product launches.
- Featured answers on the results page can satisfy the query without a click. Note them and decide whether the page still has a role.

## Output

A table with Query group, Intent, Evidence from results, Page type, Target URL (existing or new), Action and Notes. Add a list of mismatches and the check date.
