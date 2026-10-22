---
name: refactor
description: Improves the structure of existing code without changing its behaviour, in small verified steps: extracting functions, removing duplication, clarifying names, simplifying conditionals. Use when the user asks to refactor, clean up, simplify, restructure or tidy code.
---

# Refactor

## Goal

Change structure, never behaviour. Every step leaves the code working, and the stated goal (easier to read, test or change) is reached without extra polishing.

## When to use

- The user asks to refactor, clean up, simplify or restructure code.
- For fixing a bug, use `use_skill` with `debugging`.
- For adding tests to code before changing it, use `use_skill` with `write-tests`.
- For adding behaviour, use `use_skill` with `add-feature`.

## Steps

1. Read the code and its callers. Use `search_files` for usages and `explore` for broader questions.
2. Find the tests that cover the code and run them with `run_command` to confirm they pass now. If coverage is thin and the code is risky, propose characterisation tests first, which pin down current behaviour even when it is odd.
3. State the goal in one line: what will be easier after this (reading, testing, changing X).
4. For more than a couple of steps, write the plan with `update_plan`.
5. Apply techniques, smallest first:
   - Rename unclear variables, functions and files to say what they do.
   - Extract a function from a long block that does one identifiable thing.
   - Replace duplicated logic with one shared function, but only when the copies mean the same thing.
   - Simplify conditionals with early returns, guard clauses, named booleans, or lookup tables instead of long if-else chains.
   - Remove dead code, unused parameters and stale comments, confirming they are unused with `search_files`.
   - Separate pure logic from I/O so it can be tested.
   - Move code to where it belongs and update imports.
6. Make one kind of change at a time, then run the tests again.
7. Stop when the stated goal is reached.

## Gotchas

- Mixing a refactor with a bug fix or new feature makes failures impossible to attribute. If you find a bug, note it and ask.
- Public interfaces stay the same unless the user agreed to change them. If they change, update every caller.
- Merging two similar-looking blocks that mean different things creates a coupling bug.
- Introducing a new pattern the project does not use costs more than the cleanup gains. Match the existing style.
- Without passing tests before you start, you cannot tell whether you broke anything.

## Output

What changed and why, the files touched, confirmation that tests pass with the command used, and anything that behaves differently on purpose (nothing, unless agreed).
