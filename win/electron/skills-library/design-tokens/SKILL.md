---
name: design-tokens
description: Turns scattered colors, spacing, type sizes and radii into a small named token set with a semantic layer, then migrates the code to use it. Use when the user asks to extract design tokens, centralize colors, or set up a theme file.
---

# Design tokens

## Goal

Replace one-off values with a short list of named tokens so a visual change happens in one place. A good result has primitive values, semantic names that say what a value is for, and code that uses only the semantic names.

## When to use

- The user wants colors, spacing or type centralized into variables or a theme.
- The same hex value or pixel size appears in dozens of files.
- For adding a dark theme on top of tokens, use `use_skill` with `dark-mode-theming`.
- For building the look from scratch, use `use_skill` with `frontend-design`.
- Two brands or themes must share one component set.
- A designer hands over a style guide that should be reflected in code.

## Steps

1. Find the existing values. Use `search_files` for hex colors, `rgb(`, `hsl(`, pixel spacing and font sizes in styles and components. Note the styling approach (plain CSS, CSS modules, Tailwind config, CSS-in-JS) with `list_directory` and `read_file`.
2. Count how often each value appears. Group near-duplicates, for example five grays within a few lightness points, and pick one per group.
3. Define primitives first: the raw scale (colors by hue and step, spacing steps, type sizes). Keep it short, and write it where the project already keeps global styles. CSS custom properties work in any stack.
4. Add a semantic layer that maps purpose to primitive: text, text-muted, surface, border, accent, danger. Components reference only these names.
5. Create the token file with `create_file`, or extend the existing one with `edit_file`.
6. Migrate usages in batches, one component group at a time, with `edit_file`. After each batch run the build or tests with `run_command`.
7. Replace leftovers found by a final `search_files` pass, and leave a documented exception only where a value is truly one-off, such as a brand logo color.
8. Confirm the UI looks unchanged by comparing `browser_screenshot` captures before and after, for a few key pages.
9. Document the naming rule in the token file's header comment: tier prefixes, allowed steps, and when to add a new token.
10. Add a check that blocks new raw hex values in component files, such as a lint rule or a `search_files` script run in CI, if the project has CI.

## Gotchas

- Naming a token after its value (`--blue-500` used everywhere, or `--gray-light`) breaks the moment the value changes. Components should use purpose names.
- Merging near-duplicates changes the look slightly. Tell the user, and check contrast on the merged color so text stays readable.
- Too many tokens is as bad as none. A spacing scale of twenty steps invites the same drift. Start with a handful and add on demand.
- CSS custom properties are resolved at runtime, so they cannot be used inside media query conditions. Breakpoints need a different mechanism.
- Tokens used in SVG or canvas need `currentColor` or a computed read, since those contexts may not inherit the variable.
- Do not rename a token that other code or a plugin already consumes without a search for every use first.
- Alpha variants of a color (hover overlays, borders) need their own tokens or relative color syntax. Hardcoding `rgba` beside a token drifts when the base color changes.
- Spacing tokens used for both gaps and sizes get stretched into awkward values. Keep a separate size scale if components need it.
- Importing tokens into JavaScript for charts or canvas needs a build step or a runtime read of computed styles. Plan for it before promising one source of truth.

## Output

- The token file or diff, with primitives and semantic names visibly separated.
- A migration summary: how many usages replaced, which values merged, which left as exceptions.
- A short naming guide of two or three lines so the next person adds tokens consistently.
- Flag any token whose value changed after merging so the designer can confirm it.
