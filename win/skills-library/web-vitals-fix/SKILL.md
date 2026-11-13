---
name: web-vitals-fix
description: Diagnoses poor LCP, CLS or INP on a page from lab and field data, finds the specific element or script behind each, and applies targeted fixes. Use when the user asks to fix Core Web Vitals, says LCP is slow, or reports layout shift on load.
---

# Web Vitals fix

## Goal

Move a failing metric to passing by fixing its real cause, confirmed by measurement. A good result names the LCP element, the shifting nodes or the slow interaction, and shows before and after numbers.

## When to use

- A report shows poor LCP, CLS or INP, or the page feels slow, jumpy or unresponsive.
- For overall weight and limits, use `use_skill` with `web-performance-budget`.
- For script size, use `use_skill` with `bundle-size-audit`.
- For animation frames, use `use_skill` with `animation-performance`.
- Search Console or a monitoring tool flags URLs as poor.
- A deployment made the page feel slower and the cause is unknown.

## Steps

1. Get the data and its source. Ask with `ask_user` whether the numbers are from field data (real users) or a lab run, and for the page URL. Current thresholds are published by Google, so check them with `read_url` or `search_web` instead of quoting from memory.
2. Reproduce in the browser with `browser_navigate`. Use `browser_console` to collect entries from `PerformanceObserver` for `largest-contentful-paint`, `layout-shift` and `event` types, and read the attributed elements.
3. LCP: identify the element and its resource. Check time to first byte, render-blocking CSS and scripts, image size and format, whether it has a preload hint, and whether it is discovered late (set by script or CSS background).
4. CLS: list the shifting elements. Typical causes are images and embeds without dimensions, late-injected banners, web fonts swapping with different metrics, and content inserted above existing content.
5. INP: find the slow interactions. Look for long tasks in handlers, heavy re-renders after a click, and synchronous work on input. Break up work, defer non-urgent updates, and cut handler cost.
6. Apply the smallest fix for each cause with `edit_file`: dimensions or aspect ratio on media, a priority hint on the LCP image, reserved space for late content, font fallback tuning, split long tasks.
7. Re-measure the same way as step 2, several runs, and compare medians.
8. Say which numbers are lab and that field data takes days to reflect changes.
9. Compare against a baseline: the same page before the regression, using the same tool and profile, to confirm what changed.
10. Check third-party scripts, tag managers and consent banners, which often delay paint or shift layout, and list each with its cost.

## Gotchas

- Lazy loading the LCP image delays it. Lazy load images below the fold only.
- A lab score is not field data. A page can pass in the lab and fail for real users on slower devices, or the reverse.
- Hiding the shifting element or removing the ad "fixes" CLS by breaking the page. Reserve the space instead.
- Preloading too many resources makes the important one compete for bandwidth. Preload the LCP resource and little else.
- INP depends on the worst interaction across a visit, so testing one click is not enough. Test menus, filters and typing.
- Client-side rendered pages often have a late LCP because content waits for script. The cure is server or static rendering, which is a larger change to propose, not slip in.
- Web fonts that swap late shift text. Match the fallback font metrics or use a font display strategy that suits the content.
- A hero carousel often makes the first slide's LCP depend on script. Render the first slide in the HTML.
- Fixing one metric can hurt another, for example inlining everything to speed LCP while blocking input. Re-measure all three.

## Output

- A per-metric diagnosis: element or interaction, cause, evidence.
- The fixes applied and the before and after numbers, labeled lab or field.
- Remaining issues and larger changes worth considering.
- Report any metric that got worse after a fix, even if the target one improved.
