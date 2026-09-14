---
name: refactor
description: "Improves the structure of existing code without changing its behaviour, in small verified steps: extracting functions, removing duplication, clarifying names, simplifying conditionals. Use when the user asks to refactor, clean up, simplify, or restructure code."
---

# Refactor

A refactor changes structure, never behaviour. Every step must leave the code working.

## Before touching anything

1. Read the code and its callers (search_files for usages; ask explore for broader questions).
2. Find the tests that cover it and run them with run_command to confirm they pass now. If coverage is thin and the code is risky, propose adding characterisation tests first (tests that pin down current behaviour, even odd behaviour).
3. State the goal in one line: what will be easier after this (reading, testing, changing X).
4. For more than a couple of steps, write the plan with update_plan.

## Techniques, smallest first

- Rename unclear variables, functions and files to say what they do.
- Extract a function from a long block that does one identifiable thing.
- Replace duplicated logic with one shared function, but only when the copies really mean the same thing.
- Simplify conditionals: early returns, guard clauses, named boolean variables, lookup tables instead of long if-else chains.
- Remove dead code, unused parameters and stale comments (confirm unused with search_files).
- Separate pure logic from I/O so it can be tested.
- Move code to where it belongs, and update imports.

## Rules

- One kind of change at a time, then run the tests.
- Keep public interfaces the same unless the user agreed to change them; if they change, update every caller.
- Match the project's existing style and patterns rather than introducing new ones.
- Do not mix refactoring with bug fixes or new features. If you find a bug, note it and ask.
- Stop when the stated goal is reached; do not keep polishing.

## Report

What changed and why, the files touched, confirmation that tests pass (with the command), and anything that behaves differently on purpose (should be nothing unless agreed).
