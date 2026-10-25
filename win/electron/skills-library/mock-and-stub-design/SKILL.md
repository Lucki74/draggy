---
name: mock-and-stub-design
description: Decides what to replace in a test and where, chooses between a fake, a stub, a spy and a mock, and writes test doubles that stay faithful to the real dependency. Use when the user asks how to mock something, has tests full of mocks, or needs to stub a network call or service.
---

# Mock and stub design

## Goal

Keep tests fast and isolated without making them lie. A good result replaces only what is slow, random or external, at a narrow boundary, with doubles that behave like the real thing and let tests assert outcomes.

## When to use

- A unit needs a network, clock, disk, database or third party service.
- Tests break whenever the implementation is refactored.
- A mock answers differently from the real service and bugs slip through.
- A test needs a clock, a random source or an environment variable controlled.
- A team debates mocks against real databases.
- A third party API has rate limits or costs money per call.

To plan tests that use real components, use `use_skill` with `integration-test-setup`.

## Steps

1. **Read the unit and its dependencies.** Use `read_file` and `search_files` to list what the code calls outside itself. Mark each as: pure (no double), cheap and local (use real), slow or non-deterministic (replace), or owned by someone else (wrap).
2. **Choose the boundary.** Replace at the edge you own: a small interface or adapter around the HTTP client, clock or file system, not deep calls scattered through the code. If none exists, add a thin one with `edit_file`.
3. **Choose the kind of double.**
   - Stub: returns canned answers; use it when the test only needs inputs.
   - Fake: a small working version (in-memory repository); best for stateful flows.
   - Spy: records calls; use it when an outgoing effect is the point (an email was sent).
   - Mock with expectations: only when the exact interaction is the requirement.
4. **Make it faithful.** Copy real response shapes, error cases, status codes and timing from documentation or captured real responses. Check current API behaviour with `read_url`. Include the failure paths: timeout, 4xx, 5xx, empty result.
5. **Write the test around outcomes.** Assert on returned values and visible state. Assert on calls only for outgoing side effects.
6. **Cover the seam once for real.** Keep at least one test that runs the real dependency (or a recorded contract check) so a drifting double is noticed.
7. **Run** the tests with `run_command`, then change an internal detail and confirm the tests still pass.
8. Delete any double that no longer has a user after the change.

## Gotchas

- Mocking the unit under test, or anything in the same module, tests the mock.
- A double that returns a shape the real service never sends produces green tests and a broken release.
- Counting calls and checking argument order locks in the implementation. Refactors then fail for no reason.
- Shared doubles with state left over from the previous test cause order dependence. Reset in setup.
- Fake time and random sources should be injectable. Patching globals deep in the code is fragile.

## Output

A table of dependency and decision, the interface or adapter added, the doubles written (file paths), and the one real-dependency test that guards against drift.

Explain the reason for each choice of double in one line so reviewers can follow.
