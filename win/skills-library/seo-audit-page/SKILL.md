---
name: seo-audit-page
description: Audits a single web page for on-page SEO by reading its live HTML, checking title, headings, content match to the target query, internal links, images and markup, and lists fixes in order of effect. Use when the user asks to audit a page, wants to know why a page is not ranking, or asks for an on-page SEO check.
---

# SEO audit of one page

## Goal

A prioritized list of fixes for one page, based on what the live page actually contains. Each finding has evidence from the page and a clear change to make. No ranking promises.

## When to use

- The user has a page that should perform and wants a check before or after publishing.
- The user is comparing their page with a ranking one.
- For site-wide technical issues in HTML, use `use_skill` with `seo-technical-html`.
- For rewriting the title and description, use `use_skill` with `meta-tags-writer`.
- For deciding the right page type for a query, use `use_skill` with `search-intent-mapping`.

## Steps

1. Ask with `ask_user` for the page URL, the main query it should rank for, the goal (sign-up, sale, read) and the market. If the page is a local file, use `read_file` instead.
2. Fetch the live page with `read_url`. Do not rely on a memory or cached copy. Note the final URL after any redirect and whether the page loaded fully.
3. Check search results for the target query with `search_web`. Note which page types rank and what they cover. This sets the bar for content match.
4. Check the head: title (present, unique, close to 60 characters or fewer, query near the front), meta description (present, written for a click), canonical tag (points to the right URL), robots meta (not blocking by mistake), language and viewport.
5. Check the content: one H1 that matches the topic, logical H2 and H3 order, the query answered early, depth compared with ranking pages, original information, clear author or source where it matters, and freshness of dates.
6. Check links: internal links to and from the page, descriptive anchor text, broken links, and outbound links to credible sources.
7. Check media: images with useful alt text and sensible file size, a video with a transcript if used, and layout that does not shift.
8. Check markup: structured data present and matching the visible content, with no invented fields. For rules on a type, check the current search documentation with `read_url`.
9. Check experience factors visible from the page: mobile layout, intrusive pop-ups, ads covering text. For speed data, ask the user for a lab or field report; do not guess.
10. Rank the findings by effect: blocking issues first (noindex, wrong canonical, content mismatch), then content gaps, then polish. Give each a fix a person can do today.

## Gotchas

- Auditing the staging copy or a cached version produces fixes for a page that no longer exists. Always fetch the live URL.
- Limits like title length are guidelines for display, not rules. Do not treat 60 characters as a pass or fail.
- A page can follow every tip and still lose because it does not match what searchers want. Check intent before polish.
- Do not recommend more keywords in the text as a fix. Add information instead.
- Changes take weeks to show. Say what to measure and when, and avoid promises.
- JavaScript-rendered content may not appear in the fetched HTML. Note that limit if the page looks empty.
- Fixes made on the wrong version of the page (a template copy or a test site) do not carry over. Confirm where the live page is edited.

## Output

A short summary line, then a table with Priority, Finding, Evidence from the page, Fix. End with what to re-check in four to eight weeks.
