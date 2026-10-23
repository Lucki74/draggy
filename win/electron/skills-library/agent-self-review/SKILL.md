---
name: agent-self-review
description: Re-reads finished work against the original request, checks it for gaps, unsupported claims, missed edge cases and stray changes, and fixes what it finds before presenting the result. Use when the user asks to double check the work, or before reporting a task as finished.
---

# Agent self-review

## Goal

Catch your own mistakes before the user does. The review works from the request and the actual artefacts, not from memory of what you meant to do, and it ends with fixes made or problems named.

## When to use

- Before reporting any non-trivial change or document as finished.
- The user asks "are you sure" or "check your work".
- A task had many steps and some early assumptions may have slipped.
- For defining and running acceptance checks, use `use_skill` with `verify-before-done`.

## Steps

1. Re-read the user's original request word by word and write it as a short list of requirements, including the implied ones such as keeping existing behaviour and following the project's style rules.
2. Look at the artefacts as they are now: `git_diff` for code changes, `read_file` for new files. Do not trust your recollection of what was written.
3. Check each requirement against the artefact. For each, find the line or section that satisfies it. Mark any requirement with no match.
4. Hunt for stray changes: files touched that the task did not need, debug output left in, renamed things, formatting churn. Revert them or explain them.
5. Hunt for edge cases: empty input, very large input, missing files, failure of a called service, concurrent use, other platforms. Pick the three most likely and trace them through the code or text.
6. Check claims. Every statement of fact in your answer (a number, a behaviour, a function's existence) needs a source you looked at. Use `search_files` or `read_file` to confirm the ones you are less sure of.
7. Run what can be run: tests, type checks or the program itself with `run_command`. A review without execution is partial; say so if you could not run anything.
8. Read the answer you are about to give as the user would. Is the main point first? Is anything promised that was not done? Are caveats stated?
9. Fix the problems you found. List what you fixed in a line each, and list any you could not fix with the reason.

## Gotchas

- Reviewing your own diff right after writing it finds less. Force a re-read of the files, not the edit calls.
- Praise is not review. Aim to find something wrong and stop only when a real search finds nothing.
- Fixing one thing can break another. Rerun the checks after every fix.
- Do not widen the scope while fixing. Report adjacent problems instead of repairing them unasked.
- A passing test suite proves only what the tests cover. Say what they do not cover.
- Hiding a known flaw in a long answer is worse than stating it plainly.

## Output

- Requirements checked, with met or not met.
- Problems found and fixed, one line each.
- Problems found and left, with reasons.
- Checks run and their results, and what could not be checked.
