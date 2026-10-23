---
name: safe-refactor
description: Changes the structure of code while keeping its behaviour fixed, by running a check before and after every single edit and reverting any step that turns it red. Use when the user wants a risky restructure done safely, wants proof that nothing changed, or asks to move logic around with tests as a net.
---

# Safe refactor

## Goal

End with the same behaviour in a better shape, and be able to show it. Each edit is small, bracketed by a passing check, and independently revertible. If the checks cannot show sameness, the refactor waits until they can.

## When to use

- A restructure touches code that matters, and a silent behaviour change would be costly.
- The user asks for proof that nothing changed.
- For a quick low-risk tidy, use `use_skill` with `refactor`.
- For the specific move of pulling a block out into a function, use `use_skill` with `extract-function`.
- For adding tests to untested code first, use `use_skill` with `write-tests`.
- A reviewer asks how you know the behaviour is unchanged.

## Steps

1. State the target shape and the behaviour that must stay fixed. Read the code with `read_file` and find callers with `search_files`.
2. Find the net. Locate tests covering the code with `search_files` and run them with `run_command`. Record the exact command and the baseline result, with the count of tests that ran.
3. Judge the net. For each path you will touch, ask whether a failing test would exist if you broke it. Where not, add a characterisation test that pins today's output, odd cases included. Keep it in a separate step and commit.
4. Plan the edits with `update_plan` as a list of small moves, each of which compiles and passes alone. Order them so the risky move comes after the safe ones that prepare it.
5. For each move, do the loop: edit with `edit_file`, run the same check with `run_command`, compare with the baseline. Green means continue. Red means revert that edit with `git_diff` as your guide and look for a smaller step.
6. Keep each move structural only. If you spot a bug, write it down and carry on. Do not fix it in the same move.
7. After the last move, run the full suite, typecheck and linter. Compare the public surface (exports, signatures, output) before and after with `git_diff`.
8. Report the moves, the check after each and anything you saw but left alone.

## Gotchas

- A passing test suite with low coverage proves little. Check that the tests execute the lines you moved.
- Tests that mock the very function you are restructuring will stay green while real behaviour changes.
- Moving code can reorder side effects, initialisation or imports. A circular import or a changed evaluation order shows up only at runtime.
- Snapshot tests that you refresh to make green are no longer a net. Never update a snapshot during a refactor.
- Performance is behaviour for hot paths. A structural change that adds a copy or an extra query counts.
- Do not rename and move and rewrite in one step. The diff then reads as a deletion plus a new file, and review cannot see sameness.
- Floating-point rounding, key order and timing in outputs can differ without any logic change. Compare outputs exactly where it matters.
- Version control is part of the net. Commit after each green move, so a revert is one command.
- A refactor that cannot be made green in small steps is a rewrite. Say so and switch plans.

## Output

- The move list, each with its check result.
- Baseline and final test counts from the same command.
- Anything noticed but untouched, such as bugs or missing tests, one line each.
- The final diff summary and a confirmation that the public surface is unchanged, or a list of what moved.
- Commit list, one per move.
