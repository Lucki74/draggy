---
name: component-library-audit
description: Audits a shared component library or design system for duplicate components, inconsistent APIs, missing states and unused parts, with a safe consolidation order. Use when the user asks to audit their component library, says there are five button variants, or wants a design system cleaned up.
---

# Component library audit

## Goal

Show what the library really contains and how it is used, then propose consolidation that consumers can adopt without breakage. A good audit rests on usage counts and API comparisons, not on impressions.

## When to use

- The user suspects duplicated or inconsistent components.
- A design system needs a health check before a redesign or a version bump.
- For tokens that components should share, use `use_skill` with `design-tokens`.
- For missing interactive states in one component, use `use_skill` with `loading-and-empty-states`.
- Two teams each built their own version of a modal, table or dropdown.
- Preparing to publish the library as a package for other apps.

## Steps

1. Map the library. Use `list_directory` on the components folder and `read_file` on the index or export file to get the public surface. Note the styling method and any docs or story files.
2. Build an inventory: component name, file, props, variants and whether it has tests and docs. Keep it as a table in your notes.
3. Count real usage per component with `search_files` for imports and JSX tags across the app. Count call sites, not files, and note which props each caller passes.
4. Group by purpose. Find components that do the same job under different names (`Button`, `ActionButton`, `PrimaryBtn`), and components whose APIs differ for the same concept (`isDisabled`, `disabled`, `inactive`).
5. Check the states each interactive component handles: hover, focus, active, disabled, loading, error. Note gaps.
6. Check accessibility basics per component: native element used, accessible name, keyboard support. Use `use_skill` with `accessibility` for depth on the worst ones.
7. Propose a consolidation order: safe wins first (unused components to remove, alias renames), then merges with a deprecation period, last the breaking API changes. For wide renames, use `use_skill` with `rename-across-codebase`.
8. Write the plan with specifics, and apply nothing unless the user asks.
9. Review documentation and examples: each shared component needs a usage example, prop table and notes on accessibility behavior. Mark the gaps.
10. Check how the library handles theming, class overrides and responsive behaviour, since inconsistent answers cause consumer hacks.

## Gotchas

- Two components that look alike may have different jobs. Merging a link-styled button with a real button breaks semantics. Compare behaviour, not appearance.
- Zero imports in the repo does not mean unused. The library may be published or consumed by other repos. Check the package config and ask.
- Counting by file name misses dynamic usage, wrappers that re-export under another name, and string-based lookups. Search for the component's props too.
- A prop explosion is usually a missing composition model. Adding another boolean flag is the wrong consolidation.
- Removing a variant that only one screen uses can look free and still break a key flow. List the call sites in the plan.
- Style overrides by consumers (class names, deep selectors) turn internal markup into public API. Search for them before restructuring.
- Visual regression is the main risk when consolidating. Capture screenshots of each variant before touching code so the merge can be compared.
- Components with the same props but different defaults (size, spacing) produce subtle layout shifts after merge. Compare defaults explicitly.
- Deprecation without a date or a codemod never finishes. Pair each deprecation with a replacement and a removal milestone.

## Output

- The inventory table with usage counts.
- A list of duplicates and API inconsistencies, each with call-site counts.
- A staged consolidation plan with risk per step, and a list of what you could not determine.
- Keep the audit to the findings with evidence, and put opinions in a separate, labelled section.
