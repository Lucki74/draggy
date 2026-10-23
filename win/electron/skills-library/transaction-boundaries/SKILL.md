---
name: transaction-boundaries
description: Decides which operations must be atomic, sets transaction boundaries, isolation and locking correctly, and keeps transactions short and free of slow external calls. Use when the user asks whether a transaction is needed, reports partial writes after errors, or has deadlocks.
---

# Transaction boundaries

## Goal

Every set of writes that must succeed or fail together is in one transaction, and nothing else is. A good result names the invariant each transaction protects, keeps it short and handles errors so a failure never commits half the work.

## When to use

- Code writes to several tables or rows and an error could leave them inconsistent.
- The user sees deadlocks, lock waits or lost updates.
- For concurrency bugs outside the database, use `use_skill` with `concurrency-review`.
- For retried writes that must not duplicate, use `use_skill` with `idempotency-keys`.

## Steps

1. List the operations of the flow with `read_file` and `search_files`: each read and write, in order, including calls to other services. Mark the invariants that must hold, such as "stock never negative" or "order and its lines exist together".
2. Draw the boundary around the writes that protect one invariant. Put the reads that decide those writes inside it when the decision depends on the current value.
3. Keep external calls out. HTTP requests, emails and file operations should happen before or after the transaction, or through an outbox record written inside it and processed later.
4. Choose how to prevent lost updates: an atomic statement (`UPDATE ... SET qty = qty - 1 WHERE qty > 0`), optimistic locking with a version column, or an explicit row lock for read-then-write logic. Prefer the atomic statement where it fits.
5. Check the isolation level the engine uses by default and whether the logic needs stronger guarantees. Look up its exact behaviour in the docs with `read_url`, since engines differ.
6. Make lock order consistent. When code touches several rows or tables, always take them in the same order to avoid deadlocks, and be ready to retry on a deadlock or serialization error.
7. Handle errors: roll back on any exception, do not swallow an error inside the transaction block and continue, and make sure the commit is the last step.
8. Handle nested calls: know whether the framework joins an existing transaction or creates a savepoint, and avoid hidden commits in helper functions.
9. Test with two concurrent runs and a forced failure midway, using `run_command`, and confirm no partial state remains.

## Gotchas

- A network call inside a transaction holds locks for as long as the remote service takes, and can run twice on retry. Move it out.
- Catching an exception inside the transaction and continuing can commit partial work, and on some engines the transaction is already aborted.
- Read, check and then write without a lock or atomic statement lets two requests both pass the check.
- Long transactions block other writers, bloat undo or vacuum work and grow deadlock chances. Do slow computation before opening it.
- Auto-commit helpers inside a "transaction" can commit early. Verify that every write uses the same connection.
- Retrying a whole transaction is only safe when it has no external effects. Keep effects out, as above.

## Output

- A short description per transaction: invariant, statements inside, locking method.
- The code changes and the concurrency or failure tests run.
- Remaining risks, such as isolation assumptions you could not verify on the real engine.
