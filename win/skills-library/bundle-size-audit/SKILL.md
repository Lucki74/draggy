---
name: bundle-size-audit
description: Analyzes a production JavaScript build to find the largest dependencies and chunks, then cuts avoidable weight through splitting, lighter replacements and import fixes. Use when the user says the bundle is huge, asks to analyze bundle size, or wants less JavaScript shipped.
---

# Bundle size audit

## Goal

Know exactly which modules make up the shipped JavaScript and remove the ones that do not earn their bytes. A good result lists the top contributors, the fixes applied and the measured size before and after.

## When to use

- The user complains about bundle size or slow first load from script.
- A new dependency may have inflated the build.
- For setting limits that prevent regressions, use `use_skill` with `web-performance-budget`.
- For library upgrades that change size, `use_skill` with `dependency-upgrade` covers the upgrade work.
- A new feature added a chart, editor or date library and the build jumped.
- The team wants a first look at dependency weight before choosing between two libraries.

## Steps

1. Identify the bundler and build script from `package.json` with `read_file`. Run the production build with `run_command` and record the emitted file sizes, raw and gzipped.
2. Produce a breakdown. Use the bundler's analysis output or a visualizer plugin, installing it only with the user's consent. Check the current plugin name and usage with `search_web` or `read_url` rather than recalling it.
3. List the top ten modules by size, grouped by package. Mark the ones loaded on the first screen versus those needed later.
4. For each large package, ask three questions: is it needed at all, is there a lighter alternative, is the app importing the whole library when it uses one function.
5. Fix imports. Replace namespace or barrel imports with direct imports, switch to ESM builds, and check that `sideEffects` in the package allows tree shaking.
6. Split by route and by interaction: dynamic `import()` for pages, charts, editors, and modals that most visitors never open.
7. Look for duplicates, such as two versions of the same package or two libraries doing one job, using `run_command` with the package manager's dependency tree command.
8. Rebuild, compare sizes with the baseline, and run the tests with `run_command` to confirm nothing broke.
9. Check polyfills and build targets: an overly old browser target ships transpiled code and helpers that modern browsers never need.
10. Look at source maps and CSS too: unused CSS and duplicated global styles can rival script size on content sites.

## Gotchas

- Measuring a development build is useless. It has no minification and extra helper code.
- Gzip size is what travels, parsed size is what costs CPU on a phone. Report both and say which one a number is.
- A barrel file that re-exports everything can defeat tree shaking when modules have side effects. Import from the specific path.
- Lazy loading something needed for first render only delays it and adds a waterfall. Split what is not needed immediately.
- Moment-style libraries with bundled locales or data tables dominate bundles. Check for locale and timezone data before anything else.
- Removing a dependency used by a dynamic import or a config file breaks at runtime, not at build. Run the app and do not stop at the build.
- A dependency listed as small on a registry page may pull a large tree of its own. Measure in your build, not by package page.
- Importing a locale or icon set dynamically with a wildcard makes the bundler include every file. Use explicit paths.
- Minifier settings and compression differ between local and the host. Compare sizes with the same compression the server applies.

## Output

- A table of the top contributors: package, size, used where, action.
- The changes made and the before and after totals, raw and gzipped.
- What you recommend but did not do, with the risk.
- Note which findings need a product decision, such as dropping a feature, versus a pure engineering change.
