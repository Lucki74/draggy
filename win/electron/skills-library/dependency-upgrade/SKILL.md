---
name: dependency-upgrade
description: Upgrades project dependencies safely. Finds outdated and vulnerable packages, reads changelogs for breaking changes, upgrades in small batches, fixes the code and runs the tests after each batch. Use when the user wants to update packages, fix vulnerable dependencies, or move to a new major version of a library or framework.
---

# Dependency upgrade

## Goal

Bring dependencies up to date without leaving the project broken. A good result upgrades in small, tested batches, so any failure can be traced to one change, and reports what moved, what was deferred and why.

## When to use

- The user asks to update packages or fix an audit warning.
- The user wants to move to a new major version of a library, framework or runtime tool.
- For a failure that appears after an upgrade and has no obvious cause, use `use_skill` with `debugging`.

## Steps

1. Survey.
   - Identify the package manager from lock files: package-lock.json (npm), pnpm-lock.yaml, yarn.lock, poetry.lock, uv.lock, requirements.txt, Cargo.lock, go.sum, Gemfile.lock, composer.lock.
   - List outdated packages with the manager's command via `run_command` (`npm outdated`, `pnpm outdated`, `pip list --outdated`, `cargo outdated` if installed, `go list -u -m all`).
   - List known vulnerabilities (`npm audit`, `pip-audit`, `cargo audit`) when available.
   - Run `git_status` to confirm the working tree is clean, and run the tests before starting, so failures can be attributed.
2. Plan with `update_plan`, lowest risk first:
   1. Patch and minor updates of non-core packages.
   2. Security fixes.
   3. Each major upgrade on its own, especially frameworks, build tools, test runners and type definitions.
3. For each major upgrade:
   - Read the official changelog or migration guide (`read_url` when web access is available) and list the breaking changes that affect this project. Use `search_files` for the APIs involved.
   - Upgrade that package, and its companions such as a framework's plugins, only.
   - Apply the required code changes with `edit_file`, following the migration guide and any official codemod.
   - Run install, type check, lint, build and tests with `run_command`. Fix failures before moving on.
4. If an upgrade gets stuck, revert that package and report why, instead of leaving the project broken.

## Gotchas

- Never delete the lock file to "fix" things. Commit lock file changes together with manifest changes.
- Do not upgrade across a major version the user did not ask for without checking with them through `ask_user`.
- Respect engine and runtime constraints (Node, Python version) and peer dependencies.
- Upgrading everything at once makes a failing test impossible to pin on one package.
- Starting from a red test suite hides which failures you caused. Get a green baseline first.

## Output

A table of package, old version, new version, and notes (breaking changes handled), then what was deferred and why, and the test results.
