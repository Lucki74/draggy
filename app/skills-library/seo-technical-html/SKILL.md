---
name: seo-technical-html
description: Checks page markup for technical SEO problems in titles, meta tags, headings, canonical links, robots rules, structured data and rendering, and fixes them. Use when the user asks to check page SEO, fix meta tags, or add structured data.
---

# Technical SEO in HTML

## Goal

Make sure search engines can fetch, render, understand and index each page as intended. A good result lists concrete markup defects with fixes and does not promise rankings.

## When to use

- The user asks for an SEO check of a page, template or whole site.
- Pages are missing from search, show wrong snippets or duplicate each other.
- For performance signals such as LCP, use `use_skill` with `web-vitals-fix`.
- For heading and landmark quality for assistive tech, use `use_skill` with `accessibility`.
- A site relaunch or migration is planned and URLs will change.
- Search results show the wrong title, description or image for a page.

## Steps

1. Get the page as a crawler would. For a live URL use `read_url` and also fetch the raw HTML with `run_command` and a command line fetch tool. For local code use `read_file` on the templates and layout.
2. Compare raw HTML with the rendered page using `browser_navigate` and `browser_get_text`. If key content or links exist only after JavaScript runs, flag it.
3. Check the head: one `<title>` that is unique and describes the page, a meta description that summarizes it, `<html lang>`, and the viewport tag.
4. Check indexing controls: canonical link pointing to the preferred absolute URL, robots meta tags, `robots.txt` rules and the sitemap reference. Fetch `/robots.txt` and the sitemap with `read_url`.
5. Check the body: a single logical `h1`, ordered headings, descriptive link text, images with `alt` and dimensions, and internal links that are real anchors with `href`.
6. Check social and structured data: Open Graph tags and any JSON-LD. Validate that the JSON parses and that the data matches visible content. Check the current supported types with `search_web` because search engines change them.
7. Check status behaviour: redirects, trailing slash consistency, a real 404 status for missing pages, and duplicate paths for the same content.
8. Fix template-level issues with `edit_file` so every page benefits, then re-fetch to confirm.
9. For a migration, build a redirect map from old to new URLs and check that each redirect is a single permanent hop with `run_command` and a header-only fetch.
10. Check international setups: `hreflang` pairs must be reciprocal and use the exact canonical URLs of each version.

## Gotchas

- A `noindex` tag or a blocking robots rule copied from staging is a classic cause of vanished pages. Check it first.
- A canonical that points to the home page, or to a different URL than the one served, tells engines to ignore the page.
- Blocking a path in `robots.txt` stops crawling but does not remove it from the index. A page that must not appear needs `noindex`, and it must stay crawlable to be seen.
- Structured data that describes content not visible on the page violates guidelines and can lose rich results. Mark up only what users can see.
- Client-rendered titles and descriptions may not be seen by every crawler. Prefer them in the initial HTML.
- Duplicate titles across a template (every product page called "Product") are common. Build titles from page data.
- Redirect chains and loops waste crawl budget and dilute signals. Collapse each old URL to one hop.
- Infinite scroll without paginated URLs leaves later content unreachable for crawlers. Provide linkable page URLs.
- Search engines may show a different title than the one in the tag if it looks misleading or too long. Edit the tag but do not expect control.

## Output

- A defect list ranked by impact: location, what is wrong, the fix.
- The template changes made, with the pages they affect.
- A statement that no ranking outcome is guaranteed, and which checks need real search console data from the owner.
- List the pages you could not fetch or render and the reason.
