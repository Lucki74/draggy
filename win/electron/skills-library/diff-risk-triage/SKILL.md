---
name: diff-risk-triage
description: Sorts the files of a large diff into must-read-carefully, skim and mechanical, so review effort goes to the riskiest changes first. Use when the user says a PR is huge, asks where to start reviewing, or wants to know which changes are risky.
---

# Diff risk triage

## Goal

Spend review attention in proportion to risk. The result is an ordered reading plan for a large diff: what to read line by line, what to skim, what to verify by tool, and what looks like noise, with the reason for each placement.

## When to use

- A diff has dozens of files or thousands of lines.
- The reviewer has limited time and needs a start point.
- For the review itself once the order is set, use `use_skill` with `code-review`.
- For judging whether an interface change breaks consumers, use `use_skill` with `api-breaking-change-check`.
- Two reviewers will share one large PR and need to split the files.

## Steps

1. Get the overview with `git_status` and `run_command` using `git diff <base>...HEAD --stat` and `--numstat`. Note file count, line counts and added, deleted or renamed files.
2. Sort files into buckets by path and type:
   - Generated, lockfiles, snapshots, build output: verify by regenerating, not by reading.
   - Pure moves and renames: confirm with `git diff -M --stat` and a similarity check.
   - Tests, docs, translations: skim, but compare tests against the behaviour they claim.
   - Source: classify by risk in step 3.
   - Config, migrations, CI, dependency manifests, permissions: read carefully whatever their size.
3. Score source files for risk: touches money, auth, data deletion or migration; concurrency or caching; public interface; error handling; code with a bug history (`git log` on the file via `run_command`); large changed share of a file; low test coverage.
4. Read the heads of the top-risk files with `read_file` to confirm the placement. Move a file up if it contains more than the stat suggested.
5. Look for the hidden parts. Search with `search_files` for added `TODO`, new dependencies, disabled tests, changed feature flags and widened permissions across the whole diff.
6. Write the reading order: ten or fewer must-read items first, then skims, then tool checks. Add one line per item saying what to look for.
7. Say whether the diff should be split. If it mixes a refactor with behaviour changes, recommend separate PRs.
8. Estimate review time per bucket in minutes. If the must-read bucket exceeds an hour, recommend splitting the PR or involving a second reviewer on a named subset.
9. Record the plan so a second reviewer can take the other half without overlap.

## Gotchas

- The biggest file is not always the riskiest. A five-line change to an auth check beats 500 lines of fixtures.
- A "rename only" file can carry a logic edit. Verify the similarity instead of trusting the label.
- Lockfile and manifest changes can bring in new packages. Read the manifest diff.
- Mechanical changes are safe only if they are truly uniform. Sample at least a few of them, and look at the odd one out.
- A diff that mixes cleanup with behaviour hides the behaviour. Ask for a split rather than reviewing around it.
- Triage lowers effort; it does not replace reading. State which buckets were not read.

## Output

- An ordered reading plan with bucket, files, reason and what to look for.
- A list of what was not examined and how it was checked instead, if at all.
- A recommendation to split or proceed.
- Review time estimate per bucket.
