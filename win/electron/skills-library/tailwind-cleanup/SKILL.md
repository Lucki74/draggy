---
name: tailwind-cleanup
description: Reduces repeated and conflicting Tailwind utility strings by extracting components, moving values into the theme config and fixing purge problems. Use when the user asks to clean up Tailwind classes, says there are too many utility classes, or that the Tailwind config is a mess.
---

# Tailwind cleanup

## Goal

Make Tailwind markup readable and consistent without losing its benefits. A good result has repeated patterns in components, repeated values in the theme, no conflicting classes and no class names that vanish in the production build.

## When to use

- Class lists are very long, repeated across files or contradict each other.
- The config has grown arbitrary values and one-off colors.
- For naming colors and spacing as tokens in general, use `use_skill` with `design-tokens`.
- For component API design, use `use_skill` with `react-component-design`.
- A pull request review keeps flagging copied class strings.
- Upgrading Tailwind or changing its plugins requires the config to be tidy first.

## Steps

1. Check the version and config. Read `package.json` and the Tailwind config or CSS entry with `read_file`. Configuration moved between major versions, so check the docs for the installed version with `read_url` before editing config.
2. Find repeated class strings with `search_files`. Look for identical or near-identical long class lists, for example buttons, cards and inputs, across files.
3. Find arbitrary values (`w-[137px]`, `text-[#3a3a3a]`) and count their repeats. Values used more than a couple of times belong in the theme.
4. Find conflicts in single elements: two padding utilities, `flex` with `block`, two text colors. Only one wins, decided by CSS order, not by the order in the string.
5. Extract repeated patterns into a component (preferred in a component framework) rather than a CSS rule. Use `@apply` sparingly and only for things like base element styles.
6. Move repeated arbitrary values into the theme as named values, then replace them with `edit_file`.
7. Check dynamic class names. Search for string building such as template literals that assemble class names. The build scans source text for complete class names, so partial names are not generated.
8. Sort classes consistently with the official formatter plugin if the project uses it, running it with `run_command`. Build the project and compare screenshots of key pages.
9. Audit the content paths: make sure every folder that contains class names is scanned, and that build output or dependencies are not.
10. Check variants usage (hover, focus, dark, responsive) for dead or contradicting combinations, such as `md:hidden` next to `md:block`.

## Gotchas

- `bg-${color}-500` built at runtime is not found by the scanner, so the class is missing in production but works in dev. Use complete class names in a lookup map.
- `@apply` everywhere recreates the old CSS problems and hides the utilities. It also cannot apply some variants as expected.
- Deduplicating by visual similarity can merge classes that differ by a pixel the design wanted. Compare with screenshots.
- Class order in the string does not control precedence. A cleanup that reorders classes will not change a conflict, so resolve it by deleting one.
- Editing the config changes every use of a token at once. Search for usages of a color before renaming or removing it.
- Component libraries need merge helpers so an incoming class overrides a default. Without one, extracted components cannot be customized.
- Custom colors outside the theme (`text-[#abc]`) skip your palette and any dark mode mapping. Move them into the theme when they repeat.
- Important modifiers or CSS from other libraries can beat utilities by specificity. Fix the order of layers instead of adding `!`.
- A formatter that reorders classes creates noisy diffs in a large repo. Apply it in one separate change.

## Output

- A summary of patterns extracted, theme additions and conflicts fixed, with counts.
- The config and component diffs.
- Build and visual check results, and any dynamic class issue still open.
- Report how many class strings changed, so the reviewer knows the size of the diff to expect.
