---
name: pr-self-review
description: Reads your own diff the way a stranger would and finds leftovers, missing tests, unintended changes and unclear parts before the pull request goes up. Use when the user asks to review their own changes before opening a PR, to check the branch, or to see what a reviewer would flag.
---

# PR self-review

## Goal

Catch the cheap problems yourself so the reviewer spends time on design and risk. The branch ends with a clean, intentional diff, tests that match the change and a description that says what and why.

## When to use

- The user is about to open or update a pull request.
- The user asks what a reviewer would flag in their branch.
- For a deep bug hunt in someone else's change, use `use_skill` with `code-review`.
- For writing the PR text afterwards, use `use_skill` with `pull-request`.
- A follow-up commit was added after a review round and the user wants a final check.
- The change touches code you do not own and you want to arrive with the obvious points covered.

## Steps

1. Run `git_status` to see modified, staged and untracked files. Untracked files are easy to forget and easy to commit by accident.
2. Run `git_diff` for unstaged and for staged changes. For a whole branch, use `run_command` with `git diff <base>...HEAD --stat` first, then read the full diff file by file.
3. Read the diff only, top to bottom, before opening any full file. Mark each hunk: intended, incidental or unknown.
4. Sweep for leftovers with `search_files` on the changed files: `console.log`, `print(`, `debugger`, `TODO`, `FIXME`, commented-out blocks, `.only` and `.skip` in tests, hard-coded paths or keys.
5. Check scope. Every hunk should serve the stated goal. Move formatting-only or unrelated edits to a separate commit.
6. Check tests: for each behaviour change, find the test that would fail without it. Run the suite with `run_command`.
7. Check the surroundings the diff does not show: callers of changed functions, docs and config that mention the old behaviour, changelog or translation files the project requires.
8. Read the diff once more as the reviewer. Mark every spot where you would ask "why?". Add a code comment or a PR note for each.
9. Compare the PR description against the diff. Every claim in the text should map to a hunk, and every notable hunk should be in the text.
10. Run the full lint, typecheck and test commands once more with `run_command`, since a late fix can break an earlier pass.

## Gotchas

- Reading full files hides leftovers because the code looks familiar. The diff view is the point.
- A lockfile, snapshot or generated file in the diff may be noise or a sign of an unintended upgrade. Look at why it changed.
- Whitespace and line-ending churn makes a small change look large. Check `--stat` for files with big counts and tiny meaning.
- Tests that pass because they were edited to match new output need a second look. Ask whether the old expectation was right.
- Secrets pasted during debugging end up in diffs. Search for tokens, URLs with credentials and `.env` content.
- Do not squash away the evidence of an odd decision. If the diff has a surprising choice, the PR text needs one line on why.
- Commit messages are part of the diff review. Check that they match what the commits do.

## Output

- A short list of fixes made or recommended, grouped as leftovers, scope, tests and clarity.
- Anything you left alone on purpose and why.
- A one-line verdict: ready to open, or what to do first.
- Commands run and their results.
- Items you want a human to look at first, with the reason.
