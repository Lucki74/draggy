---
name: code-review
description: Reviews uncommitted changes, a branch or given files for real bugs first (logic errors, edge cases, security, data loss), then maintainability, with specific ranked findings. Use when the user asks for a code review, to check their changes, or whether something is ready to commit or merge.
---

# Code review

## Goal

Find problems that would hurt users or maintainers, not restate the code or impose personal style. A good review gives findings ranked by severity, each with a concrete failure scenario and a fix.

## When to use

- The user asks for a code review or to check their changes.
- The user asks whether something is ready to commit or merge.
- For accessibility problems in a UI, use `use_skill` with `accessibility`.
- For writing the commit message after review, use `use_skill` with `commit-message`.

## Steps

1. Get the change. With git, run `git_status` to see what changed, then `git_diff` for unstaged changes and `git_diff` with staged set for staged ones. For a branch, run `git diff main...HEAD` (or the right base branch) with `run_command`. Without git, or for specific files, use `read_file` on the files the user named.
2. Read enough surrounding code to understand each change: the callers of a changed function (`search_files` for its name), the types it uses, and the existing tests. Use `explore` for wider questions such as where something is used across the project. Read AGENTS.md or CONTRIBUTING.md for the project's conventions.
3. Look for problems in this order:
   - **Correctness:** wrong conditions, off-by-one, null or undefined paths, unhandled errors, wrong async ordering or a missing await, race conditions, incorrect state updates, broken edge cases (empty lists, zero, very large input, unicode, time zones).
   - **Security and data:** injection, missing authorisation checks, secrets in code, unsafe deserialisation, path traversal, data loss or corruption, irreversible operations without confirmation.
   - **Behaviour changes:** public API or output changes that were not intended, backwards compatibility, migrations.
   - **Tests:** is the new behaviour tested, and would the tests fail if the bug they target came back?
   - **Maintainability:** duplication of existing helpers, misleading names, dead code, overly clever logic, comments that lie.
   - **Performance:** only where it plausibly matters, such as loops over large data, repeated I/O, N+1 queries.
4. For a large or risky change, work through the [checklist](checklist.md) with `use_skill` and file "checklist.md".
5. Verify each suspected bug by tracing the code path to confirm it can happen. If you can, prove it by running the relevant tests with `run_command`, or a tiny script with `run_command`. Drop findings you cannot substantiate, or mark them clearly as questions.

## Gotchas

- Unverified findings waste the author's time and erode trust. Trace the path before reporting.
- Style preferences are not findings. Raise a style point only if it breaks a documented project convention.
- A diff shows only changed lines. A bug often sits in the unchanged caller, so read the surroundings.
- Do not edit files during a review unless the user asks for fixes.
- A review that does not say what it skipped sounds more complete than it is.

## Output

- Findings ranked by severity: **Critical** (bug, security, data loss), **Should fix**, **Consider** (optional improvements).
- Each finding gives the file and line, what is wrong, a concrete failure scenario (inputs and wrong result), and a suggested fix, with a short code snippet if it helps.
- A one-line verdict: ready, ready after fixes, or needs rework.
- A statement of what you did not review.
