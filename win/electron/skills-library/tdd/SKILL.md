---
name: tdd
description: Builds a change in small red, green, refactor cycles, with a failing test written first, the least code to pass it, then cleanup with the suite green. Use when the user asks for TDD, wants the test written first, or asks to implement a feature test by test.
---

# Test-driven development

## Goal

Grow a feature or fix a bug through short cycles where each new line of production code exists because a failing test asked for it. A good result is a passing suite whose tests describe the behaviour, plus code that is no bigger than the tests require.

## When to use

- The user asks for TDD, or "test first".
- A new function or module with clear rules (parsers, calculations, validators).
- A bug fix where the failing case can be written down as a test.
- A pull request needs tests that show the behaviour, beyond a coverage number.
- A function is easy to specify with examples before it exists.
- The user wants small commits, each with a passing suite.

For adding tests to code that already works, use `use_skill` with `write-tests`. For broken code without a known cause, use `systematic-debugging`.

## Steps

1. **Find the test setup.** Use `list_directory` and `read_file` to find the runner, the test folder, naming and one existing test. Run the suite once with `run_command` to confirm it is green before you start.
2. **List the behaviours.** Write 3 to 8 small cases in `update_plan`, simplest first, including one edge case and one error case. Ask with `ask_user` if a rule is unclear.
3. **Red.** Write the next test only. Run it with `run_command` and read the failure. It must fail for the right reason (missing behaviour), not a typo or an import error. If it passes, the test is wrong or the feature already exists.
4. **Green.** Write the least code that passes, even if it is a constant. Run the test again, then the whole file.
5. **Refactor.** With everything green, remove duplication and improve names in both code and tests. Run the suite after each small change.
6. **Repeat** from the next case. Pick the case that forces the next real piece of logic.
7. **Finish.** Run the full suite. Check the plan list is done and no test is skipped.
8. Look at the final tests as a specification: read their names top to bottom and check they describe the feature.

## Gotchas

- A test that never failed has not been shown to test anything. Always watch it go red first.
- Writing five tests, then all the code, is test-after in disguise. Keep one failing test at a time.
- Hard-coding the answer is fine for one case. A second case should force the general rule; if it does not, the tests are too weak.
- Tests that mirror the implementation line by line break at every refactor. Assert behaviour at the public edge.
- Changing a test to make it pass hides a design change. Change a test only when the requirement changed.

## Output

A short log of the cycles (test name, red reason, change made) and the final passing run. Name the files created or edited. Mention any case you left out and why.

Tests and code go in separate edits so the cycle stays visible.
