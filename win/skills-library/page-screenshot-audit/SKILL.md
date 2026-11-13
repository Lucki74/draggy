---
name: page-screenshot-audit
description: Captures a page after it has fully loaded, at desktop and phone widths, and lists visible layout, text, image and state problems with where they appear. Use when the user asks to screenshot a page and check it, whether it looks right on mobile, or for a visual check of a URL.
---

# Page screenshot audit

## Goal

Look at a live page the way a visitor does and report what is broken or off. Each finding names the area of the page and the width at which it appears, and the report says which parts of the page were not seen.

## When to use

- The user wants a visual check of a deployed or local page.
- A change was made and the user wants to see the result at several sizes.
- For code-level performance or accessibility, use `use_skill` with `web-vitals-fix` or `accessibility`.
- For checking many pages quickly after a deploy, use `use_skill` with `site-smoke-test`.

## Steps

1. Get the address with `ask_user` if missing. Local pages are fine when the user has the dev server running; do not start unrelated servers. Ask which widths matter if the user has analytics, otherwise use a typical desktop and a phone width.
2. Open the page with `browser_navigate`. Wait for it to settle with `browser_wait`, then check `browser_console` for errors. Take a `browser_snapshot` to see the structure and any dialogs, banners or overlays.
3. Deal with overlays first. If a cookie banner covers the page, use `use_skill` with `cookie-banner-handling` and note in the report what you chose.
4. Take a `browser_screenshot` at the top of the page. Use `browser_scroll` in steps of about one screen and capture each, until the footer. Scroll slowly so lazy images load; wait after each scroll.
5. Repeat at the second width. If the pane cannot be resized by the tools, ask the user to resize it, or use a headless capture through `run_command` if Playwright is installed on the machine. Say which method produced each image.
6. Review each capture for: clipped or overlapping text, horizontal scroll, images missing or distorted, broken icon fonts, inconsistent spacing, buttons too small to tap, unreadable contrast, placeholder text left in, and error or empty states showing.
7. Compare the structure in the snapshot against the pictures. A heading missing from the snapshot but visible in the screenshot may be an image of text.
8. Rank findings: breaks use, looks wrong, polish. Give each a location such as "pricing section, phone width".
9. Capture the page again after one interaction that changes the layout, such as opening the main menu or an accordion, if the user cares about those states.

## Gotchas

- Lazy-loaded images and animations on scroll look empty if you capture too early. Wait, then capture again.
- Sticky headers and chat widgets cover content in every capture. Mention it so it is not counted as many problems.
- A blank or white screenshot is a failure to load, not a pass. Check the console and the network.
- Pages differ by region, login state and A/B test. State what you saw: the address, the time and no login.
- Dark mode or reduced motion settings change the page. Note the setting if it matters.
- Fonts that fail to load fall back to a default and shift the layout. Check the console for font errors.
- Very long pages produce many images. Capture the key sections and say which you skipped.
- Text in screenshots cannot be searched. Confirm wording with `browser_get_text` before quoting it.

## Output

- A one-line verdict: ready, ready after fixes, or broken.
- A findings list with severity, area and width.
- The list of captures taken, with the method and widths.
- What was not checked: login-only pages, hover states, forms.
