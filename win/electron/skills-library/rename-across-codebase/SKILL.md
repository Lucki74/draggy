---
name: rename-across-codebase
description: Renames a symbol, file, route or concept everywhere it appears, including imports, strings, config, docs, tests and stored names, and checks nothing references the old name afterwards. Use when the user asks to rename something across the project, change a name everywhere, or move a file and fix all references.
---

# Rename across codebase

## Goal

The old name is gone from everywhere it should be and untouched where it must stay. The build and tests pass, and any external or persisted name that cannot change is flagged instead of silently broken.

## When to use

- A function, class, variable, file, route, flag or config key gets a new name.
- A term changes in the product vocabulary and code should follow.
- To decide whether a name should change, use `use_skill` with `naming-review`.
- For restructuring beyond renames, use `use_skill` with `safe-refactor`.
- A file or directory moves and its import paths must follow.
- A product term changed and tests, docs and UI text must follow.

## Steps

1. Pin the exact old and new names, including casing variants (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `UPPER_CASE`) that the project uses for the same concept.
2. Classify the old name before touching it. Is it local, exported, part of a public API, serialised to disk or a database, a URL, a CLI flag, an environment variable, or shown in logs and UI? External and persisted names need a migration plan, not a find and replace.
3. Search with `search_files` using the exact name with word boundaries and each casing variant. Include source, tests, docs, config, scripts, CI files, templates and translations. Record the count of hits per file type.
4. Check what the search misses: names built from parts (`"get" + Name`), reflection, string keys, generated code, and files outside the repo that depend on the name.
5. Run the tests and typecheck with `run_command` for a baseline.
6. Apply the change. For a file move, use `move_file`, then fix imports. For symbols, change the definition first, then each reference with `edit_file`, and prefer the language's own rename tool through `run_command` where one exists.
7. Rerun the baseline commands. Then search again with `search_files` for each old variant. Every remaining hit should be a reviewed exception, such as a changelog entry, a migration or a compatibility alias.
8. If the name is public or persisted, add the compatibility step: an alias that forwards, a read of both old and new stored keys, or a deprecation notice. Use `use_skill` with `deprecation-rollout` for the removal schedule.

## Gotchas

- A global replace on a short or common word hits unrelated identifiers, comments and prose. Match whole words and review the diff.
- Case-insensitive file systems hide a case-only rename. Git may need a two-step move so the change is recorded.
- Names in stored data, API payloads and event types live outside the codebase. Renaming only the code breaks the data.
- Test snapshots and fixtures contain old names as text. Update them deliberately, then read the diff to confirm the only change is the name.
- Docs, error messages and translations drift if skipped. Search them as well.
- Import paths fail at runtime in dynamic imports and bundler config, not at typecheck. Run the build as well as the typecheck.
- Do not rename and change behaviour in one commit. A rename-only diff is quick to review and easy to revert.
- Search hits in lockfiles, build output and vendored code are noise. Exclude those paths and say so.

## Output

- The old and new names and the variants covered.
- A count of references changed, grouped by area, and the list of reviewed exceptions.
- Build and test results before and after.
- Anything external or persisted that needs a follow-up, with the proposed compatibility step.
- Commands used for the final zero-hit search, so it can be repeated.
