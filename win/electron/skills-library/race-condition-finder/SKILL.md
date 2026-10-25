---
name: race-condition-finder
description: Finds the shared state or ordering assumption behind a bug that depends on timing, forces the bad interleaving to reproduce it, and fixes it with proper synchronisation or a design change. Use when a failure appears only sometimes or under load, the user suspects a race, or async code runs out of order.
---

# Race condition finder

## Goal

Identify which operations overlap, why their order matters, and make the correct order guaranteed rather than likely. A good result reproduces the bug on demand and keeps it fixed under the same stress.

## When to use

- Bugs that vanish when you add logging or step through.
- Duplicate records, lost updates, stale reads, double submits.
- Async code where a result arrives after the state it belongs to has changed.
- A counter, balance or inventory number ends up wrong under parallel use.
- A user double-clicks and gets two results.
- Results from an old request replace those of a newer one.

For a flaky test only, use `use_skill` with `flaky-test-fixer`. For general root-cause work, `systematic-debugging`.

## Steps

1. **Describe the bad outcome** exactly: which value or state is wrong, and what the correct one would be.
2. **Find the shared state.** Use `search_files` to list who reads and writes it: globals, fields, files, database rows, caches, UI state, counters. Read each site with `read_file`.
3. **List the sequences.** Write the steps of each actor as numbered lines, then find an interleaving that gives the bad outcome. Typical shapes: check then act, read then write, start then await then use, two writers, cancel arriving after complete.
4. **Force it.** Make the bad order happen: add a deliberate delay at the gap, run many in parallel with `run_command`, use a barrier in a test, or lower worker counts. A reproduction on demand is the proof.
5. **Pick the remedy.** In order of preference:
   - Remove the shared state or make it immutable.
   - Make the check and the act one atomic step (transaction, compare and set, unique constraint).
   - Serialise access with a lock or a queue.
   - Cancel or ignore stale results with a request token.
6. **Apply with `edit_file`**, keeping the critical section small and releasing on every exit path.
7. **Stress it again** with the same forcing method and a larger count. Add the forced case as a test if feasible.
8. Search the code for other places with the same check-then-act shape and list them.

## Gotchas

- A sleep or timeout that makes the bug rarer has moved the window, not closed it.
- Single-threaded runtimes still race across await points and callbacks.
- Locks in the wrong order cause deadlocks. Keep one global order and avoid holding a lock across slow calls.
- Application-level checks do not protect against two processes. Use the database or file system for the guarantee.
- Logging changes timing. Capture events in memory with timestamps and print afterwards.

## Output

The overlapping sequence in numbered steps, how it was forced, the remedy chosen with a line on why, the change, and the stress result. Flag any related spots with the same pattern.

Add a note in the code at the guard saying what it protects against.
