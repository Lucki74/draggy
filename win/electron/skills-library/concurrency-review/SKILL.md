---
name: concurrency-review
description: Reviews a change for shared mutable state, lock use, ordering assumptions, cancellation and shutdown problems in threaded or async code before it ships. Use when the user asks if code is thread safe, whether async code is correct, or to review locking and shared state in a change.
---

# Concurrency review

## Goal

Decide whether a change stays correct when two things run at once or in an unexpected order. The review names each piece of shared state, who may touch it, what protects it, and the interleavings that break the invariant.

## When to use

- A diff adds threads, workers, timers, event handlers, queues or async flows.
- The user asks whether code is thread safe or async safe.
- To hunt a race that already shows up as a flaky failure, use `use_skill` with `race-condition-finder`.
- For a flaky test specifically, use `use_skill` with `flaky-test-fixer`.
- A UI event handler and a background task both update the same state.

## Steps

1. Identify the concurrency model with `read_file` and `search_files`: threads, an event loop, worker processes, goroutines, actors, IPC between processes. The hazards differ per model.
2. List shared state touched by the change: module-level variables, singletons, caches, files, database rows, global counters, objects passed between tasks.
3. For each item write down who reads it, who writes it, and what protects it (lock, queue, single owner, immutability, transaction).
4. Look for these hazards:
   - Check-then-act: a condition tested, then acted on after an await or lock release.
   - Read-modify-write without atomicity, such as `count += 1` across tasks.
   - A state change split over several awaits that another task can observe midway.
   - Two locks taken in different orders on different paths.
   - A lock held across slow I/O or a callback into unknown code.
   - Events and callbacks that fire after the owner was disposed.
5. Check lifecycle: how does the work start, get cancelled and stop on shutdown? What happens to in-flight work, queued items and partially written data?
6. Check ordering assumptions: does the code assume responses arrive in request order, or that two writes land in the order they were sent?
7. Try to prove one. With `run_code` or `run_command`, write a small stress test or inject a delay between check and act, and see the invariant break.
8. Write the invariant in one sentence for each piece of shared state, such as 'balance never negative' or 'one worker per job'. A review without a stated invariant has nothing to test against.
9. Check tests for concurrency: do they use real timing sleeps, or controlled schedulers and barriers? Sleeps hide races.

## Gotchas

- A single-threaded runtime still interleaves at every await. "No threads" does not mean no races.
- Adding a lock around one access of a value that is read elsewhere unlocked protects nothing.
- Retrying or queuing can hide a race for months. It usually surfaces under load, so a passing run is weak evidence.
- Fire-and-forget tasks swallow their errors and outlive their owners. Ask who awaits each one.
- Idempotency keys and database constraints are often a better fix than more locks. Check whether the store can enforce the invariant.
- Memory visibility rules differ by language. Do not assume a plain flag write is seen by another thread.

## Output

- A table of shared state: item, readers, writers, protection, verdict.
- Findings ranked by severity, each with a concrete interleaving that breaks it, numbered step by step.
- Suggested fixes and any stress test worth keeping.
- Invariants stated for each shared item, so the author can confirm them.
