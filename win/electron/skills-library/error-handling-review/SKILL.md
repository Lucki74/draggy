---
name: error-handling-review
description: Reviews how code detects, passes on, reports and recovers from failures, and lists the paths that swallow, mislabel or leak errors. Use when the user asks for an error handling review, what happens when something fails, or to find swallowed exceptions.
---

# Error handling review

## Goal

For each operation that can fail, know what the caller sees, what the user sees and what the logs show. The review produces a list of failure paths that lose information, leave state half-written or tell the user nothing.

## When to use

- The user asks to review error handling in a module or diff.
- A production failure left no useful trace.
- To reproduce and fix one specific failure, use `use_skill` with `systematic-debugging`.
- To review log content itself, use `use_skill` with `logging-review`.
- A feature talks to a network service, a disk or a child process for the first time.

## Steps

1. List the fallible operations in the target with `read_file` and `search_files`: I/O, network calls, parsing, database access, subprocesses, JSON and number conversion, anything that throws or returns an error value.
2. For each one, trace the failure path to the end: who catches it, what they do, and what reaches the user or the process exit code.
3. Flag these patterns:
   - Empty catch blocks, or catch that logs and continues as if nothing happened.
   - Catch-all handlers that hide programmer errors along with expected ones.
   - Errors rethrown without the original cause, losing the stack or the message.
   - Return values (`null`, `-1`, `false`) that callers never check.
   - Promises with no handler, or `async` calls without `await` in a try block.
4. Check state on failure: after an error halfway through, is a file partly written, a transaction open, a lock held, a counter incremented? Look for cleanup in `finally` or equivalent.
5. Check retries: bounded count, backoff, only for errors that can succeed on retry, and safe to repeat (idempotent).
6. Check messages: does the user-facing text say what to do next, and does the log carry the identifier needed to find the case?
7. Prove the suspicious ones. Use `run_command` to trigger the failure with a bad input, and observe the result.
8. Write the missing failure tests as a list: input, expected user message, expected log line, expected state afterwards.
9. Check the process boundary: exit codes, HTTP status codes and top-level handlers that turn an exception into a response.

## Gotchas

- A catch that logs is not handling. If the function then returns a default, the caller cannot tell success from failure.
- Expected failures (file missing, user cancelled) and bugs (undefined access) need different treatment. One blanket catch cannot serve both.
- Retrying a non-idempotent call, such as a payment or an insert, can double the effect.
- Fail-open defaults on permission or validation errors are a security bug, not a convenience.
- Error text that includes raw input or internal paths leaks data to users.
- Tests that only cover the happy path leave all of this unchecked. Name the missing failure tests.

## Output

- Findings ranked by impact: data loss or wrong result, hidden failure, poor message.
- Each finding gives location, the failure scenario, what the user sees and a fix.
- The list of failure tests worth adding.
- Failure scenarios you reproduced, with the observed output.
