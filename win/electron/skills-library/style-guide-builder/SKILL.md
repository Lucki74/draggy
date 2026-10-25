---
name: style-guide-builder
description: Derives a UI style guide from the code or design files in use, listing the real colors, type, spacing, radii and component patterns, and flagging near duplicates. Use when the user asks to build a style guide, document design tokens, or find out which colors and fonts the project uses.
---

# Style guide builder

## Goal

Document the design system that actually shipped, not the one people think they have. The result is a guide of observed tokens and patterns, plus a list of inconsistencies to resolve.

## When to use

- The user has a codebase with no design documentation.
- A redesign or new contributor needs the current values written down.
- To create a new palette or font set from scratch, use `use_skill` with `color-palette-builder` or `typography-pairing`.
- For brand voice and logo rules aimed at non-developers, use `use_skill` with `brand-guidelines-outline`.

## Steps

1. Locate the style sources with `list_directory` and `search_files`: theme files, CSS variables, Tailwind config, token JSON, component libraries and global stylesheets. Use `explore` for a large project and ask for the area that matters.
2. Extract colors. Search for hex, rgb, hsl and named values. Count how often each appears with `run_command` or `run_code`, and separate tokens (defined once, referenced) from raw literals in components.
3. Extract type: font families, sizes, weights, line heights. Extract spacing values, border radii, shadows, z-index layers, breakpoints and motion durations the same way.
4. Group near duplicates (for example `#333` and `#343434`, or 15px and 16px) and propose the one to keep. Do not merge them in code unless asked.
5. Read three to five core components (button, input, card, modal, nav) with `read_file` and note variants, states and the tokens they use.
6. Write the guide with `create_file` as `STYLE-GUIDE.md`: tokens as tables with name, value and usage count, component rules, and a final "Inconsistencies" section with file and line references.
7. Offer next steps rather than doing them: consolidate tokens, add a lint rule, or generate a CSS variables file.
8. Verify two or three numbers in the guide by hand: pick a token, run `search_files` for it, and confirm the count and usage match what you wrote.
9. If a design file such as a Figma export or a style sheet exists, compare it with the code and list where the two disagree.

## Gotchas

- Counting raw values includes vendored libraries and build output. Exclude `node_modules`, `dist` and generated files.
- A value used once is not a token. List it under one-offs.
- Dark mode and themes may redefine the same names. Capture each theme.
- Inline styles and CSS-in-JS can hide values from simple searches. Search component files too.
- Do not invent names for tokens that have none. Mark them as unnamed and suggest names separately.
- Computed values (calc, color-mix, clamp) do not appear as literals. Record the formula, not a guessed result.
- Generated files get regenerated. Point the guide at the source of truth, not at the output.

## Output

- A line on how counts were verified.
- `STYLE-GUIDE.md` with token tables, component notes and an inconsistency list.
- The three highest-value cleanups, one line each.
- Which folders were scanned and which were skipped.
