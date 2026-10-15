---
name: ci-workflow
description: Creates or fixes continuous integration workflows (GitHub Actions, GitLab CI) that install, lint, type-check, test and build the project reliably, with caching, a version matrix and minimal permissions. Use when the user wants CI set up, a workflow fixed, or a failing pipeline diagnosed.
---

# CI workflow

## Learn the project

- The check commands the project already uses locally: scripts in package.json, Makefile targets, tox or nox, cargo, go test. CI should run the same commands, not new ones.
- Runtime versions: .nvmrc, engines, .python-version, rust-toolchain, go.mod.
- Existing workflows in .github/workflows or .gitlab-ci.yml, to extend rather than duplicate.

## GitHub Actions essentials

- Trigger on `push` to the main branch and on `pull_request`.
- `permissions: contents: read` at the top, and widen per job only when needed.
- Pin actions to a major version at least (`actions/checkout@v4`), or to a commit SHA for stricter supply-chain safety.
- Use the setup action's built-in cache (`actions/setup-node` with `cache: npm`, `actions/setup-python` with `cache: pip`), or `actions/cache` keyed on the lock file hash.
- Install with the lock file (`npm ci`, `pip install -r requirements.txt`, `uv sync --frozen`).
- Separate steps for lint, type check, test and build so failures are easy to read; fail fast.
- A matrix only for versions or operating systems the project really supports.
- `concurrency` with `cancel-in-progress: true` for pull requests to save minutes.
- Secrets through `secrets.*`, never echoed; no secrets for workflows triggered by forks.

## Diagnosing a failing pipeline

Ask for, or read, the failing job log. Find the first real error (not the last line). Compare the CI environment with local: versions, missing environment variables, case-sensitive file systems on Linux, time zones, missing system packages, network access, test order and parallelism. Reproduce locally with the same command via run_command when possible.

## Verify

Check the YAML is valid (indentation, quoting of `on`), and if `act` or the GitLab CI linter is available, use it. Otherwise say the workflow will be verified on the next push.

## Report

The workflow file, what each job does, required secrets or settings, and the expected run time.
