---
name: meta-tags-writer
description: Writes title tags and meta descriptions for web pages that match the page content and search intent, fit display limits, stay unique across the site and read as an honest reason to click. Use when the user asks for meta descriptions, title tags, or better search snippets for one page or a list of pages.
---

# Meta tags writer

## Goal

A title and description for each page that tells searchers what they will get, uses the main query naturally and is different from every other page's. The text is true to the page and short enough to display.

## When to use

- The user has pages with missing, duplicate or weak titles and descriptions.
- The user is launching new pages and needs tags written in bulk.
- For a full on-page review beyond tags, use `use_skill` with `seo-audit-page`.
- For mapping keywords to pages first, use `use_skill` with `search-intent-mapping`.
- For ad headlines rather than organic snippets, use `use_skill` with `ad-copy-variants`.

## Steps

1. Ask with `ask_user` for the pages (URLs, a file list or a sitemap), the brand name and how it should appear, the main query for each page if known, and the tone. For local files, read them with `read_file`; for live pages, use `read_url`.
2. Read each page. Note what it actually offers, its H1 and the first paragraph. Tags must describe this content, not a wish.
3. Fix the target query per page. If the user has none, infer from the H1 and confirm with a quick `search_web` of the likely query.
4. Write the title: query or topic near the start, then a benefit or qualifier, then the brand if it fits. Aim for 60 characters or less so it is less likely to be cut off. Count characters; do not estimate.
5. Write the description: one or two sentences, up to about 155 characters, that say what the page gives and a reason to click (a specific, true detail). Use active verbs. A call to action is fine when it is natural.
6. Check each tag set against the page: every claim appears on the page, no price or promise is invented, and numbers come from the page.
7. Check across the set: no two titles identical, no two descriptions identical, same pattern for similar pages, and no keyword repeated three times in a title.
8. Check current display guidance if the user relies on exact limits. Search engines rewrite snippets and pixel width varies, so treat counts as safe targets.
9. Output in a form that can be pasted: a table for many pages, or HTML tags for one. For a file of pages, edit with `edit_file` only if the user asked for that.
10. Offer two alternates for the pages that matter most, and say which angle each takes.

## Gotchas

- Counting characters in your head is unreliable. Count with `run_code` when the list is long.
- Keyword-stuffed titles read as spam and get rewritten by the search engine anyway.
- A description copied from the first paragraph wastes the space. Write it to earn the click.
- Brand name at the front of every title pushes the query out of view. Put the brand last unless it is the query.
- Quotation marks and ampersands in HTML attributes must be escaped. Check the output markup.
- Do not promise "best", "cheapest" or "#1" unless the page proves it.
- Search engines often rewrite snippets. Treat your text as a strong suggestion and check what actually shows in results.

## Output

For several pages, a table of URL, Title (with character count), Description (with character count) and Note. For one page, the two HTML tags plus the count line.
