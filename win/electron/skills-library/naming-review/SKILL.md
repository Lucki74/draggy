---
name: naming-review
description: Audits the names of variables, functions, types, files and tests for accuracy, consistency with the codebase vocabulary and fit to their scope, and proposes better ones. Use when the user asks to review naming, says names are confusing, or wants misleading identifiers found.
---

# Naming review

## Goal

Find names that mislead or force the reader to open the body to understand them, and propose replacements that match what the code actually does and how this project already talks. The result is a short list of renames worth making, not a rewrite.

## When to use

- The user asks for a naming review of a file, module or diff.
- A reader reports that a function does something other than its name says.
- To apply a rename safely across the project, use `use_skill` with `refactor`.
- For broader readability work, use `use_skill` with `readability-pass`.
- A new module is about to be published and its public names are still cheap to change.

## Steps

1. Read the target with `read_file`. For a diff, use `git_diff` and review only the names the change introduces or touches.
2. Learn the local vocabulary first. Use `search_files` to count how the project names the same idea (`user`, `account`, `member`; `fetch`, `get`, `load`). The majority term wins unless it is wrong.
3. For each function, read its body and ask what it does, what it returns and what it changes. Compare against the name. Mark mismatches:
   - A `get` that writes, caches or throws.
   - A boolean named as a noun, or with a negation (`notDisabled`).
   - A `Manager`, `Helper`, `Util` or `data` name that says nothing.
   - A name that describes how, not what (`loopOverUsers`).
   - Units or types missing where they matter (`timeout` in ms or s?).
4. Check scope fit. Short names suit a three-line loop. Module-level and exported names need full words.
5. Check consistency across files: the same concept spelled two ways, singular and plural mixed, casing that breaks the language convention.
6. For every proposed rename, run `search_files` on the old name to count usage and note whether it is exported, serialised, logged or used in config.
7. Rank by payoff: misleading names first, then vague ones, then style.
8. Check test names and file names with the same rules. A test title should read as a sentence about behaviour, and a file name should predict its main export.

## Gotchas

- A better name in isolation can be a worse name in this codebase. Match the existing vocabulary before improving it.
- Names that appear in JSON keys, database columns, CLI flags, log lines or test snapshots are contracts. Renaming them is a breaking change.
- Do not rename for taste. Each proposal needs a concrete misreading it prevents.
- Domain terms from the product or spec are fixed. Check the glossary or docs before calling one wrong.
- Long names are not clearer by default. If a name needs five words, the function may do too much.
- Abbreviations that are obvious to the author (`cfg`, `ctx`, `idx`) are often fine in this project. Count how widely they are already used before flagging them.

## Output

- A table: location, current name, problem, proposed name, blast radius (local, exported, external).
- The top three renames to do first.
- A note of any naming convention you inferred, so the user can confirm it.
- Names you kept despite doubts, with the reason, so the topic is not reopened.
