---
name: codemod-writer
description: Writes, tests and runs a script that applies a mechanical code change across many files, using syntax-aware tools where they exist, with a dry run and a report of the files it skipped. Use when the user wants a codemod, needs the same edit applied in hundreds of places, or wants to script a migration of a call pattern.
---

# Codemod writer

## Goal

Apply one well-defined change to every place it belongs and to no place it does not. The script is tested on small cases, run first as a dry run, produces a diff that a human can review, and lists the sites it could not handle.

## When to use

- The same edit is needed in dozens of files (an API change, an import move, a prop rename, a call signature).
- A deprecation or upgrade requires migrating internal callers.
- For a single rename of one symbol, use `use_skill` with `rename-across-codebase`.
- For general restructuring with a test net, use `use_skill` with `safe-refactor`.
- A library upgrade renamed an option used in many call sites.

## Steps

1. Write the change as a rule with before and after examples, including the odd cases. Collect real instances with `search_files` and read a sample with `read_file`. Note how many variants of the pattern exist.
2. Choose the tool. Prefer a syntax-aware one for the language (a vendor-supplied codemod, `jscodeshift`, `ts-morph`, `libcst`, `comby`, `ast-grep` or the language's own refactoring tool). Check which are installed with `run_command`, and read current docs with `read_url` before relying on an API. Use plain regex only when the pattern is a simple, unambiguous token.
3. Write the script to a file with `write_file`, outside the source tree or in a `scripts/` folder. Keep it small and make it idempotent: running it twice must not change the result of the first run.
4. Test it on fixtures before the real code. Write input and expected output files for each variant and for each case it must leave alone (strings, comments, lookalike names). Run with `run_command`.
5. Add a dry-run mode that prints the files and counts without writing. Run it on the repo and compare the count with the `search_files` count from step 1. A difference means skipped or unexpected sites. Print each skipped site with file and line.
6. Run for real on a clean working tree, in batches by folder if the diff is big. After each batch, run formatter, typecheck and tests with `run_command` and review a sample with `git_diff`.
7. Handle leftovers by hand, or extend the script for the next variant and rerun on the remaining files. Keep manual edits in a separate commit from script output.
8. Search again for the old pattern. Remove the script from the repo if it has no further use, or keep it with a note on when it was run.
9. Commit the script output on its own, with the script version noted, so a bad run can be reverted without touching manual fixes.

## Gotchas

- Regex rewrites hit strings, comments and lookalike identifiers, and miss multi-line forms. Prefer syntax-aware tools for anything with nesting.
- Running on a dirty tree makes the script's diff impossible to separate from other edits. Commit or stash first.
- Formatters change whitespace on the files the script touched. Run the project formatter after the script, or the diff will mix both.
- A codemod that works on 95 percent of sites and silently skips the rest leaves a half-migrated codebase. The report of skipped sites is a required output.
- Type-dependent changes (replace the call only when the receiver is a certain type) need type information. A name-only match can rewrite the wrong call.
- Generated and vendored folders should be excluded by path, or the script will fight the generator.
- Review the diff by pattern, not by file. Group similar changes and check one of each group, then look hard at the groups with one member.

## Output

- The script path and how to run it, including the dry-run flag.
- The fixtures and their result.
- Counts: matched, changed, skipped, with the skipped list.
- Test, typecheck and lint results after the run.
- Review notes: which patterns were sampled.
