---
name: news-brief
description: Gathers the latest news on a topic, company, country or event from several outlets and writes a dated briefing with what happened, why it matters and what to watch. Use when the user asks what is new, the latest on something, or for a news roundup.
---

# News brief

## Goal

A short, dated briefing that separates confirmed facts from reports and rumour, cites each outlet, and says what to watch next.

## When to use

- The user asks what is new, the latest on a topic, or for a news roundup.
- For deeper research that is not time-sensitive, use `use_skill` with `deep-research`.
- For checking whether one claim is true, use `use_skill` with `fact-check`.

## Steps

1. This needs web access. Without it, say that you cannot see recent news and that web search can be turned on from the composer.
2. Call `start_research` with depth `quick` and source `web`. Make the sub-questions cover the event, the reaction and the next dated step. The user approves the plan first.
3. Search with `search_web` using the topic, recent time words such as "this week" or the current month and year, and name variants. Use two or three queries.
4. Open the articles with `read_url`, from different outlets. Include at least one source close to the event: the company's announcement, the official statement, or local press for a local story.
5. Record each fact with `add_note`, with the publication date in the claim. Use `single_source` for anything only one outlet reports, and `disputed` where outlets differ.
6. Every item needs a publication date. Drop any article outside the period the user asked for. Default to the last seven days.
7. Call `finish_research`. Group articles about the same event into one item, and say where outlets disagree on facts.
8. Separate confirmed facts from reports, rumour and opinion ("according to anonymous sources...").

## Gotchas

- Presenting something as confirmed when sources only report it is the worst error here. Use the sources' own hedging.
- Several outlets quoting one wire story count as one source, not several.
- Old articles surface in search. Check each publication date against the requested period.
- Headlines copied from outlets carry their framing. Write your own.

## Output

**[Topic]: news brief, [date range]**

For each item, most important first (3 to 7 items):
- **Headline in your own words** (date)
  What happened in one or two sentences. Why it matters in one sentence. [Outlet](link), [Outlet](link)

Then:
- **What to watch:** upcoming dates, decisions or releases.
- **Context:** one short paragraph, only if the topic needs background.

Keep a neutral tone.
