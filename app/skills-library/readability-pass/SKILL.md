---
name: readability-pass
description: Makes code easier to read through ordering, small clarifications and useful comments in a bounded pass, with behaviour unchanged and tests as the check. Use when the user asks to make code easier to read, to do a readability pass, or says a function is hard to follow.
---

# Readability pass

## Goal

The next reader understands the code on the first read. The pass is bounded to one file or function set, changes how code reads and not what it does, and leaves a diff the author can review in minutes.

## When to use

- A function or file is hard to follow and the user wants it tidier without redesign.
- Before handing code to someone new.
- For names only, use `use_skill` with `naming-review`.
- For structural changes such as extracting or moving code, use `use_skill` with `refactor`.
- A reviewer said 'I could not follow this' and the change is otherwise accepted.

## Steps

1. Set the bounds with the user: which files, and that behaviour must not change. Read them with `read_file`.
2. Run the tests that cover the code with `run_command` to get a passing baseline. If there are none, say so and keep the pass to comments, ordering and trivial edits.
3. Read once as a newcomer and note where you stumbled: where you had to scroll back, reread a condition, or guess what a value means.
4. Fix each stumble with the smallest edit:
   - Order: put the main path first, helpers after, related functions together.
   - Early returns instead of deep nesting for guard cases.
   - Named intermediate values for long expressions or magic numbers.
   - A comment for the why: a constraint, a workaround, an odd ordering. Delete comments that restate the code.
   - Consistent spelling and shape for repeated patterns in the same file.
5. Apply with `edit_file`, in several small edits rather than one rewrite.
6. Rerun the tests and linter with `run_command`. Read the result with `git_diff` and confirm that every hunk is a readability change.
7. Mention anything you noticed but did not touch: a bug, a risky branch, a needed test. Do not fix those inside this pass.
8. Check the line count of the touched functions before and after. If a function got longer, make sure the extra lines carry clarity (names, guards) and not noise.
9. Read the result aloud in your head from the top. If you still stumble at the same place, the problem is structural, so report it for the refactor skill instead of forcing a comment.

## Gotchas

- A rewrite labelled as readability often changes behaviour in edge cases. Keep edits mechanical or leave them.
- Reordering code can change evaluation order, initialisation order and side effects. Check before moving anything with effects.
- Reformatting the whole file buries the real edits. Leave formatting to the formatter and a separate commit.
- Comments that explain what the code does go stale. Comments that explain why survive.
- Replacing a loop with a clever chain is shorter but not always clearer. Pick what the team reads fastest.
- If you find a bug, report it and stop. Silently fixing it inside a readability diff hides the change.

## Output

- The edited files, with a short list of what kind of edit was made and where.
- The test result before and after.
- Observations left for later, each one line.
- Spots that still read badly and need a structural change.
