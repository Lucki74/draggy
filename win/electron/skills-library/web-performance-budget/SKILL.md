---
name: web-performance-budget
description: Measures a site's current weight and load timing, sets realistic byte and timing budgets, and wires a check that fails when they are exceeded. Use when the user asks to set a performance budget, says a page is too heavy, or asks why a site loads slowly.
---

# Web performance budget

## Goal

Replace "make it faster" with numbers that stay true over time. A good result has a measured baseline, a small set of budgets agreed with the user and an automated check that catches regressions in review.

## When to use

- The user wants limits on page weight, script size or load timing.
- A page feels slow and nobody knows where the bytes or time go.
- For a specific vitals problem such as LCP or CLS, use `use_skill` with `web-vitals-fix`.
- For finding what bloats the JavaScript, use `use_skill` with `bundle-size-audit`.
- A launch date is near and the team wants a go or no-go on speed.
- A redesign added images, fonts or video and the page got heavier.

## Steps

1. Pick the pages that matter: the home page, the main app screen and one heavy content page. Ask with `ask_user` if the user has not named them, and ask the target audience's device and network class.
2. Build for production with `run_command` using the project's build script. Never measure a dev server.
3. Measure the baseline: file sizes of emitted assets with `list_directory` or `run_command`, and for live pages the transferred bytes by type (script, style, image, font) from the browser. Use `browser_navigate` and `browser_console` to read resource timing entries.
4. Record timing metrics too: time to first byte, largest contentful paint, total blocking time. Take at least three runs and use the median.
5. Propose budgets slightly better than today, not aspirational ones. Common shapes are a cap on total JavaScript, on image bytes per page, on request count and on one or two timing metrics. Check current guidance on thresholds with `search_web` or `read_url` before quoting numbers.
6. Add enforcement where the project already runs checks: a bundler size limit, a script in `package.json` or a CI step. Use `read_file` on the config, then `edit_file` to add it.
7. Run the check once to confirm it passes today, and once with a deliberately large file to confirm it fails.
8. Note what the budget does not cover, such as third-party scripts that load at runtime.
9. Audit fonts and images specifically: count font files and weights loaded, check image formats and dimensions against the displayed size.
10. Record the measurement method (tool, device profile, network profile, URL) next to the numbers so later runs are comparable.

## Gotchas

- A budget set before measuring is a guess. Either it fails every build or it never fails.
- Lab runs on a fast desktop hide problems that low-end phones show. State which device and throttling the numbers came from.
- Compressed transfer size and uncompressed size are different numbers, and parsing cost follows the uncompressed one for scripts. Say which a budget uses.
- Third-party tags (analytics, chat, ads) often add the largest and least controllable cost. Budget them separately and name an owner.
- Timing numbers vary run to run. A budget on a single run flaps, so use a median or a margin.
- Caching hides regressions in a repeat visit. Measure a cold load as well.
- Font files are often the surprise: four weights in two families can outweigh the application script. Count them.
- Single-page apps show a tiny HTML document and a large script. Budget the script, since the HTML size says nothing.
- A budget on page weight alone lets the main thread work grow unchecked. Include one metric for blocking time or long tasks.

## Output

- A baseline table: page, bytes by type, request count, timings.
- The proposed budgets with one line of reasoning each.
- The enforcement change, and the evidence that it passes and fails correctly.
- List any budget you chose not to set and why, such as a metric the team cannot measure yet.
