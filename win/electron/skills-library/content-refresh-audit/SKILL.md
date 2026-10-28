---
name: content-refresh-audit
description: Audits existing content for refresh by sorting pages into keep, update, merge, redirect or remove using accuracy, search performance data, links and purpose, and writes the update brief for each page chosen. Use when the user asks for a content audit, wants to refresh old posts or asks which pages to update or delete.
---

# Content refresh audit

## Goal

A decision for each page: keep, update, merge, redirect or remove, based on accuracy, usefulness, links and performance data the user supplies. The result is a short update queue with a brief for each, not a mass edit.

## When to use

- The site has years of posts and some are outdated, thin or overlapping.
- Traffic has dropped on pages that used to perform.
- For the checklist of a single page, use `use_skill` with `seo-audit-page`.
- For link changes after merging, use `use_skill` with `internal-linking-plan`.
- For the brief of an update, use `use_skill` with `seo-content-brief`.

## Steps

1. Ask with `ask_user` for the site, the goal (leads, sales, authority), the performance data available (search console and analytics exports for the last 12 months or more) and which pages are off limits. Read exports with `read_file`.
2. Build the inventory from the sitemap or content folder: URL, title, publish and update dates, topic, page type, word count and internal and external links. Use `run_command` to join it with the exports.
3. Add performance: impressions, clicks, queries, conversions and trend over time. Compare periods of equal length and mind seasonal topics. Use only the user's data; cite no benchmarks.
4. Review each page's substance. Open it with `read_url` or `read_file` and check whether facts, prices, screenshots, names and tool versions are still correct. Use `search_web` for facts that change.
5. Check backlinks and internal links if the user has data. Pages with referring links or steady referrals are assets even with low traffic.
6. Check intent fit. Search the page's main query with `search_web` and see whether the page type still matches what ranks.
7. Decide with simple rules. Keep: accurate and performing. Update: right topic, outdated or declining, or ranking just below the first page. Merge: overlapping pages on one topic, folding the best material into one URL. Redirect: obsolete page with links or traffic, to the closest match. Remove: no value, no links, no traffic and no purpose. Record the reason.
8. Write the brief for each page to update: what is wrong, what to add or fix, the queries to cover, sources to cite, and the done condition. Do not change only the date.
9. Order the queue by expected value and effort: valuable decline pages first, then quick fixes, then large rewrites.
10. After changes, record the date, request reindexing where useful and review results after several weeks.

## Gotchas

- Deleting pages that have inbound links loses that value. Redirect them to a relevant page.
- Updating only the date, without new substance, misleads readers and gains nothing.
- Traffic alone is a poor judge. A low-traffic page may drive sign-ups or hold essential links.
- Seasonal pages look dead in the off season. Check year-over-year.
- Redirecting many pages to the home page is treated like an error by search engines. Point to a relevant page.
- Keep a changelog and a backup before large edits.
- Refreshing everything at once makes it hard to see what helped. Update in batches and note the dates.

## Output

An audit table (URL, data summary, decision, reason, priority), the update briefs, the redirect map and the review date.
