---
name: svg-icon-sketch
description: Hand-writes a simple SVG icon on a fixed grid with consistent strokes and currentColor, then renders it to a PNG to check. Use when the user asks to draw an icon, make a small SVG, or add a matching glyph to an icon set.
---

# SVG icon sketch

## Goal

Produce a small, clean SVG file that matches the style of the surrounding icons and survives theming. The user gets a file they can drop in, not a picture description.

## When to use

- The user needs a UI icon, a simple logo mark sketch or a small illustration in SVG.
- An existing set lacks one glyph and the new one must match.
- For a full brand mark, start with `use_skill` and `logo-brief`.

## Steps

1. Find the set. If a project exists, use `search_files` for `.svg` and `viewBox`, then `read_file` on two or three icons. Note the viewBox, stroke width, cap and join style, corner radius, and whether icons are stroked or filled. With no set, default to a 24 by 24 viewBox, 1.5 or 2 stroke, round caps and joins.
2. State the metaphor in one line (for example "envelope with a check") and keep to two or three shapes. Use `ask_user` if the concept is ambiguous.
3. Draw on whole or half coordinates inside a padding of 2 units. Use `rect`, `circle`, `line` and short `path` commands. Keep paths readable by hand; avoid long arbitrary curves.
4. Use `fill="none"` with `stroke="currentColor"` for outline sets, or `fill="currentColor"` for solid sets. Never hard-code a color unless the user wants a multi-color illustration.
5. Add `role="img"` with a `<title>` if the icon carries meaning alone, or `aria-hidden="true"` if a text label sits next to it.
6. Save with `create_file`. Render a check with `run_command`: for example a browser screenshot with `browser_navigate` to the file URL and `browser_screenshot`, or a command line SVG converter if one is installed. Look at it at 24px and at 16px.
7. Fix and repeat once. Run a minifier only if the project already uses one.
8. Place the new icon in a small HTML page next to three icons from the set at the same size and compare weight and optical size. Adjust until it does not stand out.
9. If several icons are requested, draw them one at a time and keep a short list of the grid rules, so later icons follow the first.

## Gotchas

- Strokes centered on whole numbers blur on a pixel grid. Offset by 0.5 when the stroke width is odd.
- Mixed stroke widths or corner radii inside one icon make it look foreign next to the set.
- Hand-written curves often kink at joins. Prefer arcs and circles over cubic guesses.
- Text elements depend on fonts. Convert lettering to shapes or avoid it.
- Fixed `width` and `height` of 24 break scaling. Keep the viewBox and let CSS size it.
- Shapes that touch the edge of the viewBox get clipped by the stroke. Keep the live area inside the padding.
- Pasted paths from other icon sets may carry a licence. Draw from scratch or check the source's terms.

## Output

- The side-by-side comparison result, in a line.
- The path of the created `.svg` file and its code in a block when it is short.
- The grid and style rules it follows, in one line.
- What the render check showed at 24px and 16px.
