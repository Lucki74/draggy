---
name: performance
description: "Finds and fixes performance problems by measuring first: profiles or times the slow path, identifies the real bottleneck (algorithm, I/O, queries, rendering, memory) and verifies the improvement with numbers. Use when code is slow, uses too much memory, or the user asks to optimise something."
---

# Performance

## Goal

Make the slow thing measurably faster without making the code worse. Optimising without measuring usually speeds up the wrong thing, so every change is backed by before and after numbers.

## When to use

- Code, a page, an endpoint, a build or a script is slow or uses too much memory.
- The user asks to optimise something.
- For a database query that is slow, `use_skill` with `sql-helper` helps with query shape and indexes.
- For a bug that is not about speed, use `use_skill` with `debugging`.

## Steps

1. Define slow. Establish what is slow, for whom and how slow: a page load, an endpoint, a build, a script, a UI interaction. Get the target ("under 200 ms", "handles 1 million rows") and the realistic input size and environment.
2. Measure. Reproduce with a repeatable benchmark: time the command with `run_command`, write a small timing script with `run_command` or in the project, or use the project's existing benchmarks. Use a profiler when available: `node --cpu-prof`, Chrome performance tools for front ends (explain how to record, since you cannot operate them), `python -m cProfile -s cumtime`, `go test -bench . -cpuprofile`, `cargo flamegraph`, database EXPLAIN or EXPLAIN ANALYZE. Record baseline numbers, run a few times, and note variance.
3. Find the bottleneck. Check the common causes in this order:
   1. Algorithm: nested loops over large collections (O(n^2)), repeated searches in arrays where a map or set would do, sorting inside loops.
   2. I/O and network: calls inside loops (N+1 queries or requests), missing batching, no caching of repeated work, synchronous file access on hot paths.
   3. Database: missing indexes, selecting unused columns, fetching everything then filtering in code.
   4. Rendering (front end): unnecessary re-renders, large lists without virtualisation, layout thrashing, huge bundles.
   5. Memory: loading whole files instead of streaming, unbounded caches, leaks from listeners or timers.
4. Fix and verify. Change one thing at a time, re-run the same measurement, and keep only changes that clearly help. Keep the code readable and comment why an optimisation exists if it is not obvious. Run the tests to make sure behaviour is unchanged.

## Gotchas

- A single timing run is noise. Run several times and note the variance before claiming a win.
- Changing several things at once hides which one helped. Change one, measure, then continue.
- Benchmarks on tiny inputs miss the real cost. Use the realistic input size.
- A faster version that fails the tests is a regression. Run them after every change.
- Micro-optimising code outside the measured hot path adds complexity for no gain.

## Output

Baseline versus after numbers, the bottleneck found and the evidence, what changed, and further opportunities ranked by expected gain versus effort.
