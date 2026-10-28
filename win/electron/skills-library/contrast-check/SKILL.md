---
name: contrast-check
description: Computes WCAG contrast ratios for text and UI color pairs, covers every state, and proposes the nearest passing adjustment. Use when the user asks to check color contrast, whether text is readable, or whether a design passes WCAG.
---

# Contrast check

## Goal

Tell the user which color pairs fail and by how much, and give a replacement that keeps the look close. Numbers come from a calculation, not from a guess by eye.

## When to use

- The user gives two colors or a palette and asks if the text is readable.
- A stylesheet or token file needs an accessibility pass on color.
- For building a new palette, use `use_skill` with `color-palette-builder`. For a full accessibility audit of a page, use `use_skill` with `accessibility`.

## Steps

1. Find the pairs. For a project, `search_files` for color declarations in CSS, tokens or theme files, then `read_file`. Map each text color to the background it really sits on, including overlays and images. Ask with `ask_user` when the background is not clear.
2. List states for each pair: default, hover, active, focus, disabled, visited links, placeholder text, error text, and dark mode if it exists.
3. Run `run_command` in javascript: parse hex, rgb or hsl to sRGB, linearise each channel, compute relative luminance, then ratio = (lighter + 0.05) / (darker + 0.05). For semi-transparent colors, composite over the background first.
4. Apply the thresholds from the WCAG 2.x text: 4.5:1 for normal text, 3:1 for large text (about 18pt, or 14pt bold) and for UI component boundaries and meaningful graphics. Check the current success criteria with `read_url` on the W3C page if the user needs a citation.
5. For each failure, find the closest passing color by moving lightness while holding hue and saturation, in small steps. Report the old value, new value and ratio.
6. If the user asks, apply the changes with `edit_file` and re-run the calculation on the edited values.
7. Name the WCAG version and level you used (for example AA), and follow the one the user's standard or contract names.
8. For a page that is already running, confirm the computed colors with `browser_navigate` and `browser_get_elements`, since CSS inheritance and opacity can change what the stylesheet suggests.
9. Re-list any pair you could not resolve, such as text over an image, so the user can test it by eye or with a tool on the final render.

## Gotchas

- Do not round. 4.49 fails 4.5. Print two decimals and truncate downward.
- Disabled controls are exempt from the minimum, but placeholders and hint text are not.
- Text over gradients or photos needs a check at the worst point, not the average.
- Focus rings and borders count as UI components with their own 3:1 need.
- A passing ratio does not make text legible if the font is thin at small size. Mention weight when ratios are barely above the line.
- Opacity on a parent lowers the contrast of every child. Compute with the blended result.
- Large text only counts when it really is large in the rendered size, including user zoom and small screens.

## Output

- A short unresolved list when something could not be computed.
- A table: pair, state, ratio, required, pass or fail.
- Fix suggestions with the new hex and its ratio.
- A note on what could not be measured (images, gradients).
