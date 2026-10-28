---
name: internal-linking-plan
description: Plans internal links across a site by listing pages, finding orphans and thin targets, choosing source and target pairs by topic relevance, and writing varied descriptive anchors. Use when the user asks for an internal linking strategy, wants to link related posts or needs to fix orphan pages.
---

# Internal linking plan

## Goal

A list of specific links to add: from which page, to which page, with which anchor and where in the text. Links help readers move through related topics and help crawlers find important pages, with no forced or repetitive anchors.

## When to use

- The site has many posts that do not point to each other.
- Important pages sit deep in the site with few links.
- For topic planning before linking, use `use_skill` with `search-intent-mapping`.
- For refreshing the pages that will receive links, use `use_skill` with `content-refresh-audit`.
- For page-level checks, use `use_skill` with `seo-audit-page`.

## Steps

1. Ask with `ask_user` for the site, the pages that matter most (money pages, pillar guides), the CMS and who edits content. Obtain a page list from the sitemap with `read_url`, or from a crawl export or the content folder using `list_directory` and `read_file`.
2. Build the inventory: URL, title, main topic, page type, publish or update date and current inbound and outbound internal links. Count links with `run_command` or `search_files` when the pages are local files.
3. Group pages into topic clusters: one pillar page with supporting pages around it.
4. Find orphans (no internal links in), weakly linked pages and pages with too many outbound links to be useful.
5. Choose targets. Prioritize pages that serve the site's goals and are worth ranking. Exclude thin, outdated or duplicate pages: fix or merge those first rather than sending them links.
6. For each target, find three to eight source pages with a close topical match and good existing visibility. Read the source text and find a sentence where the link helps the reader.
7. Write the anchor in the context of that sentence: descriptive, natural and varied across links to the same target. Quote the sentence and mark the anchor.
8. Add the structural links: breadcrumbs, related-post blocks, pillar-to-cluster and cluster-to-pillar links, and navigation to key pages. Keep the number of links per page reasonable for the reader.
9. Apply changes with `edit_file` only if the user asked, or hand over the list. Check links resolve with the final URL, avoiding redirects.
10. Re-run the inventory after publishing and track whether orphan pages got links and whether target pages gain impressions over the next weeks.

## Gotchas

- Identical anchors used everywhere look manipulative and tell the reader nothing. Vary and describe.
- Links to thin or outdated pages waste attention. Improve the page first.
- Orphan pages cannot be discovered by readers or crawlers. List them and fix.
- A link inserted where it does not belong hurts the reading flow. Add only where a reader would click.
- Do not link to every related page. A handful of strong links works better.
- Redirected or broken internal links waste crawl budget and annoy readers. Link to the final URL.
- Links added by a template, such as sidebars, count differently from links inside the text. Treat in-content links as the main tool.

## Output

A table with Source URL, Sentence and anchor, Target URL, Reason, Priority, plus the orphan list, structural fixes and the recheck date.
