---
name: add-feature
description: Implements a new feature end to end in an existing project. Reads the codebase, plans visible steps, follows existing patterns, writes the code and tests, and verifies it works. Use when the user asks to add, build or implement functionality in their project.
---

# Add a feature

## Goal

Ship working functionality that looks like the rest of the project: built from existing patterns, covered by tests, and checked with the project's own scripts.

## When to use

- The user asks to add, build or implement something in an existing project.
- The request is a new behaviour, screen, endpoint, command or option.
- For a bug fix or a pure cleanup, this skill is too heavy. Make the narrow change directly.
- For designing an API before building it, use `use_skill` with `api-design` first.

## Steps

1. Understand the request. Restate what the feature does from the user's point of view, including edge cases and what is out of scope. If a decision is the user's (behaviour, UI wording, a data model with lasting consequences), ask with `ask_user` before building. Otherwise pick sensible defaults and state them.
2. Understand the code. Read AGENTS.md or CONTRIBUTING.md for rules. Find the closest existing feature to copy patterns from (routing, components, state, validation, error handling, tests) with `search_files` and `explore`. List every place that must change: data, logic, interface, configuration, translations, documentation, tests.
3. Plan. Write small, checkable steps with `update_plan`, for example:
   - Add the field to the model and migration
   - Validate it in the API
   - Show it in the form
   - Tests for validation and saving
   - Run the test suite

   Keep the plan current as you work. In plan mode, stop after the plan and explain it, because plan mode proposes and does not change files.
4. Build. Follow the project's patterns and style exactly, even where you would do it differently elsewhere. Reuse existing helpers and components. Use `edit_file` for existing files and `write_file` for new ones. Handle errors and empty states as well as the happy path. Keep changes focused on the feature.
5. Verify. Add tests in the project's style for the main behaviour and the key edge cases. Run type checks, linters and tests with `run_command`, using the project's own scripts, and fix what fails. If the feature has a UI or CLI, run it when that needs no input from the user, or describe how to try it.

## Gotchas

- Copying a pattern from the wrong place. Pick the closest feature, then check that it is not a legacy corner the team wants to leave behind.
- Drive-by refactors bury the feature in the diff and make review harder. Note them for later instead.
- Passing only the happy path. Empty lists, failed requests and invalid input are where features break.
- A feature spread over several layers is easy to leave half done. Tick through the list of places that must change before calling it finished.
- Do not invent test or build commands. Read package.json, the Makefile or the CI file to find the real ones.

## Output

What was built, the files changed, how it was verified (commands and results), the decisions you made, and anything left for later.
