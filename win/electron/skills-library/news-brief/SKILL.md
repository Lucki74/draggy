---
name: news-brief
description: Gathers the latest news on a topic, company, country or event from several outlets and writes a dated briefing with what happened, why it matters and what to watch. Use when the user asks what is new, the latest on something, or for a news roundup.
---

# News brief

## Goal

A short, dated briefing that separates confirmed facts from reports and rumour, cites each outlet, and says what to watch next.

## When to use

- The user asks what is new, the latest on a topic, or for a news roundup.
- For deeper research that is not time-sensitive, use `use_skill` with `web-research`.
- For checking whether one claim is true, use `use_skill` with `fact-check`.

## Steps

1. This needs web access. Without it, say that you cannot see recent news and that web search can be turned on from the composer.
2. Search with `search_web` using the topic plus recent time words ("this week", the current month and year), and variants of names.
3. Open 4 to 8 articles with `read_url` from different reputable outlets. Include at least one close to the source: the company's announcement, the official statement, or the local press for local events.
4. Note each item's publication date. Keep to the period the user asked for, and default to the last seven days.
5. Group articles covering the same event into one item. Where outlets disagree on facts, say so.
6. Separate confirmed facts from reports, rumours and opinion ("according to anonymous sources...").

## Gotchas

- Presenting something as confirmed when sources only report it is the worst error here. Use the sources' own hedging.
- Several outlets quoting one wire story count as one source, not several.
- Old articles surface in search. Check each publication date against the requested period.
- Headlines copied from the outlets carry their framing. Write your own.

## Output

**[Topic]: news brief, [date range]**

For each item, most important first (3 to 7 items):
- **Headline in your own words** (date)
  What happened in one or two sentences. Why it matters in one sentence. [Outlet](link), [Outlet](link)

Then:
- **What to watch:** upcoming dates, decisions or releases.
- **Context:** one short paragraph, only if the topic needs background.

Keep a neutral tone.
