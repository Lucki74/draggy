---
name: verification-before-completion
description: Proves that finished work meets its acceptance conditions with fresh evidence (command output, observed behaviour, file contents) before anyone says it is done. Use when the user asks whether work is finished, to verify or prove it works, or before you report a task as complete.
---

# Verification before completion

## Goal

Replace "it should work" with evidence. Every acceptance condition gets a check run after the last edit, and the final answer states what was checked, what the result was and what was not checked.

## When to use

- You are about to say a task is done, fixed or ready.
- The user asks "are we done?", "does it actually work?" or "prove it".
- A long session ended and the last verified state is unclear.
- For reviewing code quality rather than proving conditions, use `use_skill` with `code-review`.
- For validating a fix to a specific bug, use `use_skill` with `systematic-debugging`.
- The work was done by an earlier step or another agent and you are about to rely on its report.

## Steps

1. Write the acceptance conditions as a list. Take them from the user's words, the ticket, the plan (`update_plan` if one exists) or `acceptance-criteria` output. If none exist, derive two or three and confirm them with `ask_user`.
2. For each condition, pick a check that could fail: a test, a command, a script run with `run_code`, a file read with `read_file`, or a browser step with `browser_snapshot`. "I read the code and it looks right" does not count as a check.
3. Check what changed with `git_status` and `git_diff`. Every changed file should trace to a condition. A change with no condition is either scope creep or a missing condition.
4. Run the checks with `run_command` after the final edit. Capture the exit code and the lines that show pass or fail, with the summary line as a bonus.
5. Test the negative side where it matters: feed one bad input, or confirm the old behaviour is gone.
6. Look for leftovers with `search_files`: debug prints, `TODO` you added, skipped tests, temporary files.
7. Fill a table of condition, check run, result. Any condition without a passing check is reported as unverified, not as probably fine.
8. If a check fails, fix the cause and rerun every check, since the fix can break a condition that passed before.
9. Before the final answer, reread the original request once and compare it to the table, so a condition that was never listed does not slip through.

## Gotchas

- A result from before the last edit is stale. Rerun after the final change, even for a one-line tweak.
- Verify the user's condition, not your own implementation. A test you wrote to match your code proves only that the code equals itself.
- A green build or typecheck proves the code compiles. It says nothing about behaviour.
- A test run that executed zero tests exits with code 0 on many runners. Read the count of tests that ran.
- Output piped through `tail` or `head` can hide a failure printed earlier. Check the exit code too.
- If the environment blocks a check (no display, missing credentials), say so plainly. Do not substitute a weaker check and call it equal.
- A condition that cannot be checked here (needs production data or a human eye) stays unverified. Name who can check it.
- Cached results fool checks. A test runner with a stale cache or a build served from an old output folder passes without running your change.
- Do not widen the acceptance list at the end to match what happened to pass.

## Output

- A table: condition, check, result (pass, fail or unverified).
- One line on anything that could not be checked and why.
- A verdict: done, done with caveats, or not done. If a check failed, report the failure first, not the summary.
- Commands you ran, with the exit code or the pass count, so the user can repeat them.
