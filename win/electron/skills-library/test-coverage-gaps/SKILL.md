---
name: test-coverage-gaps
description: Reads coverage output together with the code and lists the untested behaviour that carries real risk, ranked, with a suggested test for each. Use when the user asks what is not tested, where the coverage gaps are, or what to test next.
---

# Test coverage gaps

## Goal

Tell the user which untested behaviour is most likely to hurt them, and what one test for each would look like. A good result is a short ranked list, not a percentage and not a wall of file names.

## When to use

- The user wants to know where the tests are thin.
- Before a refactor, to see what protects the code.
- After a coverage report arrives and nobody knows what to do with it.
- A team wants a testing priority list for the next sprint.
- Someone asks if a module is safe to change.
- A new contributor needs to know where tests are weakest.

To write the tests themselves, hand over to `use_skill` with `write-tests`. To check that existing tests catch bugs, use `mutation-check`.

## Steps

1. **Get coverage.** Look in package.json or the build files with `read_file` for a coverage script. Run it with `run_command`. If none exists, ask with `ask_user` before adding tooling; otherwise read tests and code by hand.
2. **Find the report.** Locate the summary or lcov file with `list_directory` or `search_files`. Read per-file numbers and the uncovered line ranges.
3. **Map gaps to behaviour.** For each low-coverage file, `read_file` the uncovered ranges and say what the code does there: error handling, parsing, money or date math, permission checks, retries, cleanup.
4. **Rank by risk.** Score each gap on how bad a bug would be (data loss, wrong result, security), how often the code runs, and how recently it changed. Use `git_diff` or `run_command` with git log for recent churn.
5. **Drop the noise.** Remove generated code, trivial getters, type-only files, thin wrappers and code only reached through frameworks.
6. **Propose tests.** For the top five to ten gaps, write one line each: file, behaviour, the input that exercises it, the expected result.
7. **Offer next move.** Ask which gap to cover first.
8. State which test command and configuration produced the numbers so they can be reproduced.

## Gotchas

- Line coverage says a line ran, not that its result was checked. A test with no assertion raises the number.
- Branch gaps hide inside covered lines: `a || b`, ternaries, early returns, `catch` blocks.
- A single high number across the repo can hide one untested critical module. Read per file.
- Coverage from a run that excluded slow or integration tests understates the real picture. Say which tests ran.
- Do not push for 100 percent. Say where the effort stops paying.

## Output

A ranked list: file and range, behaviour, why it matters, suggested test. Then one line with the overall number and which tests produced it. No raw dump of the report.

Offer to write the first test for the top gap.
