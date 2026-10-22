---
name: write-tests
description: Adds meaningful automated tests using the project's existing framework and conventions, covering behaviour, edge cases and regressions, and runs them. Use when the user asks for tests, better coverage, or a test for a bug or new feature.
---

# Write tests

## Goal

Add tests that fail when the behaviour breaks and pass when it works, written in the style the project already uses, and run them to prove it.

## When to use

- The user asks for unit tests, integration tests or better coverage.
- The user wants a regression test for a bug.
- The user adds a feature and wants it tested.
- For finding the cause of a failing test, use `use_skill` with `debugging`.

## Steps

1. Find the framework and conventions. Read package.json, pyproject.toml, Cargo.toml, go.mod or the build file, and use `search_files` for existing test files (`.test.`, `_test.`, `test_`, `spec`).
2. Read two or three existing tests near the code under test with `read_file`. Copy their structure: file location and naming, imports, fixtures and helpers, mocking style, assertion style.
3. Find the command that runs tests (package scripts, Makefile, CI config).
4. Decide what to test:
   - The behaviour the code promises, not its private implementation details.
   - For each function or component: the normal case, boundaries (empty, zero, one, many, maximum), invalid input and errors, and any case that has broken before.
   - For a bug, first a test that reproduces it and fails.
   - A few precise tests beat many shallow ones. Each test checks one behaviour and its name says which ("returns an empty list when the folder has no files").
5. Write them:
   - Arrange, act, assert, clearly separated.
   - Use real objects where cheap. Mock only slow or external things (network, clock, file system if the project does).
   - Do not rely on test order, timing or the real current date. Control them.
   - Keep fixtures small and inline unless the project has shared fixtures.
   - Use `write_file` for a new test file or `edit_file` to add to an existing one.
6. Run the new tests with `run_command`. Fix failures caused by the test, not by bending the assertion to match wrong behaviour.
7. If a test reveals a real bug in the code, stop and report it rather than silently changing the code, unless the user asked you to fix bugs.
8. Check that a test would actually fail if the behaviour broke: temporarily break the code, or reason it through explicitly.
9. Run the wider suite to make sure nothing else broke.

## Gotchas

- A test that passes on the first run proves little. Make sure it can fail.
- Testing private implementation details makes tests break on harmless refactors.
- Tests that depend on the real date, network or run order become flaky.
- Adjusting an assertion to match buggy output hides the bug.
- Style that differs from neighbouring tests creates review friction. Copy the project's way.

## Output

Which tests were added (files and test names), what each covers, the command used and the result, and any gaps left untested with the reason.
