---
name: test-failure-triage
description: Sorts a red test run into groups with a shared cause, decides for each group whether the code, the test or the environment is wrong, and orders the fixes. Use when many tests fail, the suite went red after a change, or the user asks why CI failed.
---

# Test failure triage

## Goal

Turn a long list of failures into a few causes and a fix order. A good result groups failures, says which side is wrong for each group, and tells the user which fix removes the most red first.

## When to use

- Dozens of tests fail after a change, upgrade or merge.
- A CI run failed and the log is long.
- The user cannot tell if failures are real or environmental.
- A dependency upgrade turned many tests red.
- A pull request has failing checks that the author does not understand.
- The user returns after a long break to a failing branch.

For a single test that passes sometimes, use `use_skill` with `flaky-test-fixer`. For snapshot-only failures, `snapshot-test-review`.

## Steps

1. **Get the full list.** Run the suite with `run_command` using a compact reporter, or read the CI log with `read_file`. Record counts: total, failed, skipped. Save output to a file so you can search it.
2. **Check the base.** Find out if the failures exist without your change: run the same tests on the base commit using a clean checkout or stash, or check the last green CI run. Failures that exist there are not yours.
3. **Group by message.** Use `search_files` on the output for the first error line of each failure. Group identical or near identical messages: same import error, same missing file, same timeout, same assertion on one function.
4. **Name a cause per group.** Look at the most common group first. Read the failing test and the code it exercises with `read_file`. Check `git_diff` for a change that fits.
5. **Decide the side.** The code is wrong if the test describes a still valid requirement. The test is wrong only if the requirement changed on purpose. The environment is wrong if the failure involves paths, permissions, versions, missing services or platform differences.
6. **Order the fixes.** Start with groups that block others (build errors, import failures, broken setup), then the largest group, then the single ones. Record this in `update_plan`.
7. **Fix and re-run** after each group, not at the end. Compare the failure count after each fix.
8. **Finish** with a full run and compare to the baseline from step 1.
9. Keep a short list of failures you set aside and why, so nothing is dropped silently.

## Gotchas

- One broken import or fixture can fail hundreds of tests. Fix it before reading any individual failure.
- Editing a test to match new behaviour is only right when the behaviour change was intended.
- Known environmental failures on a machine are not regressions. Confirm them against the base run, then set them aside by name.
- Later failures in a file can come from state left by the first. Rerun the failing test alone.
- A skipped test is not a passing test. Check that the skip count did not rise.

## Output

A table: group, count, example message, cause, side (code, test, environment), fix. Then the order of work and the before and after counts.

End with the first fix to try and the command to check it.
