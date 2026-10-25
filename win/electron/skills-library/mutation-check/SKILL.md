---
name: mutation-check
description: Breaks the code on purpose in small ways, one at a time, and checks whether the tests fail, to find tests that pass without protecting anything. Use when the user asks whether tests really catch bugs, how good the tests are, or to try breaking the code to test the tests.
---

# Mutation check

## Goal

Measure test quality by planting small bugs and seeing whether the tests notice. A good result lists the planted bugs that survived, what test would have caught each, and leaves the source files exactly as they were.

## When to use

- Coverage is high but the user does not trust the tests.
- Before relying on tests for a risky refactor.
- A module has tests that were written after the code.
- The team wants proof that tests guard a critical calculation.
- Tests were generated quickly and nobody reviewed their assertions.
- A refactor is planned and test strength is unknown.

For ranking untested areas, use `use_skill` with `test-coverage-gaps`. For writing the missing tests, `write-tests`.

## Steps

1. **Pick the target.** Choose one module with its test file, not the whole repo. Confirm with `git_status` that the tree is clean, so every change is easy to undo.
2. **Run the baseline.** Run the module tests with `run_command`. They must be green and deterministic; otherwise stop and fix that first.
3. **Check for a tool.** Look in the project for a mutation tool and read its current docs with `read_url` before using it. If the project has none, do the manual version below and ask before adding a dependency.
4. **Choose mutations by hand.** In the code with real logic, pick 8 to 15 small changes, each one at a time:
   - flip a comparison (`<` to `<=`) or a boolean
   - change `+` to `-`, or a constant by one
   - delete a statement or a guard clause
   - return an early or empty value
   - swap the order of arguments
   - remove a call that has a side effect
5. **Apply and test each.** Apply one change with `edit_file`, run the module tests, record killed (a test failed) or survived (all passed), then restore the original using `git_diff` to confirm the revert is complete.
6. **Study the survivors.** For each, decide: a missing test, a test without an assertion, a test that checks the wrong thing, or an equivalent change that cannot alter behaviour. Ignore the last kind.
7. **Propose tests** that kill the real survivors. Add them only if the user wants.
8. **Verify the tree.** Run `git_status` and `git_diff` and confirm no planted bug remains.
9. Keep the list of mutations you tried, even the killed ones, so the work can be repeated.

## Gotchas

- Forgetting to revert one mutation leaves a real bug in the code. Check the diff after every round.
- A mutation that makes the code fail to compile or loop forever is not a useful result. Choose changes that still run.
- Equivalent changes survive by nature. Do not count them against the tests.
- Mutating code that is untested on purpose shows only what coverage already told you. Aim at code that has tests.
- A slow suite makes a full run per mutation costly. Run only the related test file.

## Output

A table of mutation, location, killed or survived, and verdict. Then the survivors that matter with a one-line test idea each, and a final line confirming the tree is clean.

Offer to add the missing tests as a next step.
