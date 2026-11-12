---
name: color-palette-builder
description: Builds a color palette from a mood, brand word or seed color, with named roles, tint steps, a dark variant and contrast tested pairs. Use when the user asks for a color palette, brand colors, or which colors go with a given color.
---

# Color palette builder

## Goal

Give the user a small palette they can paste into code or a design tool and trust. Each color has a job, each text pair has a measured contrast ratio, and the whole set matches the mood they described.

## When to use

- The user wants brand, app or slide colors from a mood, an industry or one seed color.
- The user has one color and asks what goes with it.
- To only test colors they already chose, use `use_skill` with `contrast-check`.
- For a full set of rules around the palette, use `use_skill` with `style-guide-builder`.

## Steps

1. Ask with `ask_user` for the seed (a hex, a word like "calm", or a reference), the medium (web, print, slides), and whether a dark theme is needed. Print needs CMYK care, so say so early.
2. Fix the roles before picking hues: background, surface, text, muted text, border, primary action, secondary, success, warning, danger. A role with no color yet is a gap, not a decision.
3. Pick one primary from the seed. Choose a neutral family with a slight tint of the primary hue rather than pure gray. Add at most one accent. Warning and danger colors come from convention, not from the brand.
4. Build 9 or 10 steps (50 to 900) for the primary and the neutral. Do it with `run_command` in javascript: convert hex to a perceptual space such as OKLCH, vary lightness in even steps, and keep hue steady with chroma eased at the extremes.
5. Test pairs in the same script with the WCAG relative luminance formula. Text on background needs 4.5:1 for body size, 3:1 for large text and UI borders. Check the primary button label against the primary fill, and the muted text against the surface.
6. Build the dark variant by remapping roles to different steps, not by inverting values. Re-run the contrast checks on it.
7. If the user wants a file, use `create_file` for `palette.css` (custom properties) or JSON tokens, named by role (`--color-text`), not by hue (`--blue-600`) alone.
8. Show the palette applied to a tiny sample (a button, a card, a link in body text) with `create_file` as a one-file HTML preview, and open it with `browser_navigate` plus `browser_screenshot` to judge it as a whole.
9. Ask the user to name the two colors they like least. Replace those first, then re-run the contrast pass.

## Gotchas

- Colors that look good in a swatch row can fail as text on each other. Test the pairs the interface will really use.
- Saturated primaries at mid lightness often fail with white text. Darken the fill or switch the label to a dark color, and say which.
- A palette with six accents has no accent. Keep one voice and use tints for variety.
- Never rely on color alone to carry meaning such as error or success. Tell the user to pair it with an icon or word.
- Screen hex values shift on paper. For print, tell the user to ask the printer for a proof.
- Color names borrowed from famous brands or paint makers create false expectations. Name by role.
- Color blindness changes how pairs look. Avoid red against green as the only difference.

## Output

- The preview file path, so the user can see the palette in use.
- A table of roles with hex values, light and dark side by side.
- A contrast table with the pair, ratio and pass or fail at body and large size.
- One sentence on the mood each choice supports.
- The file path if one was created.
