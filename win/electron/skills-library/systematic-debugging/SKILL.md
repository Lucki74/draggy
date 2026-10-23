---
name: systematic-debugging
description: Debugs a failure by reproducing it, isolating where it starts, forming ranked hypotheses, proving one with evidence and fixing the root cause. Use when the user says a bug keeps happening, asks to debug something properly, or wants the root cause and not a patch.
---

# Systematic debugging

## Goal

Find why the program does the wrong thing, prove it, and fix the cause instead of the symptom. A good result names the root cause, shows the evidence, changes the smallest amount of code and shows the original failure gone.

## When to use

- A bug has no obvious cause, or a first fix did not work.
- The user wants the real cause before any edit.
- A failure is deterministic or can be made so.
- The user has already tried a fix and the problem came back.
- A bug report says "it broke after the update" with no more detail.
- Two people disagree about the cause.

For a quick bug with a clear cause, use `use_skill` with `debugging`. For a test that passes and fails at random, use `flaky-test-fixer`.

## Steps

1. **Write down the symptom.** State expected behaviour, actual behaviour and the exact error text. Use `ask_user` if either is unclear. Record the steps in `update_plan`.
2. **Reproduce.** Run the failing command with `run_command` and keep the output. If it cannot be reproduced, say so and collect more data (versions, inputs, environment) before touching code.
3. **Isolate.** Narrow the failing area: the first bad value in the data flow, the failing input, the newest change. Use `search_files` to find who writes the bad value. Read the code with `read_file`, not from memory.
4. **List hypotheses.** Write two or three causes, each with the observation that would confirm or kill it. Rank by evidence, not by how easy the fix looks.
5. **Test one hypothesis at a time.** Add a temporary log, assertion or small `run_code` check that gives a yes or no. Change one thing per run. Note the result of each run.
6. **State the root cause** in one sentence: where the bad state is created and why. If the answer is "it is null here", ask who made it null.
7. **Fix at the source.** Make the smallest `edit_file` change at that place. Remove the temporary logging.
8. **Verify.** Rerun the original repro and the nearest existing tests. Add a regression test if the project has tests for this area.
9. Before closing, reread the symptom from step 1 and check each part of it is gone.

## Gotchas

- The crash site is rarely the bug site. Walk back to where the value was first wrong.
- Two edits in one run leave you unsure which one worked. Revert and apply them one by one.
- A hypothesis that fits all the symptoms still needs a test that could have failed.
- A fix that makes the error vanish after a guard or a `try` may have only hidden it. Check the data is right and check more than the exit code.
- Temporary debug output left in the code ships. Search for your markers before finishing.

## Output

A short report: symptom, repro command, root cause with evidence, the fix (file and lines), and the verification run. If the cause stayed unproven, say what remains unknown and what to collect next.

Keep the report short enough to paste into an issue.
