---
name: write-tests
description: Adds meaningful automated tests using the project's existing framework and conventions, covering behaviour, edge cases and regressions, and runs them. Use when the user asks for tests, better coverage, or a test for a bug or new feature.
---

# Write tests

## Learn the project's way first

1. Find the framework and conventions: read package.json, pyproject.toml, Cargo.toml, go.mod or the build file; search_files for existing test files (`.test.`, `_test.`, `test_`, `spec`).
2. Read two or three existing tests near the code under test. Copy their structure: file location and naming, imports, fixtures and helpers, mocking style, assertion style.
3. Find the command that runs tests (package scripts, Makefile, CI config).

## Decide what to test

- The behaviour the code promises, not its private implementation details.
- For each function or component: the normal case, boundaries (empty, zero, one, many, maximum), invalid input and errors, and any case that has broken before.
- For a bug: first a test that reproduces it and fails.
- Prefer a few precise tests over many shallow ones. Each test checks one behaviour and its name says which ("returns an empty list when the folder has no files").

## Write them

- Arrange, act, assert, clearly separated.
- Use real objects where cheap; mock only slow or external things (network, clock, file system if the project does).
- No reliance on test order, timing or the real current date; control them.
- Keep fixtures small and inline unless the project has shared fixtures.
- Use write_file for a new test file or edit_file to add to an existing one.

## Run and check

1. Run the new tests with run_command. Fix failures caused by the test, not by bending the assertion to match wrong behaviour.
2. If a test reveals a real bug in the code, stop and report it to the user rather than silently changing the code, unless they asked you to fix bugs.
3. Check that a test would actually fail if the behaviour broke: temporarily break the code or reason it through explicitly.
4. Run the wider suite to make sure nothing else broke.

## Report

Which tests were added (files and test names), what each covers, the command used and the result, and any gaps left untested with the reason.
