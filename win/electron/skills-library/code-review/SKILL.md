---
name: code-review
description: Reviews uncommitted changes, a branch or given files for real bugs first (logic errors, edge cases, security, data loss), then maintainability, with specific, ranked findings. Use when the user asks for a code review, to check their changes, or whether something is ready to commit or merge.
---

# Code review

The goal is to find problems that would hurt users or maintainers, not to restate the code or impose personal style.

## Get the change

1. With git: git_status to see what changed, then git_diff for unstaged changes and git_diff with staged set for staged ones. For a branch, run `git diff main...HEAD` (or the right base branch) with run_command.
2. Without git or for specific files: read_file on the files the user named.
3. Read enough surrounding code to understand each change: the callers of a changed function (search_files for its name), the types it uses, and existing tests. Ask explore for wider questions such as where something is used across the project.
4. Read the project's conventions in AGENTS.md or CONTRIBUTING.md if present.

## Look for, in this order

1. **Correctness:** wrong conditions, off-by-one, null or undefined paths, unhandled errors, wrong async ordering or missing await, race conditions, incorrect state updates, broken edge cases (empty lists, zero, very large input, unicode, time zones).
2. **Security and data:** injection, missing authorisation checks, secrets in code, unsafe deserialisation, path traversal, data loss or corruption, irreversible operations without confirmation.
3. **Behaviour changes:** public API or output changes not intended, backwards compatibility, migrations.
4. **Tests:** is the new behaviour tested? Would the tests fail if the bug they target came back?
5. **Maintainability:** duplication of existing helpers, misleading names, dead code, overly clever logic, comments that lie.
6. **Performance:** only where it plausibly matters (loops over large data, repeated I/O, N+1 queries).

Use checklist.md (use_skill with file "checklist.md") for a fuller list when the change is large or risky.

## Verify before reporting

For each suspected bug, trace the code path to confirm it can actually happen. If you can, prove it: run the relevant tests with run_command, or a tiny script with run_code. Drop findings you cannot substantiate, or mark them clearly as questions.

## Report

- Findings ranked by severity: **Critical** (bug, security, data loss), **Should fix**, **Consider** (optional improvements).
- Each finding: file and line, what is wrong, a concrete failure scenario (inputs → wrong result), and a suggested fix (a short code snippet if it helps).
- A one-line overall verdict: ready, ready after fixes, or needs rework.
- Say explicitly what you did not review.

Do not edit files during a review unless the user asks for fixes.
