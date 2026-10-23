---
name: background-jobs
description: Moves slow or unreliable work out of the request path into background jobs, with small payloads, safe retries, status tracking and failure visibility. Use when the user asks to move work to a background job, says a request times out, or wants emails or reports sent asynchronously.
---

# Background jobs

## Goal

Requests return fast and the heavy work finishes reliably elsewhere. A good result has jobs that are safe to run twice, retries with backoff, a way to see failures and a clear answer to what the user sees while the job runs.

## When to use

- A request is slow because of email, file processing, reports, imports or third-party calls.
- Work must be retried or scheduled and nobody tracks it today.
- For writing the consumer side of a message queue, use `use_skill` with `queue-consumer-design`.
- For jobs that must not duplicate effects, also use `use_skill` with `idempotency-keys`.

## Steps

1. Find the slow work. Use `search_files` and `read_file` on the handler. Mark what the response truly depends on and what can happen after it.
2. Check what job infrastructure exists (a queue library, a scheduler, a worker process). Reuse it. If none exists, compare options with the user and check current docs through `read_url` before choosing.
3. Define the job: a name, and a payload containing ids and parameters, never large objects or secrets. The worker loads fresh data by id when it runs.
4. Make the job idempotent. Assume it will run more than once. Use a status column, a unique constraint or a dedupe key so a second run does not repeat the effect.
5. Set retry rules: a maximum number of attempts, exponential backoff with jitter, and a distinction between retryable failures (timeouts, 503) and permanent ones (validation, 404) that go straight to a failed state.
6. Add a timeout per job so a hung call does not hold a worker forever.
7. Track state for anything the user waits on: pending, running, done, failed, saved in the database, with an endpoint or event the UI can poll. Return 202 with a status location from the request.
8. Make failures visible: log with the job id and attempt, keep a dead-letter list, and alert on a growing failure count.
9. Test the job body as a plain function, then the retry and failure paths. Run the tests with `run_command`.

## Gotchas

- Enqueuing a job inside a database transaction before it commits lets the worker run and find no row. Enqueue after commit, or use an outbox table.
- Putting the full record in the payload sends stale data. By the time the job runs the row may have changed or been deleted.
- Jobs that are not idempotent turn a harmless retry into a double charge or duplicate email.
- Retrying forever turns a bad message into a permanent load. Cap attempts and park failures.
- Running scheduled jobs on every instance runs them N times. Use one scheduler or a lock.
- A worker restart during deploy kills in-flight jobs. Make the queue redeliver and finish long jobs in resumable steps.

## Output

- The job list: name, payload, trigger, retry policy, timeout.
- The code changes and how the user sees status.
- Tests run and what is not covered, such as behaviour under worker crashes.
