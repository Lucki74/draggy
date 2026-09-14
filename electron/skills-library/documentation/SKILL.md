---
name: documentation
description: Writes or updates project documentation (README, usage guides, API docs, docstrings and code comments) that is accurate to the code and matches the project's style. Use when the user asks to document code, write a README, or update docs after a change.
---

# Documentation

Documentation that is wrong is worse than none. Everything you write must match the code as it is.

## Before writing

1. Read the existing docs and follow their tone, structure and formatting. Read AGENTS.md or CONTRIBUTING.md for rules about comments and docs.
2. Read the code being documented: public functions, their parameters and return values, errors, configuration options and defaults, command-line flags.
3. Verify commands before documenting them: check scripts in the manifest, and run quick safe ones (like `--help`) with run_command when possible.

## README

Typical sections, only those that apply:
1. Name and one-paragraph description: what it does and for whom.
2. Features or highlights (short).
3. Requirements.
4. Installation.
5. Usage: the most common task first, with a copy-pasteable example and its output.
6. Configuration: options, environment variables, defaults.
7. Development: how to run tests, lint and build.
8. Contributing and licence, pointing to the relevant files.

## API docs and docstrings

- Use the language's convention: JSDoc/TSDoc, Python docstrings (Google, NumPy or reST, whichever the project uses), rustdoc, Javadoc, Go doc comments.
- Document what and why, contracts and edge cases: what the function guarantees, what it throws, units, whether it mutates input.
- Do not restate the code ("increments i"). Do not document private helpers exhaustively.
- Include a short example for non-obvious public APIs.

## Comments

Explain why something is done in a non-obvious way, not what the next line does. Follow any project limits on comment length.

## After writing

Re-read against the code once more. Report which files were changed, and list anything you could not verify.
