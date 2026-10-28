---
name: debugging
description: Finds the root cause of a bug or failing test systematically. Reproduces it, reads the evidence, tests hypotheses one at a time, fixes the cause instead of the symptom and proves the fix with a test. Use when something is broken, a test fails, there is an error or stack trace, or behaviour is unexpected.
---

# Debugging

## Goal

Find why the code misbehaves and fix that cause, not the place where it finally fails. Guessing and editing until the error disappears creates new bugs, so work like a scientist. A good result names the root cause, shows why it produced the symptom, and comes with test evidence.

## When to use

- A test fails, a build breaks, or the program throws an error or stack trace.
- The output is wrong or the behaviour is unexpected.
- For reviewing a finished change for bugs, use `use_skill` with `code-review`.

## Steps

1. Reproduce.
   - Get the exact symptom: error message, stack trace, wrong output against expected, and the steps or command.
   - Reproduce it yourself with `run_command` (the failing test, the script, the build). A bug you cannot reproduce cannot be confirmed fixed.
   - For a failing test, run only that test to keep the loop fast.
2. Read the evidence.
   - Read the whole error and the stack trace from the top of the user's own code, and read past the last line.
   - Use `read_file` on each frame in the project and note the actual values involved.
   - Check recent changes with `git_status` and `git_diff`, or `git log -p -5 -- <file>` through `run_command`. Many bugs are in the latest change.
3. Hypothesise and test.
   - Write down two or three possible causes, most likely first.
   - Test one at a time with the cheapest check: read a function, add a temporary log line, run a tiny script with `run_command`, or run the test with a narrower input.
   - Let the result eliminate hypotheses. If none fit, gather more evidence rather than inventing a fix.
   - Use `update_plan` for longer investigations so the user can follow.
4. Fix the cause.
   - Change the code where the wrong value or decision originates, not where it finally explodes.
   - Keep the fix minimal and in the project's style. Do not refactor unrelated code in the same change.
   - Search for the same mistake elsewhere with `search_files`.
5. Prove it.
   - When the project has tests, add or update one that fails without the fix and passes with it.
   - Run that test, then the related suite, with `run_command`.
   - Remove temporary logging.

## Gotchas

- Fixing where the error surfaces hides the bug. The wrong value usually came from further up the call chain.
- A bug you never reproduced is a bug you cannot claim to have fixed.
- Changing several things at once makes it impossible to tell which one mattered. Test one hypothesis at a time.
- Temporary log lines and debug flags left behind become new problems. Remove them before finishing.
- If you cannot find the cause, say so. A guessed fix that happens to silence the error is worse than an honest "not found yet".

## Output

The root cause in one or two sentences, why it produced the symptom, what you changed (files), and the test evidence. If you could not find the cause, say what you ruled out and what to check next.
