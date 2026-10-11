---
name: add-feature
description: "Implements a new feature end to end in an existing project: understands the codebase, plans visible steps, follows existing patterns, writes the code and tests, and verifies it works. Use when the user asks to add, build or implement functionality in their project."
---

# Add a feature

## 1. Understand the request

- Restate what the feature does from the user's point of view, including edge cases and what is out of scope.
- If a decision is genuinely the user's (behaviour, UI wording, data model with lasting consequences), ask before building. Otherwise choose sensible defaults and state them.

## 2. Understand the code

- Read AGENTS.md or CONTRIBUTING.md for rules.
- Find the closest existing feature to copy patterns from: routing, components, state, validation, error handling, tests. Use search_files and explore.
- Identify every place that must change: data, logic, interface, configuration, translations, documentation, tests.

## 3. Plan

Write the steps with update_plan, each small and checkable, for example:
[ ] Add the field to the model and migration
[ ] Validate it in the API
[ ] Show it in the form
[ ] Tests for validation and saving
[ ] Run the test suite
Update the plan as you go, marking the current step [>] and finished ones [x].

In plan mode, stop after the plan and explain it: plan mode proposes, it does not change files.

## 4. Build

- Follow the project's existing patterns and style exactly, even if you would do it differently elsewhere.
- Reuse existing helpers and components rather than writing new ones.
- Make edits with edit_file for existing files and write_file for new ones.
- Handle errors and empty states, not only the happy path.
- Keep changes focused on the feature; no drive-by refactors.

## 5. Verify

- Add tests in the project's style for the main behaviour and key edge cases.
- Run type checks, linters and tests with run_command using the project's own scripts. Fix what fails.
- If the feature has a UI or CLI, describe how to try it, or run it if that is possible without the user's input.

## 6. Report

What was built, the files changed, how it was verified (commands and results), decisions you made, and anything left for later.
