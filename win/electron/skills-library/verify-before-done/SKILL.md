---
name: verify-before-done
description: Defines acceptance checks from the request, runs them, and reports only what was observed, naming every check skipped or failed, before the agent says a task is finished. Use when the user asks to make sure it works, prove it is done, or verify changes, and before closing any task with side effects.
---

# Verify before done

## Goal

Say "done" only when something observed supports it. The checks come from what the user asked for, they are run and not assumed, and the report separates what was seen from what is expected.

## When to use

- A change is finished and about to be reported.
- The user asks if it really works or wants proof.
- The task had a clear target such as a failing test, a script, a page or a file format.
- For a broader read-through of the work and the answer, use `use_skill` with `agent-self-review`.

## Steps

1. Write the acceptance conditions from the request as short statements that can be observed: "the test named X passes", "the file opens in the target program", "the page shows the new label", "no other test newly fails".
2. Add the regression condition. Whatever worked before should still work, so name the existing tests, builds or flows that sit near the change.
3. Pick a way to observe each condition. Prefer running the real thing: the test command or the program through `run_command`, a script via `run_code`, or the page via the browser tools. Reading the code is weaker evidence.
4. Run the narrow check first, such as the single test or the single command. Then run the wider set. Use quiet output flags so results are short, but keep failure text.
5. Read the output. Count passes and failures yourself instead of trusting a summary line, and look for skipped tests or warnings that matter.
6. Try one unhappy path: empty input, a missing file, a wrong argument. A change that only works on the happy path is half done.
7. Inspect the diff with `git_diff` to confirm only intended files changed and that no debug code or temporary files remain.
8. If any check fails, fix and rerun all checks that could be affected. Do not report partial success as success.
9. Write the report: each condition with the evidence, then the list of checks you could not run and why. Keep "should" and "probably" out of the done line.

## Gotchas

- A green run of the wrong test proves nothing. Make sure the check would fail without your change.
- Environment-only failures (missing permission, no display) must be named as such. Do not hide them and do not blame the environment without evidence.
- Passing type checks does not mean the behaviour is right.
- Cached results can mislead. If a result looks too good, rerun without the cache.
- Skipped checks are part of the report. Silence reads as "all passed".
- Do not edit the check to make it pass unless the check was wrong, and then say so.

## Output

- Each acceptance condition with pass, fail or not checked, plus the evidence.
- The commands run and the key lines of their output.
- Remaining risks and the checks that were not possible.
- A final status in one word: verified, partly verified or unverified.
