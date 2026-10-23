---
name: multi-page-extract
description: Pulls the same defined fields from many pages, such as listings or profiles, by looping over a list of addresses or pagination, with per-page checks, polite pacing and a CSV or JSON result that marks missing values. Use when the user asks to get the same details from each page, scrape all the listings, or collect info from a list of URLs.
---

# Multi-page extract

## Goal

Collect a consistent dataset from many pages without silent gaps. The fields are defined first, each page is checked against them, and the result shows where a value was missing and why.

## When to use

- The user has a list of addresses, or a listing with many detail pages, and wants fields from each.
- A single-page extraction worked and now needs scaling.
- For one table that spans pages, use `use_skill` with `scrape-table-to-csv`.
- For research with sources and interpretation, use `use_skill` with `web-research-session`.

## Steps

1. Define the fields with `ask_user`: names, types and an example value for each. Ask where the addresses come from (a list, a sitemap, a listing page) and how many pages are expected. Ask whether the data is public and whether the site's terms allow automated collection; if unsure, tell the user and let them decide.
2. Check the site's rules: read its robots file and terms with `read_url`. Do not collect personal data about private individuals beyond what the user clearly needs, and say so if the fields would include it.
3. Build the address list. For a listing, open it with `browser_navigate`, collect the detail links with `browser_get_elements`, and follow pagination until the end, noting the page's own total count. For a list the user gave, read it with `read_file`.
4. Pilot on three pages of different kinds (a typical one, one with missing fields, the longest). For each, locate the fields using `browser_snapshot` and read them with `browser_get_text`. Write down where each field lives and how to tell when it is absent.
5. Loop over the rest with a pause between pages of at least a second or two. Keep a progress record in a file with `create_file` so a failure does not lose the work: address, status, values.
6. For every page, validate the result in `run_code`: required fields present, types right, values within a plausible range, no value copied from the previous page by mistake. Mark failures as `missing` or `error`, never as an empty guess.
7. Retry failed pages once after a pause. Pages that still fail stay in a separate list with the reason (timeout, blocked, login needed, layout different).
8. Write the final file as CSV or JSON with `create_file`, with a column for the source address and the time read. Report counts: expected, collected, missing, failed.
9. Spot check five rows against their live pages, including one from the middle and one from the end, and report any difference found.

## Gotchas

- Layout differs between page templates. A selector that works on the pilot may return another element on page 40. Validate every page.
- Pages that load content with scripts after the first paint give empty values. Use `browser_wait` and check for the value before reading.
- Infinite scroll lists never show a last page. Stop at a known total or when no new items appear after two scrolls.
- Fast loops get blocked, and a blocked page often returns a polite error page that looks like data. Check each result for block text.
- Duplicates appear when an item is on several listing pages. De-duplicate by a stable identifier, not by title.
- Do not log in, bypass walls or work around rate limits to complete the set.
- Data collected today is a snapshot. Store the read time so the user knows its age.
- Prices, names and contact details in the set may be personal data. Tell the user to handle the file with care.

## Output

- The result of the spot check against live pages.
- The data file path and the field list with types.
- Counts: expected, collected, missing, failed.
- The failure list with reasons and the pacing used.
