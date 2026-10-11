---
name: debugging
description: Finds the root cause of a bug or failing test systematically (reproduce, read the error, form and test hypotheses, fix the cause not the symptom, and prove it with a test). Use when something is broken, a test fails, there is an error or stack trace, or behaviour is unexpected.
---

# Debugging

Guessing and editing until the error disappears creates new bugs. Work like a scientist.

## 1. Reproduce

- Get the exact symptom: error message, stack trace, wrong output vs expected, and the steps or command.
- Reproduce it yourself when possible with run_command (the failing test, the script, the build). A bug you cannot reproduce cannot be confirmed fixed.
- For a failing test, run only that test to keep the loop fast.

## 2. Read the evidence

- Read the whole error and the stack trace from the top of the user's own code, not just the last line.
- read_file on each frame in the project. Note the actual values involved.
- Check recent changes: git_status and git_diff, or `git log -p -5 -- <file>` with run_command. Many bugs are in the latest change.

## 3. Hypothesise and test

- Write down 2 or 3 possible causes, most likely first.
- Test one at a time with the cheapest check: read a function, add a temporary log line, run a tiny script with run_code, or run the test with a narrower input.
- Let the result eliminate hypotheses. If none fit, gather more evidence rather than inventing a fix.
- Use update_plan for longer investigations so the user can follow.

## 4. Fix the cause

- Change the code where the wrong value or decision originates, not where it finally explodes.
- Keep the fix minimal and in the project's style. Do not refactor unrelated code in the same change.
- Search for the same mistake elsewhere with search_files.

## 5. Prove it

- Add or update a test that fails without the fix and passes with it, when the project has tests.
- Run the test, then the related test suite, with run_command.
- Remove temporary logging.

## Report

The root cause in one or two sentences, why it produced the symptom, what you changed (files), and the test evidence. If you could not find the cause, say what you ruled out and what to check next.
