---
name: site-smoke-test
description: Loads a short list of key pages, checks titles, visible content, console errors, failed requests and the main non-destructive actions, and reports pass or fail per page. Use when the user asks for a smoke test, a quick check after a deploy, or whether the site is working.
---

# Site smoke test

## Goal

Answer one question fast: is the site basically working? The test covers the pages and actions that matter most, uses no destructive steps, and gives a clear pass or fail with evidence.

## When to use

- A deploy just finished and the user wants a quick confirmation.
- The user suspects something is down and wants evidence.
- For deeper visual review, use `use_skill` with `page-screenshot-audit`.
- For writing automated end-to-end tests that live in the repository, use `use_skill` with `webapp-testing`.

## Steps

1. Ask with `ask_user` for the base address and the environment. Ask for the five to ten pages or flows that matter: home, a content page, search, sign-in page (not signing in), a product or article, contact form (not submitting), and the page that was just changed. Check whether a test list exists in the repository with `search_files` for names like `smoke` or `health`.
2. Write the plan with `update_plan`: one line per page with what "pass" means, for example "title contains the product name, main heading visible, no console errors".
3. For each page, open it with `browser_navigate`. Wait for it with `browser_wait`. Read the title and main heading with `browser_get_text` or `browser_snapshot`.
4. Check `browser_console` for errors and failed resource messages. Note the request failures that matter: scripts, styles, API calls.
5. Do one safe action per page where it makes sense: open a menu with `browser_click`, run a search with a harmless term, expand an accordion, switch a tab. Do not submit forms, create accounts, place orders, send messages or delete anything on a live site.
6. Check for the usual failures: 404 or 500 text, a blank body, an infinite spinner, mixed content warnings, a missing logo or hero image, and a redirect to an unexpected host.
7. Take one `browser_screenshot` per failed page as evidence.
8. Summarise: a table with page, result, evidence. If anything fails, give the likely area to look at from what you saw, without guessing at the root cause.
9. Offer to keep the page list as a file in the repository, so the same smoke test can be repeated after the next deploy.

## Gotchas

- A passing home page proves little. Many failures show up on deep pages and API-driven views.
- Caches can show an old version. Note the time and consider checking with a fresh tab or cache-busting query only if the user agrees.
- Console warnings from ad and analytics scripts are common noise. Separate them from errors from the site's own code.
- Staging and production share names in some setups. Confirm the environment before clicking anything that changes data.
- A flaky page may pass once and fail the next time. Reload a failing page once to see if it is consistent.
- Do not run load against a live site. This test is one visitor.
- A certificate warning, a redirect loop or a mismatched host is a failure even when the page content looks fine.
- Features behind feature flags may show different content to you than to users. Note the assumption.

## Output

- The saved page list path, if the user accepted it.
- A pass or fail verdict for the whole site, then one row per page.
- Evidence for each failure: text seen, console line, screenshot.
- The pages and actions that were not tested.
