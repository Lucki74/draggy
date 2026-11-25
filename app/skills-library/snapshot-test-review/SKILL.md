---
name: snapshot-test-review
description: Reviews failing snapshot tests by reading each diff, deciding if the change is intended or a regression, and only then updating the snapshots that deserve it. Use when snapshot tests fail, the user asks whether to update snapshots, or wants a snapshot diff reviewed.
---

# Snapshot test review

## Goal

Make sure every snapshot that changes was meant to change. A good result lists each changed snapshot with a verdict (intended, regression, noise), updates only the intended ones, and fixes the test design where noise keeps coming back.

## When to use

- A run shows snapshot mismatches after a code change.
- Someone is about to run the update-all flag.
- A pull request contains large snapshot diffs to review.
- A reviewer is asked to approve a large generated diff.
- A dependency upgrade changed rendered output.
- Snapshots fail on one operating system only.

For a red suite with mixed failure types, start with `use_skill` and `test-failure-triage`.

## Steps

1. **Run and list.** Run the suite with `run_command`, capturing the failing snapshot names. Do not pass an update flag yet.
2. **State the intended change.** Ask what the code change was supposed to do, or read it with `git_diff`. Write it in one sentence.
3. **Read each diff.** For every failing snapshot, read the expected and received text. Sort the lines:
   - Matches the intended change: expected.
   - Unrelated text, missing element, changed order of items, lost attribute or class: suspect.
   - Differences in ids, dates, random values, absolute paths, line endings: noise.
4. **Decide per snapshot.** Intended, regression or noise. Open the source with `read_file` for each regression and fix the code, not the snapshot.
5. **Remove noise at its source.** Freeze the clock, seed ids, normalise paths, or replace the volatile value with a placeholder in the serializer. Use `edit_file`.
6. **Update selectively.** Update only the intended snapshots, by test name or file, with `run_command`. Never use a blanket update on a mixed failure list.
7. **Re-run** the whole suite twice. The second run proves the snapshots are stable.
8. **Look at the snapshot diff in version control** with `git_diff` and confirm only the expected files changed.
9. Open the final snapshot files once more and read the changed parts to make sure they match the intended change.

## Gotchas

- A blanket update turns the snapshot into a copy of whatever the code does today, bugs included.
- Large snapshots get approved unread. If one covers a whole page, replace it with focused assertions on the parts that matter.
- An obsolete snapshot file left behind passes silently. Check for unused entries.
- Snapshots written on one OS can differ on another through line endings or fonts. Normalise before comparing.
- A snapshot that changed in a file you did not touch means a shared component changed. Check every consumer.

## Output

A table of snapshot, verdict and reason. Then what was updated, what was fixed in code, what noise was removed, and the final run result.

Mention any snapshot that is too large to review and suggest a smaller assertion.
