---
name: css-layout-debugging
description: Finds why a flex, grid, positioned or overflowing CSS layout misbehaves by inspecting computed boxes, then fixes the cause instead of piling on overrides. Use when the user says a layout is broken, an element overflows, something will not center, or z-index is ignored.
---

# CSS layout debugging

## Goal

Identify the one rule or inherited constraint that produces the wrong layout, and change that rule. A good result explains the cause in a sentence, removes the symptom and adds no new `!important` or magic numbers.

## When to use

- An element overflows, collapses, stretches, wraps or sits in the wrong place.
- Centering, equal heights, sticky positioning or z-index does not behave.
- For problems that appear only at certain screen widths, use `use_skill` with `responsive-audit`.
- For jank during movement rather than wrong position, use `use_skill` with `animation-performance`.
- The user pastes a snippet of HTML and CSS and asks what is wrong with it.
- A fix works in one browser and fails in another.

## Steps

1. Get a precise symptom: which element, which viewport width, what you expect and what you see. Use `ask_user` if the report is vague.
2. Reproduce it. If the page runs locally, open it with `browser_navigate` and capture it with `browser_screenshot`. Otherwise read the markup and styles with `read_file` and `search_files`.
3. Read the page's structure with `browser_snapshot` or the HTML, and walk up from the broken element to its ancestors. Note each ancestor's `display`, `position`, `overflow`, `height` and `transform`.
4. Check the layout mode that governs the element. For flex children look at `flex`, `min-width`, `align-self` and the parent's `flex-direction` and `flex-wrap`. For grid items look at the track definitions and `grid-area`. For positioned elements find the containing block.
5. Inspect computed values in the live page with `browser_console` if available, for example reading `getComputedStyle(el)` for the suspect properties and `el.getBoundingClientRect()` for sizes.
6. Form one hypothesis and test it by changing one property with `edit_file` (or a temporary rule). Reload and compare. Revert if it does nothing.
7. Remove temporary debug outlines and borders. Search with `search_files` for leftovers.
8. Re-check the neighbouring layouts that share the changed rule, and a narrow and a wide viewport.
9. If the cause is a missing or wrong reset (box-sizing, default margins on headings, inherited line height), fix it once globally and note which pages it touches.
10. Write down the rule you changed and the reason in a one-line comment only if the cause is surprising, such as a flex child minimum width.

## Gotchas

- Flex and grid children have `min-width: auto`, so long text or an image refuses to shrink and overflows. The fix is `min-width: 0` on the child, not a fixed width.
- A percentage `height` does nothing when the parent has no definite height. Fix the chain of heights, or use flex or grid sizing.
- `z-index` only compares within one stacking context. A parent with `transform`, `opacity` below 1, `filter` or `isolation` makes a new context, so a huge `z-index` inside it still loses.
- `position: sticky` fails when any ancestor has `overflow` set to hidden, auto or scroll, because the sticky element sticks to that scroller instead of the page.
- Margin collapse between a parent and its first child moves the parent, not the child. Padding, a border or `display: flow-root` stops it.
- `gap` on older flex implementations is not guaranteed. Check support with `use_skill` and the id `browser-compat-check` if the target browsers are old.
- `box-sizing: content-box` makes width plus padding exceed the parent. Most projects set border-box globally, so check the reset before computing sizes by hand.
- Absolute positioning removes an element from flow, so its parent collapses to zero height. Fix the parent's sizing instead of adding a spacer.
- Viewport units ignore the scrollbar width, so a full-width element can cause a horizontal scrollbar on systems with classic scrollbars.

## Output

- The cause in one or two sentences, naming the property and the element.
- The minimal edit, shown as the changed rule, and where it lives.
- What you checked afterwards (viewports, sibling components) and anything left unverified.
- If the real fix needs a markup change the user did not expect, say so before applying it.
