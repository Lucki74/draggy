---
name: ci-workflow
description: Creates or fixes continuous integration workflows (GitHub Actions, GitLab CI) that install, lint, type-check, test and build the project reliably, with caching, a version matrix and minimal permissions. Use when the user wants CI set up, a workflow fixed, or a failing pipeline diagnosed.
---

# CI workflow

## Goal

A pipeline that runs the same checks the project runs locally, fails with a readable message, and uses caching and permissions sensibly. For a failing pipeline, the goal is the first real cause and a fix.

## When to use

- The user wants CI set up for a project.
- A workflow file needs fixing or extending.
- A pipeline fails in CI and passes locally.

## Steps

1. Learn the project with `read_file` and `search_files`:
   - the check commands it already uses locally (scripts in package.json, Makefile targets, tox or nox, cargo, go test). CI should run the same commands, not new ones.
   - runtime versions: .nvmrc, engines, .python-version, rust-toolchain, go.mod.
   - existing workflows in .github/workflows or .gitlab-ci.yml, to extend rather than duplicate.
2. For GitHub Actions, follow these defaults:
   - Trigger on `push` to the main branch and on `pull_request`.
   - Set `permissions: contents: read` at the top, and widen per job only when needed.
   - Pin actions to a major version at least (`actions/checkout@v4`), or to a commit SHA for stricter supply-chain safety.
   - Use the setup action's built-in cache (`actions/setup-node` with `cache: npm`, `actions/setup-python` with `cache: pip`), or `actions/cache` keyed on the lock file hash.
   - Install from the lock file (`npm ci`, `pip install -r requirements.txt`, `uv sync --frozen`).
   - Use separate steps for lint, type check, test and build so failures are easy to read, and fail fast.
   - Add a matrix only for versions or operating systems the project really supports.
   - Set `concurrency` with `cancel-in-progress: true` for pull requests to save minutes.
   - Use secrets through `secrets.*` and never echo them. Fork-triggered workflows get no secrets.
3. To diagnose a failing pipeline, ask for or read the failing job log. Find the first real error, not the last line. Compare CI with local: versions, missing environment variables, case-sensitive file systems on Linux, time zones, missing system packages, network access, test order and parallelism. Reproduce locally with the same command through `run_command` when possible.
4. Verify the YAML is valid (indentation, quoting of `on`). If `act` or the GitLab CI linter is available, run it with `run_command`. Otherwise say the workflow will be verified on the next push.

## Gotchas

- The last line of a log is usually a consequence. The cause is the first error above it.
- Unquoted `on` can be read as a boolean by some YAML parsers.
- Linux runners are case-sensitive, so imports that work on Windows or macOS can fail in CI.
- Tests that depend on time zones, order or leftover local state pass locally and fail in CI.
- Secrets are not available to workflows triggered from forks, so a job that needs them will fail on outside pull requests.

## Output

The workflow file, what each job does, any required secrets or settings, and the expected run time.
