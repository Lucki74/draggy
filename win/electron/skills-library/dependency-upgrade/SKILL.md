---
name: dependency-upgrade
description: "Upgrades project dependencies safely: finds outdated and vulnerable packages, reads changelogs for breaking changes, upgrades in small batches, fixes the code and runs the tests after each. Use when the user wants to update packages, fix vulnerable dependencies, or move to a new major version of a library or framework."
---

# Dependency upgrade

## 1. Survey

- Identify the package manager from lock files: package-lock.json (npm), pnpm-lock.yaml, yarn.lock, poetry.lock, uv.lock, requirements.txt, Cargo.lock, go.sum, Gemfile.lock, composer.lock.
- List outdated packages with the manager's command via run_command (npm outdated, pnpm outdated, pip list --outdated, cargo outdated if installed, go list -u -m all).
- List known vulnerabilities (npm audit, pip-audit, cargo audit) when available.
- Make sure the working tree is clean (git_status) and tests pass before starting, so failures can be attributed.

## 2. Plan

Write batches with update_plan, lowest risk first:
1. Patch and minor updates of non-core packages.
2. Security fixes.
3. Each major upgrade on its own, especially frameworks, build tools, test runners and type definitions.

## 3. For each major upgrade

- Read the official changelog or migration guide (read_url when web access is available) and list the breaking changes that affect this project; search_files for the APIs involved.
- Upgrade that package (and its companions, like a framework's plugins) only.
- Apply the required code changes with edit_file, following the migration guide and any official codemod.
- Run install, type check, lint, build and tests with run_command. Fix failures before moving on.

## Rules

- Never delete the lock file to "fix" things, and commit lock file changes together with manifest changes.
- Do not upgrade across a major version the user did not ask for without checking with them.
- Respect engine or runtime constraints (Node, Python version) and peer dependencies.
- If an upgrade gets stuck, revert that package and report why, rather than leaving the project broken.

## Report

A table of package, old version, new version, and notes (breaking changes handled), what was deferred and why, and the test results.
