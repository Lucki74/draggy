---
name: link-checker
description: Collects links from a page or a small set of pages and checks each one for status, redirect chains, anchors and wrong targets, at a polite request rate, then reports a fix list. Use when the user asks to check for broken links, find dead links on a site, or confirm that links work.
---

# Link checker

## Goal

Find links that fail or lead somewhere unintended, and tell the owner what to fix and where. The check is slow and polite so it does not harm the site, and the report separates real failures from links that could not be tested.

## When to use

- The user has a page, a docs folder or a small site and wants dead links found.
- A site was moved or restructured and old links may be broken.
- For a quick overall health check after a deploy, use `use_skill` with `site-smoke-test`.
- For link structure that helps search, use `use_skill` with `internal-linking-plan`.

## Steps

1. Ask with `ask_user` for the start address or the folder of source files, whether to check only that page or follow internal links, a depth limit, and whether external links count. Default to one page plus its direct links.
2. If you have the source files, collect links without a browser: `search_files` for `href=` and for Markdown link patterns, then list unique targets. For a live page, `browser_navigate` and read the links with `browser_get_elements`, or `read_url` for static pages.
3. Normalise the list in `run_code`: resolve relative links against the page address, strip tracking parameters only for display, drop `mailto:` and `tel:` items into a separate list, and de-duplicate. Keep a record of which page each link was found on.
4. Check internal anchors (`#section`) against the heading ids of the target page, using `browser_get_elements` or the source.
5. Test addresses with `run_command` using a command line client such as curl if available, with a head request first, a timeout, and a pause of a second or more between hosts. Follow redirects but record each hop and the final status. Fall back to `read_url` for single checks.
6. Classify: working, redirect (fine, or a long chain, or a redirect to the home page that hides a missing target), client error, server error, timeout, blocked or needs login. Some sites refuse automated requests while working fine in a browser; open those few in the browser with `browser_navigate` and decide.
7. For each failure give the source page, the link text, the target and the cause. Suggest the replacement if an obvious one exists, such as the new address in a redirect.
8. Save the report with `create_file` as `link-report.md`, sorted by page.
9. Recheck each failed link once after a pause, since a brief outage looks like a dead link. Report only links that fail twice.

## Gotchas

- Hammering a site with parallel requests looks like an attack. Go one host at a time with pauses, and stop if you see rate limit responses.
- A status of 200 on a soft error page, such as "page not found" text on a normal page, hides a broken link. Spot check the pages that redirect to a generic target.
- Head requests are refused by some servers. Retry with a normal request before calling it dead.
- Links behind a login return a sign-in page. List them as untested.
- Social and marketplace sites often block bots. Mark those as blocked, not broken.
- A passing link can still go to the wrong place. Compare the link text with the page title for important links.
- Links to files (PDF, images) can return success for a page that is an error message. Check the content type.
- Fixing a link in source needs the exact file and line. Record both when the source is available.

## Output

- A list of links changed by redirects that are worth updating at the source.
- Counts: checked, working, redirected, broken, blocked, untested.
- A table of broken links with source page, target, status and suggested fix.
- The request rate used and the pages not covered.
