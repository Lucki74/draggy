---
name: documentation
description: Writes or updates project documentation (README, usage guides, API docs, docstrings and code comments) that is accurate to the code and matches the project's style. Use when the user says "document this", "write a README", "add docstrings" or "update the docs after this change".
---

# Documentation

## Goal

Documentation that is wrong is worse than none, so everything written must match the code as it is. A good result follows the project's existing tone and format, gives commands that work, and lists anything that could not be verified.

## When to use

- The user asks to document code, write or update a README, or add docstrings and comments.
- A change altered behaviour, options or commands and the docs need to follow.
- For writing a commit message, use `use_skill` with `commit-message`.

## Steps

1. Read the existing docs with `read_file` and follow their tone, structure and formatting. Read AGENTS.md or CONTRIBUTING.md for rules about comments and docs.
2. Read the code being documented: public functions, their parameters and return values, errors, configuration options and defaults, command-line flags.
3. Verify commands before documenting them. Check the scripts in the manifest, and run quick safe ones (like `--help`) with `run_command` when possible.
4. Write the docs with `edit_file` or `create_file`. For a README, include only the sections that apply, in this order:
   1. Name and one-paragraph description: what it does and for whom.
   2. Features or highlights (short).
   3. Requirements.
   4. Installation.
   5. Usage: the most common task first, with a copy-pasteable example and its output.
   6. Configuration: options, environment variables, defaults.
   7. Development: how to run tests, lint and build.
   8. Contributing and licence, pointing to the relevant files.
5. For API docs and docstrings, use the language's convention: JSDoc or TSDoc, Python docstrings (Google, NumPy or reST, whichever the project uses), rustdoc, Javadoc, Go doc comments. Document what and why, contracts and edge cases: what the function guarantees, what it throws, units, whether it mutates input. Include a short example for non-obvious public APIs.
6. For comments, explain why something is done in a non-obvious way, not what the next line does. Follow any project limits on comment length.
7. Re-read what you wrote against the code once more.

## Gotchas

- Do not restate the code ("increments i"). Such comments add noise and go stale.
- Do not document private helpers exhaustively.
- An example that was never run is likely to be wrong. Check commands and outputs.
- Copying defaults from memory goes wrong when the code changed. Read the current value.
- Docs in a different tone or heading style from the rest of the project look pasted in. Match what is there.

## Output

The files changed, and a list of anything you could not verify.
