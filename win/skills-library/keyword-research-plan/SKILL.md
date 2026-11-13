---
name: keyword-research-plan
description: Plans keyword research for a site, product or topic by listing seed topics, grouping queries by intent, checking live results for each group and ranking targets by fit and effort, without made-up search volumes. Use when the user asks for keyword research, wants to know what to rank for, or needs a keyword list for a site.
---

# Keyword research plan

## Goal

A ranked list of keyword groups the site can realistically target, each with its intent, the page that should serve it and the evidence from live results. Volume figures appear only when the user supplies them from a tool.

## When to use

- The user is starting a site, a blog or a new section and needs topics worth writing about.
- The user has traffic but does not know which queries to aim for next.
- For deciding what page type matches a query, use `use_skill` with `search-intent-mapping`.
- For turning a chosen query into a writer's brief, use `use_skill` with `seo-content-brief`.
- For finding topics rivals cover, use `use_skill` with `competitor-content-gap`.

## Steps

1. Ask with `ask_user` what the site offers, who buys, the market or country and language, and what a visit is worth to the business (sale, sign-up, lead). Ask for any data from a search console or analytics export, and read it with `read_file`.
2. List seed topics: the products, problems and questions the business covers, in the customer's words. Add terms from support tickets, sales calls and reviews if the user has them.
3. Expand each seed into queries a person would type: questions, comparisons, "best for", "how to", problems, and names of alternatives. Aim for 10 to 20 per seed.
4. Group by intent. Informational (learn), commercial (compare before buying), transactional (ready to act) and navigational (looking for a brand). Name each group by the need behind it.
5. Check live results. For the top query of each group, run `search_web` and note what ranks: page types, publishers, freshness, and whether answers are lists, guides or tools. Open one or two results with `read_url`. This tells you what kind of page can win.
6. Judge each group on four points: fit (does it lead to the user's goal), intent match (can the user make that page type), competition (who ranks and how strong), and effort (what must be built). Use low, medium and high with a reason.
7. If the user has volume data from a keyword tool, add it as given with the source. If not, leave volume out and say that the plan uses fit and competition instead. Never estimate search counts.
8. Rank groups. Start with those that have high fit, matching intent and beatable competition. Mark two or three as quick wins and two as longer bets.
9. Assign each chosen group to an existing page to improve or a new page to create. Note the primary query and two or three supporting ones per page.
10. Set the review: after publishing, check the search console for impressions and queries in four to eight weeks and adjust.

## Gotchas

- High volume is not high value. A query that never leads to the user's goal wastes the page.
- Treating different intents as one keyword leads to a page that satisfies nobody. Split by intent.
- Results differ by country, language and device. Search in the market the user serves.
- Keyword tools disagree and round heavily. Use them for direction only, and cite the tool.
- A new site cannot beat strong publishers on broad queries. Start with narrow, specific questions.
- Do not promise rankings or traffic.
- Seasonal queries swing through the year. Note the season before judging a topic.

## Output

A table of Group, Intent, Example queries, Fit, Competition, Effort, Page to target, Priority. Below it: the quick wins, the longer bets, the data used with sources and dates, and the review date.
