---
name: responsive-audit
description: Checks a page or component at phone, tablet and desktop widths and orientations, then reports concrete breakages with their causes. Use when the user asks whether a page is responsive, says it looks wrong on mobile, or wants a layout check before release.
---

# Responsive audit

## Goal

Find the places where a layout fails as the viewport changes: overflow, clipped text, tiny tap targets, overlapping elements and unreachable controls. A good audit lists each failure with the width where it starts and the rule behind it.

## When to use

- The user asks if a page is responsive or reports a mobile problem.
- A release or redesign needs a layout check across sizes.
- For one stubborn broken layout at a single size, use `use_skill` with `css-layout-debugging`.
- For text and focus problems at zoom, `use_skill` with `accessibility` covers the details.
- A designer reports a page that does not match the mockups on a tablet.
- A new section or component is about to ship and has only been seen at one width.

## Steps

1. Establish the target: which devices or minimum width the project supports. Check the project's docs or CSS breakpoints with `search_files` for `@media` and container queries. Ask with `ask_user` only if nothing states it.
2. Confirm the page has `<meta name="viewport" content="width=device-width, initial-scale=1">`. Without it phones render a desktop-width page.
3. Open the page with `browser_navigate`. Take a `browser_screenshot` at roughly 360, 390, 768, 1024 and 1440 pixel widths. If the browser tools cannot resize, use the page's own device emulation or report which widths you could not test.
4. At each width look for: horizontal scrolling (check `document.documentElement.scrollWidth` against `innerWidth` via `browser_console`), text clipped or overlapping, images beyond their container, fixed-width elements, and navigation that is unreachable.
5. Check touch use: interactive targets around 44 by 44 CSS pixels or at least well spaced, hover-only menus, and sticky headers that cover content on short screens.
6. Test landscape on a short viewport (for example 700 by 360) and a text zoom of 200 percent. Both break fixed heights.
7. Trace each failure to its rule with `read_file`, naming the selector and the breakpoint that should handle it.
8. Fix only if asked. Otherwise rank the findings and stop.
9. Check that images use responsive sources or sensible `max-width`, and that large media does not download at full size on phones.
10. Re-run the failing widths after any fix and confirm the neighbouring widths did not regress.

## Gotchas

- Dragging a desktop window narrower is not mobile testing. It leaves out touch behaviour, the dynamic browser toolbar and real font rendering.
- `100vh` is taller than the visible area on mobile browsers when the address bar shows. Prefer `dvh` or `svh` units where supported, and verify support first.
- Breakpoints chosen from device names go stale. Place them where the content breaks, not at "iPhone width".
- A single horizontal overflow often comes from one element such as a wide table, code block or a `100vw` width that ignores the scrollbar. Find the widest child before rewriting the layout.
- Images with fixed `width` and `height` attributes but no `max-width: 100%` overflow narrow containers.
- Inputs with a font size under 16 pixels make some mobile browsers zoom the page on focus.
- Container queries respond to the parent, not the viewport, so a component can break in a narrow sidebar on a wide screen. Test components in their narrowest slot.
- Fixed-position banners and cookie bars can cover half of a short phone screen. Test with them visible.
- Long unbroken strings such as URLs and German compound words overflow narrow columns. Test with long real content instead of the sample text.

## Output

- A table or list: width where it breaks, element, symptom, cause, suggested fix.
- A note of which widths and orientations were actually tested and which were not.
- Findings ranked by how much they block use, with unreachable controls first.
- Include one screenshot reference per finding when the browser tools produced them.
