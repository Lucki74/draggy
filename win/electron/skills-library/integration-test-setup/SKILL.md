---
name: integration-test-setup
description: Sets up integration tests that run real components together, with isolated data, seeded fixtures, controlled external services and reliable cleanup. Use when the user asks to add integration tests, test against a real database, or set up a test environment.
---

# Integration test setup

## Goal

Give the project tests that exercise real modules, a real database or HTTP layer together, and that any developer or CI job can run from a clean checkout. A good result has isolated tests, a one-command run and a short note on how it works.

## When to use

- Unit tests pass but the parts fail when joined.
- Data access, routes, queues or file handling need checking against the real thing.
- A project has no repeatable test environment.
- A bug appeared only when the router, service and database were joined.
- A pull request changes a database query or a migration.
- CI needs a repeatable way to start the services tests use.

For test doubles at the edges, use `use_skill` with `mock-and-stub-design`. For browser flows, `e2e-test-plan` or `webapp-testing`.

## Steps

1. **Survey.** Use `list_directory`, `read_file` and `search_files` for the test runner, existing test folders, docker or compose files, scripts and env templates. Run the current tests with `run_command` to learn the baseline.
2. **Decide the scope.** Pick the seams to cover: repository with database, HTTP routes with the app in process, message consumer. State what stays real and what is faked (payment provider, email, clock).
3. **Pick the environment.** Prefer a disposable local database or container, an in-process server on a random port, or a temp directory. Never point tests at a shared, staging or production service. Ask with `ask_user` if connection details are missing.
4. **Write setup and teardown.** Create the schema by running the real migrations. Start the app once per file or suite. Isolate each test with a transaction rolled back, a fresh schema, or unique names, and clean up in teardown even on failure.
5. **Seed data.** Create only what each test needs through small helpers (see `use_skill` with `test-data-builder`), not a shared dump.
6. **Write two or three first tests** covering a happy path and a failure path across the seam. Create files with `create_file`.
7. **Add a script** for the suite in the project manifest with `edit_file`, separate from the fast unit run, and document env variables in an example file.
8. **Prove isolation.** Run the suite twice, in reverse order and in parallel if the runner allows. Check it leaves nothing behind.
9. Confirm the suite also passes from a fresh clone with only the documented steps.

## Gotchas

- Tests sharing one database state pass alone and fail together. Isolate each test.
- Hidden dependence on a developer's local setup (installed service, env variable) breaks CI. Start from a clean clone.
- Waiting with fixed sleeps for a service to be ready is flaky. Poll for readiness with a limit.
- Test config that falls back to a real connection string is dangerous. Fail if the test variable is missing.
- A slow suite stops being run. Keep setup shared where safe and the test count modest.

## Output

The files added or changed, the command to run, what is real and what is faked, and the result of the double run. List what remains uncovered.

Record the expected runtime of the suite in the notes.
