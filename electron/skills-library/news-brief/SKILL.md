---
name: news-brief
description: Gathers the latest news on a topic, company, country or event from several outlets and writes a dated briefing with what happened, why it matters and what to watch. Use when the user asks what is new, the latest on something, or for a news roundup.
---

# News brief

Needs web access. Without it, say that you cannot see recent news and that web search can be turned on from the composer.

## Method

1. Search with search_web using the topic plus recent time words ("this week", the current month and year), and variants of names.
2. Open 4 to 8 articles with read_url from different reputable outlets, including at least one close to the source (the company's announcement, the official statement, the local press for local events).
3. Note each item's publication date. Keep to the period the user asked for; default to the last seven days.
4. Group articles covering the same event into one item. Where outlets disagree on facts, say so.
5. Separate confirmed facts from reports, rumours and opinion ("according to anonymous sources...").

## Output

**[Topic] — news brief, [date range]**

For each item, most important first (3 to 7 items):
- **Headline in your own words** (date)
  What happened in one or two sentences. Why it matters in one sentence. [Outlet](link), [Outlet](link)

Then:
- **What to watch:** upcoming dates, decisions or releases.
- **Context:** one short paragraph only if the topic needs background.

Keep a neutral tone. Never present something as confirmed when sources only report it.
