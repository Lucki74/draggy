---
name: performance
description: "Finds and fixes performance problems by measuring first: profiles or times the slow path, identifies the real bottleneck (algorithm, I/O, queries, rendering, memory) and verifies the improvement with numbers. Use when code is slow, uses too much memory, or the user asks to optimise something."
---

# Performance

Optimising without measuring usually speeds up the wrong thing and makes code worse.

## 1. Define slow

- What is slow, for whom, and how slow: a page load, an endpoint, a build, a script, a UI interaction.
- The target: "under 200 ms", "handles 1 million rows".
- The realistic input size and environment.

## 2. Measure

- Reproduce with a repeatable benchmark: time the command with run_command, write a small timing script with run_code or in the project, or use the project's existing benchmarks.
- Use a profiler when available: `node --cpu-prof`, Chrome performance tools for front ends (explain how to record, since you cannot operate them), `python -m cProfile -s cumtime`, `go test -bench . -cpuprofile`, `cargo flamegraph`, database EXPLAIN / EXPLAIN ANALYZE.
- Record baseline numbers, run a few times, and note variance.

## 3. Find the bottleneck

Common causes, check in this order:
1. **Algorithm:** nested loops over large collections (O(n²)), repeated searches in arrays where a map or set would do, sorting inside loops.
2. **I/O and network:** calls inside loops (N+1 queries or requests), missing batching, no caching of repeated work, synchronous file access on hot paths.
3. **Database:** missing indexes, selecting unused columns, fetching everything then filtering in code.
4. **Rendering (front end):** unnecessary re-renders, large lists without virtualisation, layout thrashing, huge bundles.
5. **Memory:** loading whole files instead of streaming, unbounded caches, leaks from listeners or timers.

## 4. Fix and verify

- Change one thing at a time, re-run the same measurement, and keep only changes that clearly help.
- Keep the code readable; comment why an optimisation exists if it is not obvious.
- Run the tests to make sure behaviour is unchanged.

## Report

Baseline vs after numbers, the bottleneck found and the evidence, what changed, and further opportunities ranked by expected gain versus effort.
