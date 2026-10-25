---
name: query-plan-reader
description: Reads a database EXPLAIN or EXPLAIN ANALYZE output, finds the step that makes a query slow and proposes a specific fix. Use when the user asks why a query is slow, pastes explain output, or asks to analyze a query plan.
---

# Query plan reader

## Goal

Turn a plan into a diagnosis: which node costs the time, why the planner chose it and what change fixes it. A good result cites actual row counts and timings from the plan and proposes one change that can be tested.

## When to use

- A query is slow and the user has or can get the plan.
- The user pastes EXPLAIN output and wants it explained.
- For designing the index the plan points to, use `use_skill` with `index-design`.
- For rewriting the query text itself, use `use_skill` with `sql-helper`.

## Steps

1. Get the exact query with real parameter values, the database engine and version, and the table sizes. Use `ask_user` for what is missing. Plans differ by engine, so check the engine's explain documentation with `read_url` when a node name is unfamiliar.
2. Obtain the plan. If the user can run it, ask for the engine's analyze form that executes the query and reports actual times and rows. With a dev database and permission, run it with `run_command`. Warn that analyze executes the statement, so wrap writes in a transaction that is rolled back.
3. Read the plan from the innermost nodes outward. Record for each node: type of access (sequential scan, index scan, index-only, bitmap), join method, estimated rows versus actual rows, loops and time.
4. Find where the time is. Look at the node with the largest actual time multiplied by loops, not the largest cost estimate.
5. Compare estimates with actuals. A large gap (estimated 10, actual 100000) means stale or missing statistics, correlated columns or a parameter the planner guessed badly.
6. Name the cause. Common ones are a sequential scan on a large table for a selective filter, a missing or unusable index, a sort spilling to disk, a join on unindexed columns, a function applied to an indexed column, or a nested loop run many times.
7. Propose one fix: an index, a rewritten predicate, updated statistics, a smaller selected column list, a different join order or a changed limit approach.
8. Apply the fix in a dev copy, re-run the analyze form and compare timings. Report both.

## Gotchas

- Estimated cost is a planner unit and not time. A node with low cost and high actual time is the story.
- Small development tables make the planner choose a sequential scan, which is correct there. Test with production-sized data or statistics.
- A plan can differ between a prepared statement and a literal value because the planner may use a generic plan. Test the way the application calls it.
- First run versus repeat run differ because of cache. Run it a few times and use a warm figure along with a cold figure.
- `SELECT *` on wide rows costs I/O and blocks index-only scans. List only the needed columns.
- Adding an index without checking write cost and size trades one problem for another. Hand off to index design before adding many.

## Output

- A short diagnosis: slowest node, estimated versus actual rows, cause.
- The proposed change as exact SQL, and before and after timings if measured.
- What remains uncertain, such as differences between the dev and production data.
